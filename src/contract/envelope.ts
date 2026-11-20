/**
 * Cross-cutting response shapes: errors, mutation results, receipts, audit entries, live events.
 */
import { z } from 'zod';
import { Actor, EntityRef, EntityType, FieldChange, Id, IsoDateTime } from './common';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Error codes and their HTTP status:
 * conflict 409 (stale `ifVersion`; `details.current` carries the server entity) ·
 * validation 400 · not_found 404 · upstream_unavailable 503 (connector/LLM/tool down, or the dev failure switch) ·
 * budget_exceeded 429 (daily hard cap) · dry_run 423 (would leave the machine while dry-run is on and
 * the endpoint cannot render a dry-run payload) · internal 500.
 */
export const ApiErrorCode = z.enum(['conflict', 'validation', 'not_found', 'upstream_unavailable', 'budget_exceeded', 'dry_run', 'internal']);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  conflict: 409,
  validation: 400,
  not_found: 404,
  upstream_unavailable: 503,
  budget_exceeded: 429,
  dry_run: 423,
  internal: 500,
};

export const ApiErrorBody = z.object({
  code: ApiErrorCode,
  message: z.string(),
  retryable: z.boolean(),
  details: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/** Every non-2xx JSON response is exactly this envelope. */
export const ApiErrorEnvelope = z.object({ error: ApiErrorBody });
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>;

// ---------------------------------------------------------------------------
// Receipts and audit
// ---------------------------------------------------------------------------

/** One before → after line in a receipt. Each line is individually undoable via its auditId. */
export const ReceiptChange = z.object({
  auditId: Id,
  entity: EntityRef,
  field: z.string(),
  label: z.string().optional(),
  before: z.unknown(),
  after: z.unknown(),
  /**
   * Undo state (CONTRACT-1). Set on receipts read back from storage (persisted chat parts): when the line's
   * change is currently undone, `undoneAt` is the time and `undoAuditId` the undo entry (undo that = redo).
   * Absent / null = live. Fresh mutation results leave both unset.
   */
  undoneAt: IsoDateTime.nullable().optional(),
  undoAuditId: Id.nullable().optional(),
});
export type ReceiptChange = z.infer<typeof ReceiptChange>;

/** A staged change that did not land on Apply (the rest did): the card line and why (D-58, 2026-11-13). */
export const ReceiptFailure = z.object({ label: z.string(), reason: z.string(), route: z.string().optional() });
export type ReceiptFailure = z.infer<typeof ReceiptFailure>;

/** ReceiptCard payload: what changed, before → after, with per-line Undo and Undo all. */
export const Receipt = z.object({
  id: Id,
  at: IsoDateTime,
  actor: Actor,
  summary: z.string(),
  changes: z.array(ReceiptChange),
  /** True when more than five changes were staged as a preview awaiting Apply (UI-SPEC §6). */
  staged: z.boolean().default(false),
  /**
   * Apply lands what works and lists what failed (a chat card): each failed line with its reason. Absent or empty =
   * everything landed. `total` is how many changes the card held.
   */
  failed: z.array(ReceiptFailure).optional(),
  total: z.number().int().nonnegative().optional(),
});
export type Receipt = z.infer<typeof Receipt>;

/** One audit-log entry (a change set). Undo with POST /audit/:id/undo. */
export const AuditEntry = z.object({
  id: Id,
  at: IsoDateTime,
  actor: Actor,
  action: z.string(), // "item.done", "draft.autosave", "policy.apply", "undo", …
  summary: z.string(),
  entity: EntityRef,
  /** Other entities touched by the same change set. */
  related: z.array(EntityRef).default([]),
  changes: z.array(FieldChange),
  undoable: z.boolean(),
  undoneAt: IsoDateTime.nullable().default(null),
  /** For an undo entry: the audit id it reversed (undoing an undo is redo). */
  undoOf: Id.nullable().default(null),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/**
 * Uniform result of every mutation: the updated entity, the audit id for Undo (null when the change is
 * not undoable, e.g. a read marker), and an optional receipt for chat/engine-style multi-entity changes.
 */
export function MutationResultOf<T extends z.ZodTypeAny>(entity: T) {
  return z.object({
    entity,
    auditId: Id.nullable(),
    receipt: Receipt.optional(),
  });
}
export type MutationResult<T> = { entity: T; auditId: string | null; receipt?: Receipt };

// ---------------------------------------------------------------------------
// Live events (GET /api/v1/events, SSE)
// ---------------------------------------------------------------------------

/**
 * Topics map 1:1 to the first element of TanStack Query keys (see src/client/api.ts `queryKey`).
 * The client invalidates `[topic]` on every LiveEvent.
 */
export const LiveTopic = z.enum([
  'today',
  'home',
  'items',
  'item',
  'initiative',
  'nba',
  'draft',
  'outbox',
  'calendar',
  'agents',
  'tools',
  'tool_run',
  'time',
  'deals',
  'briefs',
  'watches',
  'triage',
  'health',
  'scans',
  'jobs',
  'event_log',
  'settings',
  'policy',
  'chat',
  'since',
  'search',
  'audit',
  'scenario',
  'readin',
  'onboarding',
]);
export type LiveTopic = z.infer<typeof LiveTopic>;

export const LiveNotify = z.object({
  /** Feedback channel hint (UI-SPEC §9). `os` = a macOS notification if the app is not focused. */
  channel: z.enum(['os', 'toast', 'banner', 'rail']),
  title: z.string(),
  body: z.string().optional(),
  tone: z.enum(['ok', 'warn', 'risk', 'brand', 'neutral', 'ai']).default('neutral'),
  href: z.string().optional(),
});
export type LiveNotify = z.infer<typeof LiveNotify>;

export const LiveEvent = z.object({
  /** Monotonic per server process; also used as the SSE `id:`. */
  seq: z.number().int(),
  topic: LiveTopic,
  ids: z.array(Id),
  /** Machine-readable reason: "item.updated", "nba.revised", "connector.broken", "scenario.step", … */
  reason: z.string(),
  at: IsoDateTime,
  entityType: EntityType.optional(),
  /** Set when a scenario step caused the change (dev toolbar shows it). */
  scenarioStepId: z.string().optional(),
  notify: LiveNotify.optional(),
});
export type LiveEvent = z.infer<typeof LiveEvent>;

/** First SSE message on connect (`event: hello`). */
export const LiveHello = z.object({
  at: IsoDateTime,
  seq: z.number().int(),
  dataSource: z.enum(['mock', 'db']),
});
export type LiveHello = z.infer<typeof LiveHello>;

export { EntityType };
