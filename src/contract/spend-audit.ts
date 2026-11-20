/**
 * Spend & decisions (D0, audit 2026-11-13): every model call the app made in a period, by day, skill, model and
 * trigger, with tokens (cache included), cache hit rate and identical repeats; and every decision NOT to call the model
 * (or to escalate, or a call a budget refused), with its reason. Health ▸ Spend ▸ Spend & decisions shows it, CSV
 * exports it, `npm run scan:report` prints it. The rows are the audit trail: see SPEND_AUDIT_RETENTION.
 */
import { z } from 'zod';

import { IsoDate, IsoDateTime } from './common';

/** How long the audit trail is kept (D0 proposal for lane E's retention): call and decision rows a year and a month, then daily roll-ups. */
export const SPEND_AUDIT_RETENTION = { keepDays: 400, rollUpAfterDays: 400 } as const;

/** The longest period one view or export covers. A real limit of the view, not of the data: page by period. */
export const SPEND_AUDIT_MAX_DAYS = 92;

export const SpendAuditQuery = z.object({
  /** First local day (YYYY-MM-DD); default 6 days before `to`. */
  from: IsoDate.optional(),
  /** Last local day; default today. */
  to: IsoDate.optional(),
});
export type SpendAuditQuery = z.infer<typeof SpendAuditQuery>;

const Tokens = {
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
};

/** One breakdown line (a day, a skill, a model, a trigger). `cacheHitPct`: cache reads over all prompt tokens. */
export const SpendSlice = z.object({ key: z.string(), usd: z.number(), calls: z.number().int(), ...Tokens, cacheHitPct: z.number().nullable() });
export type SpendSlice = z.infer<typeof SpendSlice>;

/** Calls grouped by day × skill × model × trigger × why-that-model × budget. */
export const SpendAuditRow = z.object({
  day: IsoDate,
  skill: z.string(),
  model: z.string(),
  /** null on rows booked before D0 (Nov 13, 2026). */
  trigger: z.string().nullable(),
  modelReason: z.string().nullable(),
  budget: z.enum(['daily', 'first_scan']),
  usd: z.number(),
  calls: z.number().int(),
  ...Tokens,
  /** Dollars on calls with no tokens at all (rows from before the D0 fix). */
  untokenizedUsd: z.number(),
});
export type SpendAuditRow = z.infer<typeof SpendAuditRow>;

export const DecisionKind = z.enum(['skip', 'escalate', 'block']);
export type DecisionKind = z.infer<typeof DecisionKind>;

/** Decisions grouped by day × skill × kind × reason × trigger. */
export const DecisionRow = z.object({
  day: IsoDate,
  skill: z.string(),
  kind: DecisionKind,
  reason: z.string(),
  trigger: z.string(),
  count: z.number().int(),
  /** escalate: what the extra calls cost; skip / block: 0 (see estSavedUsd). */
  usd: z.number(),
  /** skip / block: count × the skill's average call cost in the period (an estimate). */
  estSavedUsd: z.number(),
});
export type DecisionRow = z.infer<typeof DecisionRow>;

export const SpendAuditPayload = z.object({
  from: IsoDate,
  to: IsoDate,
  timezone: z.string(),
  totals: z.object({
    usd: z.number(),
    calls: z.number().int(),
    ...Tokens,
    cacheHitPct: z.number().nullable(),
    /** Calls (and their dollars) with no tokens recorded. */
    untokenizedCalls: z.number().int(),
    untokenizedUsd: z.number(),
    /** Calls whose prompt and input were identical to an earlier call in the period, and what they cost. */
    repeatCalls: z.number().int(),
    repeatUsd: z.number(),
    /** Calls booked before the D0 fields existed (no trigger or no model reason). */
    unattributedCalls: z.number().int(),
  }),
  byDay: z.array(SpendSlice),
  bySkill: z.array(SpendSlice),
  byModel: z.array(SpendSlice),
  byTrigger: z.array(SpendSlice),
  rows: z.array(SpendAuditRow),
  decisions: z.array(DecisionRow),
  decisionTotals: z.object({ skips: z.number().int(), blocks: z.number().int(), escalations: z.number().int(), estSavedUsd: z.number() }),
  /** D4: how often Settle's stronger-model escalation changed the cheap verdict. */
  settleEscalation: z.object({ escalated: z.number().int(), changed: z.number().int(), same: z.number().int(), invalid: z.number().int(), changedPct: z.number().nullable(), extraUsd: z.number() }),
  retention: z.object({ keepDays: z.number().int(), rollUpAfterDays: z.number().int() }),
  /** Mock mode: placeholder numbers made from the seed's spend (nothing was called). */
  simulated: z.boolean().default(false),
});
export type SpendAuditPayload = z.infer<typeof SpendAuditPayload>;

