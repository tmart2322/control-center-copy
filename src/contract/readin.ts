/**
 * Read-ins (BE-READIN): background research done before Tristan looks at an item, so it is "good to go".
 *
 * One `ReadIn` per entity (a work item or a calendar event). The worker's `readin.generate` job researches it with
 * read-only tools (Slack, Gmail, Drive, Org62, the internal ledger) and writes the record; the suggested reply is an
 * Outbox draft (never sent) linked by `suggestedReply.draftId`.
 *
 *   GET  /readin/:type/:id   → ReadInPayload (readIn null when none was ever requested)
 *   POST /readin/:type/:id   → "Read me in" / Regenerate / Refresh (queues one; a running one is superseded)
 *   live topic `readin`      → ids = [entity id] whenever the state or content changes
 *
 * State: queued → researching → ready | failed; ready → stale when new evidence arrives after `generatedAt` (or the
 * entity's generation moved past `generation`). A refresh keeps the last content visible while it researches.
 */
import { z } from 'zod';
import { Confidence, EntityRef, Id, IsoDateTime, SourceRef } from './common';

export const ReadInState = z.enum(['queued', 'researching', 'ready', 'stale', 'failed']);
export type ReadInState = z.infer<typeof ReadInState>;

export const ReadInEntityType = z.enum(['work_item', 'calendar_event']);
export type ReadInEntityType = z.infer<typeof ReadInEntityType>;

export const ReadInEntity = z.object({ type: ReadInEntityType, id: Id });
export type ReadInEntity = z.infer<typeof ReadInEntity>;

/** Why this read-in was started. Automatic triggers: direct ask, entering the top N, meeting prep missing. */
export const ReadInTrigger = z.enum(['direct_ask', 'top_rank', 'meeting_prep', 'new_evidence', 'on_demand']);
export type ReadInTrigger = z.infer<typeof ReadInTrigger>;

/** One background fact, with where it came from. `source` is the external permalink; `ref` an internal entity. */
export const ReadInBullet = z.object({
  text: z.string().min(1),
  source: SourceRef.nullable().default(null),
  ref: EntityRef.nullable().default(null),
});
export type ReadInBullet = z.infer<typeof ReadInBullet>;

/** "You said before": what Tristan said or committed earlier on this topic. */
export const ReadInHistoryEntry = z.object({
  text: z.string().min(1),
  at: IsoDateTime.nullable().default(null),
  /** A commitment ("I'll send the deck") rather than a statement. */
  commitment: z.boolean().default(false),
  source: SourceRef.nullable().default(null),
  ref: EntityRef.nullable().default(null),
});
export type ReadInHistoryEntry = z.infer<typeof ReadInHistoryEntry>;

export const ReadInQuestion = z.object({
  text: z.string().min(1),
  /** Who can answer: "you" or a person's name. */
  to: z.string().nullable().default(null),
});
export type ReadInQuestion = z.infer<typeof ReadInQuestion>;

/** The suggested reply is an Outbox draft (status ready, never sent from here). */
export const ReadInSuggestedReply = z.object({
  draftId: Id,
  channel: z.enum(['slack', 'email', 'action']),
  /** "#acme-ext · thread", "DM · Dana", "Email · Dana Lee". */
  destinationLabel: z.string(),
  /** First ~280 characters of the draft, plain text. */
  preview: z.string(),
});
export type ReadInSuggestedReply = z.infer<typeof ReadInSuggestedReply>;

/** Researching progress: the step the agent is on, from its tool calls. */
export const ReadInProgress = z.object({
  step: z.enum(['queued', 'ledger', 'slack', 'gmail', 'drive', 'org62', 'writing']),
  label: z.string(), // "Reading the Slack thread"
  done: z.number().int().min(0),
  /** Planned steps (the skill's order); `done` can exceed it when the agent digs further. */
  total: z.number().int().min(1),
});
export type ReadInProgress = z.infer<typeof ReadInProgress>;

export const ReadInError = z.object({
  /** budget · auth · allowlist · timeout · invalid_output · upstream · cancelled · unknown */
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(true),
});
export type ReadInError = z.infer<typeof ReadInError>;

