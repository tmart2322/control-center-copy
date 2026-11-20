/**
 * Which downstream steps re-run for a re-eval job, based on what changed (R-UI-20: "save first, then
 * re-evaluate status, NBA, priority and draft"). Steps run in canonical order:
 *   status → priority → nba → draft → brief
 * Example: context-only evidence on a handed-off item recomputes only the brief; it never
 * regenerates the NBA (R-UI-22). A user-locked draft is never rewritten: its step becomes `propose`.
 */
import type { ChangeKind, Involvement, Resolution, WorkItemStatus } from '@/engines/types';
import { LIVE_STATUSES } from '@/engines/types';
import { NEW_INFO_CHANGES } from './generation';

export type ReevalStep = 'status' | 'priority' | 'nba' | 'draft' | 'brief';
export const REEVAL_STEPS: readonly ReevalStep[] = ['status', 'priority', 'nba', 'draft', 'brief'];

export interface PlannerItem {
  status: WorkItemStatus;
  resolution?: Resolution | null;
  involvement?: Involvement;
  /** The current NBA has a draft (reply/email). */
  hasDraft: boolean;
  /** The user edited the draft (`drafts.edited_by_user`): engines propose, never overwrite. */
  draftUserLocked: boolean;
}

export interface PlannedStep {
  step: ReevalStep;
  mode: 'write' | 'propose';
  /** Which changes asked for it. */
  because: ChangeKind[];
}

export interface ReevalPlan {
  steps: PlannedStep[];
  skipped: Array<{ step: ReevalStep; reason: string }>;
}

/** Changes that can move the item's status (closure re-runs). */
const STATUS_CHANGES: ReadonlySet<ChangeKind> = new Set<ChangeKind>([
  'evidence_origin',
  'evidence_progress',
  'evidence_completion',
  'evidence_contradiction',
  'requirements_change',
  'loop_back',
  'session_status',
  'drive_digest',
  'reply',
  'email_sent',
  'timer',
]);

/** Steps per change for an owned, live item. */
const STEPS_FOR: Record<ChangeKind, ReevalStep[]> = {
  evidence_origin: ['status', 'priority', 'nba', 'draft'],
  evidence_progress: ['status', 'priority', 'nba', 'draft'],
  evidence_completion: ['status', 'priority', 'nba', 'draft'],
  evidence_contradiction: ['status', 'priority', 'nba', 'draft'],
  requirements_change: ['status', 'priority', 'nba', 'draft'],
  loop_back: ['status', 'priority', 'nba', 'draft'],
  session_status: ['status', 'priority', 'nba', 'draft'],
  drive_digest: ['status', 'priority', 'nba', 'draft'],
  reply: ['status', 'priority', 'nba', 'draft'],
  email_sent: ['status', 'priority', 'nba', 'draft'],
  timer: ['status', 'priority', 'nba', 'draft'],
  // Context never moves status, but it can change what the next action should say.
  evidence_context: ['nba', 'draft', 'brief'],
  calendar_changed: ['priority', 'nba', 'draft'],
  policy_changed: ['priority'],
  entity_changed: ['priority', 'nba', 'draft'],
  user_edit_schedule: ['priority'],
  user_edit_content: ['nba', 'draft'],
  user_edit_status: ['priority', 'nba'],
  // The user owns the draft now; nothing regenerates.
  draft_edited: [],
};

const notMine = (i: PlannerItem): boolean =>
  i.resolution === 'handed_off' ||
  i.resolution === 'done_by_other' ||
  i.resolution === 'declined' ||
  i.involvement === 'watcher' ||
  i.involvement === 'not_involved';

export function planReeval(changes: ChangeKind[], item: PlannerItem): ReevalPlan {
  const want = new Map<ReevalStep, Set<ChangeKind>>();
  const skipped = new Map<ReevalStep, string>();
  const add = (step: ReevalStep, c: ChangeKind) => {
    const s = want.get(step) ?? new Set<ChangeKind>();
    s.add(c);
    want.set(step, s);
  };
  const skip = (step: ReevalStep, reason: string) => {
    if (!skipped.has(step)) skipped.set(step, reason);
  };
  const live = LIVE_STATUSES.includes(item.status);

  for (const c of changes) {
    if (notMine(item) && c !== 'loop_back') {
      // R-UI-22: handed-off / not-involved items take new info as context only.
      if (NEW_INFO_CHANGES.has(c)) add('brief', c);
      for (const s of ['status', 'priority', 'nba', 'draft'] as const) skip(s, 'Handed off / not involved: context only');
      continue;
    }
    if (item.status === 'suggested') {
      if (STATUS_CHANGES.has(c)) add('status', c);
      skip('priority', 'Suggested: not ranked until accepted');
      skip('nba', 'Suggested: no NBA until accepted');
      skip('draft', 'Suggested: no NBA until accepted');
      continue;
    }
    if (!live) {
      // done / dismissed / merged / snoozed: only closure can bring it back (reopen, sibling, wake).
      if (STATUS_CHANGES.has(c)) {
        add('status', c);
        add('priority', c);
      } else if (c === 'evidence_context') add('brief', c);
      skip('nba', `${item.status}: NBA re-runs only if the item comes back`);
      skip('draft', `${item.status}: NBA re-runs only if the item comes back`);
      continue;
    }
    for (const s of STEPS_FOR[c]) add(s, c);
  }

  if (!item.hasDraft && want.has('draft')) {
    want.delete('draft');
    skip('draft', 'No draft on the current NBA (the NBA step writes one if needed)');
  }
  const steps: PlannedStep[] = REEVAL_STEPS.filter((s) => want.has(s)).map((s) => ({
    step: s,
    mode: s === 'draft' && item.draftUserLocked ? 'propose' : 'write',
    because: [...want.get(s)!],
  }));
  return {
    steps,
    skipped: REEVAL_STEPS.filter((s) => !want.has(s) && skipped.has(s)).map((s) => ({ step: s, reason: skipped.get(s)! })),
  };
}

/**
 * After the status step: a closed item drops NBA/draft (its NBA is completed or superseded), and an
 * item that came back (reopen, wake, loop-back) gets them.
 */
export function pruneAfterStatus(plan: ReevalPlan, before: WorkItemStatus, after: WorkItemStatus, item: PlannerItem): ReevalPlan {
  const wasLive = LIVE_STATUSES.includes(before);
  const isLive = LIVE_STATUSES.includes(after);
  let steps = plan.steps.slice();
  const skipped = plan.skipped.slice();
  if (!isLive) {
    for (const s of steps.filter((x) => x.step === 'nba' || x.step === 'draft')) skipped.push({ step: s.step, reason: `Now ${after}: NBA completed or superseded` });
    steps = steps.filter((x) => x.step !== 'nba' && x.step !== 'draft');
  } else if (!wasLive) {
    const because = steps.find((x) => x.step === 'status')?.because ?? [];
    const ensure = (step: ReevalStep, mode: 'write' | 'propose') => {
      if (!steps.some((x) => x.step === step)) steps.push({ step, mode, because });
    };
    ensure('priority', 'write');
    ensure('nba', 'write');
    if (item.hasDraft) ensure('draft', item.draftUserLocked ? 'propose' : 'write');
    steps.sort((a, b) => REEVAL_STEPS.indexOf(a.step) - REEVAL_STEPS.indexOf(b.step));
  }
  return { steps, skipped: skipped.filter((s) => !steps.some((x) => x.step === s.step)) };
}
