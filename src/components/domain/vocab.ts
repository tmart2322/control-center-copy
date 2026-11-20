/**
 * UI vocabulary for domain components: work states (UI-SPEC §11), resolutions (R-UI-22), NBA verbs,
 * kinds, run states (§12), connector and activity statuses. One place, so every surface says the same thing.
 */
import type {
  ActivityStatus,
  ConnectorState,
  NbaVerb,
  Resolution,
  RunState,
  Tone,
  WorkItem,
  WorkKind,
  WorkState,
} from '@/contract';

export interface PillSpec {
  tone: Tone;
  label: string;
  dashed?: boolean;
}

/** State pill for a work item; null for `open` (the default shows no pill). */
export function statePill(item: Pick<WorkItem, 'state' | 'waiting' | 'resolution' | 'resolutionDetail' | 'snoozedUntil' | 'loopedBackIn'>, opts?: { waitingAge?: string; snoozeLabel?: string }): PillSpec | null {
  switch (item.state) {
    case 'suggested':
      return { tone: 'ai', label: 'Suggested', dashed: true };
    case 'open':
      return null;
    case 'in_progress':
      return { tone: 'brand', label: 'In progress' };
    case 'waiting_on_me':
      return { tone: 'warn', label: 'Waiting on you' };
    case 'waiting_on_others': {
      const who = item.waiting?.who?.name?.split(' ')[0];
      return { tone: 'neutral', label: `Waiting on ${who ?? 'others'}${opts?.waitingAge ? ` · ${opts.waitingAge}` : ''}` };
    }
    case 'likely_done':
      return { tone: 'ok', label: 'Looks done' };
    case 'done':
      return { tone: 'ok', label: resolutionLabel(item.resolution, item.resolutionDetail?.personName) };
    case 'reopened':
      return { tone: 'warn', label: item.loopedBackIn ? 'Looped back in' : 'Reopened' };
    case 'snoozed':
      return { tone: 'neutral', label: opts?.snoozeLabel ? `Snoozed until ${opts.snoozeLabel}` : 'Snoozed' };
    case 'dismissed':
      return { tone: 'neutral', label: 'Dismissed' };
  }
}

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  done_by_me: 'Done by you',
  handed_off: 'Handed off',
  done_by_other: 'Done by someone else',
  not_needed: 'Not needed',
  duplicate: 'Duplicate',
  declined: 'Declined',
  superseded: 'Superseded',
};

export function resolutionLabel(r: Resolution | null | undefined, person?: string): string {
  if (!r) return 'Done';
  if (r === 'handed_off') return person ? `Handed off → ${person.split(' ')[0]}` : 'Handed off';
  if (r === 'done_by_other') return person ? `Done by ${person.split(' ')[0]}` : 'Done by someone else';
  return RESOLUTION_LABEL[r];
}

/** Default primary label per verb (NbaCard.primaryLabel wins when present). */
export const VERB_LABEL: Record<NbaVerb, string> = {
  send: 'Send',
  start_in_claude: 'Start in Claude',
  run_tool: 'Run tool',
  log: 'Log',
  review: 'Review',
  answer: 'Answer',
  confirm_done: 'Confirm done',
  nudge: 'Nudge',
  wait: 'Wait',
  schedule: 'Schedule',
  review_deliverable: 'Review',
};

/** Short verb chip for dense rows. */
export const VERB_CHIP: Record<NbaVerb, string> = {
  send: 'Send',
  start_in_claude: 'Start',
  run_tool: 'Run tool',
  log: 'Log',
  review: 'Review',
  answer: 'Answer',
  confirm_done: 'Confirm',
  nudge: 'Nudge',
  wait: 'Wait',
  schedule: 'Schedule',
  review_deliverable: 'Review',
};

export const KIND_META: Record<WorkKind, { label: string; icon: string }> = {
  task: { label: 'Task', icon: 'task' },
  commitment: { label: 'Said by me', icon: 'chat' },
  ask: { label: 'Asked of me', icon: 'reply' },
  training: { label: 'Training', icon: 'trailhead' },
  follow_up: { label: 'Follow-up', icon: 'forward_up' },
  travel: { label: 'Travel', icon: 'location' },
  deliverable: { label: 'Deliverable', icon: 'file' },
};

export function kindLabel(item: Pick<WorkItem, 'kind' | 'isBackground'>): string {
  return item.kind === 'commitment' && item.isBackground ? 'Promise' : KIND_META[item.kind].label;
}

export const RUN_META: Record<RunState, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'brand' },
  waiting_on_you: { label: 'Waiting on you', tone: 'warn' },
  done_review: { label: 'Done · review', tone: 'brand' },
  done: { label: 'Done', tone: 'ok' },
  failed: { label: 'Failed', tone: 'risk' },
  stale: { label: 'Stale', tone: 'neutral' },
};

export const CONNECTOR_META: Record<ConnectorState, { label: string; tone: Tone }> = {
  ok: { label: 'Connected', tone: 'ok' },
  catching_up: { label: 'Catching up', tone: 'brand' },
  degraded: { label: 'Degraded', tone: 'warn' },
  auth_needed: { label: 'Needs re-auth', tone: 'risk' },
  error: { label: 'Error', tone: 'risk' },
  offline: { label: 'Offline', tone: 'neutral' },
  paused: { label: 'Paused', tone: 'neutral' },
};

export const ACTIVITY_META: Record<ActivityStatus, PillSpec> = {
  upcoming: { tone: 'neutral', label: 'Upcoming' },
  needs_input: { tone: 'warn', label: 'Needs input' },
  proposed: { tone: 'ai', label: 'Proposed', dashed: true },
  approved: { tone: 'brand', label: 'Approved' },
  synced_to_canvas: { tone: 'brand', label: 'Synced to canvas' },
  logged: { tone: 'ok', label: 'Logged in Org62' },
  verified: { tone: 'ok', label: 'Verified' },
  verify_failed: { tone: 'risk', label: 'Verify failed' },
  dismissed: { tone: 'neutral', label: 'Dismissed' },
};

/** States that still need the user (drives row emphasis). */
export const ACTIVE_STATES: ReadonlySet<WorkState> = new Set(['open', 'in_progress', 'waiting_on_me', 'reopened', 'likely_done']);
