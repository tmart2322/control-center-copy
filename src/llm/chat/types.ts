/**
 * BE-CHAT (BE-6) types shared by the chat runner, its tools, the turn loop and both DataSources.
 *
 * The runner yields `ChatRunStep`s; the turn loop (src/server/chat/turn.ts) turns them into SSE events and
 * persisted parts. Tools read and stage changes through a `ChatHost`, which each DataSource implements
 * (mock: in-memory store; db: Postgres). The host never sends, posts or writes to an external system:
 * changes are staged as proposals (applied only by the user's Apply), drafts stop in the Outbox, scans
 * are enqueued for the worker, and sessions are deep links the UI opens only on a click.
 */
import type { ResolvedPersona } from '@/personas';
import type {
  ChatChange,
  ChatDraftRef,
  ChatMessage,
  ChatModel,
  ChatResource,
  ChatScan,
  ChatSession,
  ChatUsage,
  ContextRef,
  EntityRef,
  FieldChange,
  Proposal,
  Receipt,
  SourceKind,
  StageLogBatchResult,
  DraftVdpUpdateRequest,
  FindVdpAssetsRequest,
  FindVdpAssetsResult,
} from '@/contract';
import type { Org62LookupInput, Org62LookupResult } from '@/server/chat/org62';
import type { ChatReadPage, ChatReadResult, ReadPageArgs, ReadPageInfo } from '@/server/chat/read';
import type { ChatResearchInput, ChatResearchResult } from '@/server/chat/research';

export interface Org62LookupUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  status: 'ok' | 'error' | 'timeout';
  errorCode?: string;
  latencyMs: number;
}

/** What the runner (or a scripted backend) emits for one turn. A superset of the mock's ChatStep. */
export type ChatRunStep =
  | { type: 'text'; text: string }
  /** `id` pairs a start with its result (parallel tool calls); `args` is persisted credential-redacted. */
  | { type: 'tool-start'; id?: string; name: string; summary: string; args?: unknown }
  | { type: 'tool-result'; id?: string; summary: string; ok?: boolean; result?: unknown }
  | { type: 'receipt'; receipt: Receipt }
  | { type: 'proposal'; proposal: Proposal; summary: string; changes?: ChatChange[] }
  | { type: 'resource'; resource: ChatResource }
  /** A running tool's progress (chat-started scans); `id` is the tool-start's. */
  | { type: 'tool-progress'; id: string; done: number; total: number }
  | { type: 'draft'; draft: ChatDraftRef }
  | { type: 'session'; session: ChatSession }
  /** Tokens and cost of the turn (stored on the assistant message; the ledger row is the host's job). */
  | { type: 'usage'; usage: ChatUsage }
  | { type: 'error'; code: 'validation' | 'upstream_unavailable' | 'internal' | 'budget_exceeded'; message: string; retryable?: boolean; details?: ChatErrorDetails };

/** One item as the tools show it to the model (compact, no bodies). */
export interface ChatItemHit {
  id: string;
  title: string;
  kind: string;
  state: string;
  rank: number | null;
  due: string | null;
  startBy: string | null;
  snoozedUntil: string | null;
  account: string | null;
  why: string;
  topReasons: string[];
  locked: string[];
  /** The item's version (a patchItem's ifVersion). */
  version?: number;
}

/** A source found in the ledger or through a read-only connector lookup. */
export interface ChatSourceHit {
  source: SourceKind | 'ledger';
  kind: string;
  title: string;
  excerpt: string;
  url: string | null;
  externalId: string | null;
  at: string | null;
  /** Work item the source is evidence for, when known. */
  workItemId: string | null;
  workItemTitle: string | null;
}

export type ChatSourceName = 'ledger' | 'gmail' | 'drive';

/** D-58: the live Google reads the Assistant calls directly (the research run's handlers, src/llm/research/tools.ts). */
export type ChatGoogleTool = 'gmail_search' | 'gmail_thread' | 'drive_search' | 'drive_read' | 'calendar_events';