export const SpendAuditDetailQuery = z.object({
  day: IsoDate,
  /** One skill (as in SpendAuditRow.skill); all skills when absent. */
  skill: z.string().min(1).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type SpendAuditDetailQuery = z.infer<typeof SpendAuditDetailQuery>;

export const SpendAuditCall = z.object({
  id: z.string(),
  at: IsoDateTime,
  skill: z.string(),
  purpose: z.string(),
  model: z.string(),
  trigger: z.string().nullable(),
  modelReason: z.string().nullable(),
  status: z.string(),
  outcome: z.string().nullable(),
  budget: z.enum(['daily', 'first_scan']),
  usd: z.number(),
  ...Tokens,
  contentHash: z.string().nullable(),
  /** The earlier call with the same content hash (an identical repeat), if any. */
  repeatOf: z.string().nullable(),
  jobId: z.string().nullable(),
  scanRunId: z.string().nullable(),
});
export type SpendAuditCall = z.infer<typeof SpendAuditCall>;

export const SpendAuditDecision = z.object({
  id: z.string(),
  firstAt: IsoDateTime,
  lastAt: IsoDateTime,
  skill: z.string(),
  kind: DecisionKind,
  reason: z.string(),
  trigger: z.string(),
  /** An id (work item, Claude session, scan scope); never content. */
  subject: z.string(),
  count: z.number().int(),
  usd: z.number(),
  /** ids, counts and codes only */
  detail: z.record(z.unknown()),
});
export type SpendAuditDecision = z.infer<typeof SpendAuditDecision>;

export const SpendAuditDetail = z.object({
  day: IsoDate,
  skill: z.string().nullable(),
  calls: z.array(SpendAuditCall),
  totalCalls: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
  decisions: z.array(SpendAuditDecision),
  simulated: z.boolean().default(false),
});
export type SpendAuditDetail = z.infer<typeof SpendAuditDetail>;

/** Plain words for each decision reason (the codes in llm_decisions.reason). */
export const DECISION_REASONS: Record<string, string> = {
  evidence_unchanged: 'Read-in not run: nothing new since the last one',
  readin_cap: "Read-in held: today's read-in budget is used",
  hard_cap: "Held: today's hard cap is reached",
  hard_cap_reserve: "Held: calls already running hold the rest of today's hard cap",
  status_only: 'Claude session: only its live status changed (busy, idle)',
  unlinked_content: 'Claude session: new content, not linked to an open item',
  min_interval: 'Claude session: the model looked less than 5 min ago (waits)',
  precheck_empty: 'Slack poll not run: the pre-check found nothing new',
  verdict_changed: 'Settle escalation changed the verdict',
  verdict_same: 'Settle escalation kept the verdict',
  stronger_invalid: 'Settle escalation gave no usable answer',
  stronger_day_cap: "Settle escalation held: today's allowance is used",
  escalation_day_cap: "Slack triage escalation held: today's allowance is used",
};

export const decisionLabel = (reason: string) => DECISION_REASONS[reason] ?? reason.replace(/_/g, ' ');

/** Plain words for what started a call. */
export const TRIGGER_LABELS: Record<string, string> = {
  schedule: 'Schedule',
  file_watch: 'File watch',
  manual: 'You: Rescan',
  chat: 'Assistant',
  user_action: 'You asked',
  on_demand: 'You asked for a read-in',
  direct_ask: 'Someone asked you',
  top_rank: 'Top of your ranking',
  meeting_prep: 'Meeting prep',
  new_evidence: 'New evidence',
  interval: 'Interval',
  first_scan: 'First scan',
  reconcile: 'Reconcile',
  startup_catchup: 'Catch-up after a restart',
  catch_up: 'Catch-up',
  scan: 'After a scan',
  follow_up: 'Follow-up',
  daily: 'Daily',
};

export const triggerLabel = (t: string | null) => (t == null ? 'Not recorded (before Nov 13)' : (TRIGGER_LABELS[t] ?? t.replace(/_/g, ' ')));

/** Plain words for why a model was used. */
export function modelReasonLabel(r: string | null): string {
  if (r == null) return 'Not recorded (before Nov 13)';
  if (r === 'default') return "The skill's model";
  if (r === 'user_asked') return 'You asked (stronger model)';
  if (r === 'override') return 'Override';
  if (r.startsWith('escalation:')) return `Escalation: ${r.slice('escalation:'.length).replace(/_/g, ' ')} first answer`;
  if (r.startsWith('policy:')) return `Per-trigger choice (${triggerLabel(r.slice('policy:'.length))})`;
  return r;
}