export const ReadIn = z.object({
  entity: ReadInEntity,
  state: ReadInState,
  /** What they're asking, 1–2 lines. Empty until the first read-in is ready. */
  tldr: z.string().default(''),
  background: z.array(ReadInBullet).default([]),
  history: z.array(ReadInHistoryEntry).default([]),
  openQuestions: z.array(ReadInQuestion).default([]),
  suggestedReply: ReadInSuggestedReply.nullable().default(null),
  confidence: Confidence.nullable().default(null),
  /** When the shown content was generated (null before the first one is ready). */
  generatedAt: IsoDateTime.nullable().default(null),
  /** Entity generation (work_items.reeval_generation) the content was computed from. */
  generation: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  sources: z.array(SourceRef).default([]),
  trigger: ReadInTrigger.default('on_demand'),
  model: z.string().nullable().default(null),
  /** `readin-ask@1` */
  skillVersion: z.string().nullable().default(null),
  /**
   * D2: hash of the evidence the content was researched from (the context pack without its clock, rank or trigger).
   * An automatic read-in whose evidence hashes the same is not researched again (llm_decisions: evidence_unchanged).
   */
  evidenceHash: z.string().nullable().default(null),
  /** Set while queued / researching (a refresh keeps the previous content above). */
  progress: ReadInProgress.nullable().default(null),
  /** Set when state is failed, or when the latest refresh failed and older content is still shown. */
  error: ReadInError.nullable().default(null),
  /** Why it is stale: "2 new messages since 09:40". */
  staleReason: z.string().nullable().default(null),
  updatedAt: IsoDateTime,
});
export type ReadIn = z.infer<typeof ReadIn>;

export const ReadInPayload = z.object({
  entity: ReadInEntity,
  readIn: ReadIn.nullable(),
});
export type ReadInPayload = z.infer<typeof ReadInPayload>;

export const ReadInParams = z.object({ type: ReadInEntityType, id: Id });
export type ReadInParams = z.infer<typeof ReadInParams>;

export const RequestReadInRequest = z.object({
  /** Re-research even when a ready read-in is current (Regenerate). */
  force: z.boolean().default(false),
});
export type RequestReadInRequest = z.infer<typeof RequestReadInRequest>;

/** Defaults the engine and settings share. */
export const READIN_DEFAULTS = {
  /** budgets.readinUsdPerDay */
  usdPerDay: 2,
  /** An item entering the top N of the ranking triggers a read-in. */
  topN: 5,
  /** A meeting in the next N hours whose linked items show prep missing. */
  meetingHorizonHours: 24,
  maxTurns: 14,
  costCapUsd: 0.35,
} as const;

/** The read-in models (D2, owner decision 2026-11-13): automatic read-ins run light, Sonnet when the user asks. */
export const READIN_MODELS = { light: 'claude-haiku-5-5', strong: 'claude-sonnet-5-5' } as const;

/**
 * Which model each trigger gets. `on_demand` is the user asking (Read in / Regenerate). Every other trigger is
 * automatic, `direct_ask` included: someone asked the user, the user did not ask for a read-in (128 of 139 read-ins,
 * Nov 9–13). D2's comparison (2026-11-13: 10 real inputs, 7 direct asks and 3 top-ranked, both models, read-only) found
 * the light model agreeing on every ask and state, at about 1/15 of the cost; a trigger where it reads clearly worse
 * goes back to strong here.
 */
export const READIN_MODEL_BY_TRIGGER: Record<ReadInTrigger, keyof typeof READIN_MODELS> = {
  on_demand: 'strong',
  direct_ask: 'light',
  top_rank: 'light',
  meeting_prep: 'light',
  new_evidence: 'light',
};

/** The model a read-in runs on, and why (llm_calls.model_reason). */
export function readInModelFor(trigger: ReadInTrigger): { model: string; reason: string } {
  const tier = READIN_MODEL_BY_TRIGGER[trigger] ?? 'strong';
  return { model: READIN_MODELS[tier], reason: trigger === 'on_demand' ? 'user_asked' : `policy:${trigger}` };
}