export interface ChatBudget {
  /** Spent on chat today (owner timezone day). */
  chatTodayUsd: number;
  /** Chat's own daily line. */
  chatDailyUsd: number;
  /** All LLM spend today vs the hard cap (settings.budgets). */
  totalTodayUsd: number;
  hardCapUsd: number;
  /** Cap for one message (one turn). */
  perMessageUsd: number;
  maxTurns: number;
  /** Cap for one chat_research run (settings.chat.researchUsd). */
  researchUsd?: number;
}

export interface ChatUsageRecord {
  threadId: string;
  messageId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  /** True when cost came from the rate card (no result message: aborted / capped). */
  estimated: boolean;
  status: 'ok' | 'error' | 'timeout' | 'budget_blocked';
  errorCode?: string;
  latencyMs: number;
  /** A sub-call a tool made for this message (e.g. `read-lookup@1` for the Org62 lookup); default the chat skill. */
  skill?: string;
}

export interface StageInput {
  threadId: string;
  messageId: string;
  changes: ChatChange[];
  lines: FieldChange[];
  entity: EntityRef;
  reason: string;
}

export interface DraftInput {
  channel: 'slack' | 'email';
  to: string;
  threadRef?: string;
  subject?: string;
  intent: string;
  body?: string;
  workItemId?: string;
  threadId: string;
}

export interface SessionInput {
  repo: string;
  prompt: string;
  title?: string;
  workItemId?: string;
  threadId: string;
}

/** A preview of a change list: the display lines, the entity the card names, and what can't apply. */
export interface ChangePreview {
  lines: FieldChange[];
  entity: EntityRef;
  errors: string[];
  /** Normalized changes (ids resolved, deltas clamped). */
  changes: ChatChange[];
}

/** Everything the chat tools may do. Implemented per DataSource; never sends anything outside the app. */
export interface ChatHost {
  readonly kind: 'mock' | 'db';
  now(): Date;
  timezone(): Promise<string>;

  // ---- reads ----
  /** The compact context pack (today, ranked items, calendar, outbox, health, policy). */
  contextPack(): Promise<Record<string, unknown>>;
  /** D-55: the user's persona; the turn's tool list, read pages, app routes and SOQL objects follow it (absent: every tool, as before personas). */
  persona?(): Promise<ResolvedPersona>;
  searchSources(query: string, opts: { sources: ChatSourceName[]; limit: number; signal?: AbortSignal }): Promise<{ hits: ChatSourceHit[]; notes: string[] }>;
  /** Live, read-only Org62 search (opportunities or accounts), matched to the app's ids (src/server/chat/org62.ts). */
  org62Lookup(input: Org62LookupInput, signal?: AbortSignal): Promise<Org62LookupResult & { usage?: Org62LookupUsage }>;
  /** Deep research for one question across live Slack, Gmail, Calendar, Drive and Org62 (src/server/chat/research.ts). */
  research(input: ChatResearchInput, o: { costCapUsd: number; signal: AbortSignal; onTool?: (fullName: string) => void }): Promise<ChatResearchResult>;
  /**
   * The next logging batch (src/server/datasource/db/store/log-batch.ts): the work orders Slackbot would run, the rows
   * that need input, and the Org62 check. Read only: staging the canvas is an Outbox action.
   */
  logBatch(input: { from?: string; to?: string; includeProposed?: boolean }): Promise<ChatLogBatch>;
  /** "Find assets": background research runs per VDP (or all, within a total cap) → asset candidates; never writes VDP. */
  findVdpAssets(input: FindVdpAssetsRequest): Promise<FindVdpAssetsResult>;
  /** One VDP field change → one Outbox item (ready; sent to VDP only on its own Apply). */
  draftVdpUpdate(input: DraftVdpUpdateRequest): Promise<{ draftId: string; target: string; changes: Array<{ label: string; before: string | number | null; after: string | number | null }> }>;
  /** Stage that batch: one Outbox canvas item per work order (ready; each sent only on its own Apply). */
  stageLogBatch(input: { from?: string; to?: string; includeProposed?: boolean; dcOnly?: boolean }): Promise<StageLogBatchResult>;
  /**
   * Start a connector's sign-in, exactly as Health ▸ Re-auth does (POST /connectors/:id/reauth): for VDP and Org62 a
   * Terminal and browser window open on this machine for the user's MFA; the worker re-probes and catches up.
   */
  reauth(source: string): Promise<{ found: boolean; label?: string; state?: string; started?: boolean; how?: string }>;
  /** A page of the app (src/server/chat/read.ts): one read-only route, shaped for the model and paged (never cut). */
  read(page: ChatReadPage, args: Record<string, unknown>, paging?: ReadPageArgs): Promise<ChatReadResult>;
  /** D-58: any `read` route of the app's API (src/server/chat/app-routes.ts), checked by its own schemas, paged. */
  appRead(route: string, raw: { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown }, paging?: ReadPageArgs): Promise<{ route: string; data: unknown; paging: ReadPageInfo | null; more?: Record<string, { shown: number; total: number; nextOffset: number }>; summary: string }>;
  /**
   * D-58: live Gmail, Drive and Calendar reads through the read-only Google client (db + live connectors only; elsewhere
   * a note that they aren't available). Redacted and capped.
   */
  googleRead(tool: ChatGoogleTool, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; ok: boolean; available: boolean }>;
  /**
   * D-58: the scanners' Slack and Org62 MCP servers load into the turn (db + live connectors only). The mock never
   * calls out, so it says false.
   */
  readonly liveReads: boolean;
  /** Earlier messages of the thread, oldest first (without `excludeIds`). */
  history(threadId: string, excludeIds: string[]): Promise<ChatMessage[]>;

