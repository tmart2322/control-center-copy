/**
 * Internal backend seams for the BE lanes. Interfaces only: BE-1 implements the DB-backed versions
 * (Postgres job queue with SKIP LOCKED, audit via change sets, LISTEN/NOTIFY event bus), BE-2 implements
 * LlmRunner over the Claude Agent SDK. The mock DataSource has in-memory equivalents.
 *
 * Rules that hold for every implementation:
 * - Nothing here sends to an external system. Outbound work stops at a draft or dry-run payload.
 * - Never log or persist tokens, cookies or passwords; redact credential-like text in source bodies.
 */
import type { Actor, EntityRef, FieldChange, LiveEvent, SourceKind } from '@/contract';

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

/** Injectable time source (tests and the mock scenario clock control it). */
export interface Clock {
  now(): Date;
}

// ---------------------------------------------------------------------------
// Source items (connectors → normalized store)
// ---------------------------------------------------------------------------

export interface SourceProvenance {
  source: SourceKind;
  /** Connector-specific scope: "dms_to_me", "#acme-ext", "inbox", file id. */
  scope: string;
  /** Scan run that saw this item (scan ledger, R-BE-3). */
  scanRunId: string;
  /** URL to open the item in its source (`o`). */
  url?: string;
  /** Raw tool name that produced it (allowlisted read tool). */
  tool?: string;
}

export interface NormalizedSourceItem {
  /** Stable dedupe key, e.g. `slack:<channel>:<ts>`, `gmail:<messageId>`, `drive:<fileId>:<modifiedTime>`. */
  dedupeKey: string;
  externalId: string;
  kind: 'message' | 'email' | 'event' | 'file_revision' | 'note' | 'record' | 'session';
  occurredAt: Date;
  author?: { id?: string; name: string; isMe?: boolean };
  title?: string;
  /** Redacted text body (no secrets). */
  text?: string;
  /** Hash of the content used for unchanged/changed detection. */
  contentHash: string;
  provenance: SourceProvenance;
  /** Thread/parent linkage (Slack thread_ts, Gmail threadId, Drive file id). */
  threadKey?: string;
  raw?: Record<string, unknown>;
}

export interface UpsertResult {
  id: string;
  action: 'new' | 'changed' | 'unchanged';
}

/** Where connectors write. Idempotent on dedupeKey; re-runs produce `unchanged`. */
export interface SourceItemSink {
  upsert(items: NormalizedSourceItem[]): Promise<UpsertResult[]>;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface EnqueueOptions {
  /** At most one queued job per key; a newer enqueue coalesces (merges generation, debounces runAt). */
  dedupeKey?: string;
  /** Exactly-once key across retries. */
  idempotencyKey?: string;
  /** Fencing token: a job whose generation is older than its entity's writes nothing (R-UI-20). */
  generation?: number;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
}

export interface JobRecord<P = unknown> {
  id: string;
  type: string;
  payload: P;
  attempts: number;
  generation: number | null;
  dedupeKey: string | null;
  /** Aborted when cancel is requested (superseded generation or user cancel). */
  signal: AbortSignal;
}

export interface JobQueue {
  enqueue<P>(type: string, payload: P, opts?: EnqueueOptions): Promise<{ id: string; coalesced: boolean }>;
  /** Request cancellation (running jobs see `signal.aborted`; queued jobs are cancelled). */
  cancel(jobIdOrDedupeKey: string, reason: string): Promise<void>;
  /** Lease the next runnable job of the given types (SKIP LOCKED semantics). */
  claim(workerId: string, types: string[], leaseMs: number): Promise<JobRecord | null>;
  complete(jobId: string, result?: unknown): Promise<void>;
  /** Retryable errors back off; non-retryable or exhausted go to `dead`. */
  fail(jobId: string, error: { class: 'transient' | 'rate_limited' | 'validation' | 'bug' | 'auth'; message: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Live events
// ---------------------------------------------------------------------------

export type LiveEventInput = Omit<LiveEvent, 'seq' | 'at'> & { at?: string };

/** Fan-out of invalidation events to open views (SSE). */
export interface EventBus {
  publish(event: LiveEventInput): LiveEvent;
  subscribe(listener: (event: LiveEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// LLM runner
// ---------------------------------------------------------------------------

export interface LlmStepRequest {
  /** "haiku" for scanners/classify/link; "sonnet" for NBA, drafts, chat (switchable to "opus"). */
  model: 'haiku' | 'sonnet' | 'opus' | (string & {});
  /** Skill / stage name for the spend ledger ("scan.slack", "nba.generate"). */
  stage: string;
  systemPrompt: string;
  prompt: string;
  /** Read-only tool allowlist (e.g. "mcp__slack__slack_read_thread"). The wrapper denies everything else. */
  allowedTools: string[];
  /** Single-server MCP config to load (restricted, read tools only). */
  mcpConfig?: Record<string, unknown>;
  /** JSON Schema the final output must validate against before any DB write. */
  outputSchema?: Record<string, unknown>;
  maxTurns?: number;
  signal?: AbortSignal;
}

export interface LlmStepResult<T = unknown> {
  ok: boolean;
  /** Parsed, schema-validated output. */
  output: T | null;
  /** Raw tool results captured by hooks (deterministic parsing happens downstream). */
  toolResults: Array<{ tool: string; result: unknown }>;
  costUsd: number;
  tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  model: string;
  error?: { class: 'auth' | 'transient' | 'rate_limited' | 'budget_exceeded' | 'validation' | 'bug'; message: string };
}

export interface LlmRunner {
  run<T = unknown>(req: LlmStepRequest): Promise<LlmStepResult<T>>;
}

// ---------------------------------------------------------------------------
// Audit / undo
// ---------------------------------------------------------------------------

export interface AuditRecordInput {
  actor: Actor;
  action: string;
  summary: string;
  entity: EntityRef;
  related?: EntityRef[];
  changes: FieldChange[];
  /** Opaque payload that reverses the change (row images, previous doc revision, …). */
  inverse: unknown;
  undoable?: boolean;
  /** Autosave bursts coalesce into one entry per key while idle < ~30 s. */
  coalesceKey?: string;
}

export interface AuditLog {
  record(input: AuditRecordInput): Promise<{ auditId: string }>;
  /** Applies the inverse as a new change set (kind `undo`); undoing an undo is redo. Throws conflict if changed since. */
  undo(auditId: string, actor: Actor): Promise<{ auditId: string; restored: EntityRef[] }>;
}