  // ---- staged changes (nothing lands until the user applies) ----
  previewChanges(changes: ChatChange[], threadId?: string): Promise<ChangePreview>;
  stageChanges(input: StageInput): Promise<Proposal>;

  // ---- in-app side effects (never external) ----
  rescan(connector: string, windowHours: number): Promise<ChatScan>;
  scanStatus(scanId: string): Promise<ChatScan | null>;
  createDraft(input: DraftInput): Promise<ChatDraftRef>;
  prepareSession(input: SessionInput): Promise<ChatSession>;

  // ---- spend ----
  budget(model: ChatModel): Promise<ChatBudget>;
  recordUsage(u: ChatUsageRecord): Promise<void>;
}

/** A logging batch preview for the Assistant (counts, canvases, skips, the Org62 check). */
export interface ChatLogBatch {
  available: boolean;
  note?: string;
  mode?: 'on_demand' | 'automatic';
  canvasStyle?: 'per_batch' | 'shared';
  events: number;
  hours: number;
  updates: number;
  approveCount: number;
  canvases: Array<{ part: number; parts: number; title: string; rows: number; hours: number; updates: number; chars: number; preview: string }>;
  skipped: Array<{ id: string; date: string; description: string; why: string }>;
  /** Rows an earlier batch's canvas item still holds in the Outbox (not in this batch until it is Applied or rejected). */
  waiting?: { rows: number; hours: number; draftIds: string[] };
  discrepancies: Array<{ id: string; date: string; description: string; kind: string; detail: string }>;
  recordTypeKnown: boolean;
  ownerKnown: boolean;
  /** Logging canvases already applied, newest first: created in Slack (unless still applying), with the link and the rows' Org62 state. */
  applied?: Array<{ draftId: string; title: string; state: string; created: boolean; url: string | null; appliedAt: string | null; rows: number; hours: number; dcs: number; org62: { logged: number; waiting: number; missing: number } | null }>;
}

/** What a capped message offers: re-send it with `allowExtraUsd: usd` (the UI's "Allow $x more"). */
export interface ChatErrorDetails {
  allowMore?: { usd: number; scope: 'message' | 'day' };
}

/** Input of one turn. */
export interface ChatTurnInput {
  threadId: string;
  messageId: string;
  userMessageId: string;
  text: string;
  /** Message chips plus the thread's context (the "Looking at:" chip is the first `auto` one). */
  context: ContextRef[];
  model: ChatModel;
  signal: AbortSignal;
  /** The user's one-time approval to spend this much more on this message (ChatRequest.allowExtraUsd). */
  allowExtraUsd?: number;
}

/** A chat backend: one turn → steps. The fake and the Agent SDK runner both have this shape. */
export type ChatTurnRunner = (input: ChatTurnInput, host: ChatHost) => AsyncIterable<ChatRunStep>;
