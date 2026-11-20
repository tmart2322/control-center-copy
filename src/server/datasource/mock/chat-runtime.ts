/**
 * Types shared by the mock chat runtime and the scripted responder (src/mock/chat-script.ts, FE-3 extends it).
 * Scripts are async generators that yield ChatSteps; the runtime turns them into ChatSseEvents and
 * persists the assistant message (every part: tool rows with redacted args/results, receipts, proposals,
 * resources, errors). Mutations go through ChatOps so every change has an audit id (Undo).
 *
 * ChatOps rules (CONTRACT-1), which the DB-backed chat must keep too:
 * - every mutation is audited with actor `chat`, never `user`, and is undoable via its auditId;
 * - chat never adds fields to `userLockedFields` (only user edits lock);
 * - a chat write to a field the user already locked does not land: it becomes a Proposal (Apply / Keep mine).
 */
import type {
  Asset,
  CalendarEvent,
  ChatModel,
  ChatResource,
  ContextRef,
  ItemsQuery,
  PolicyPreview,
  PolicyWeights,
  Proposal,
  Receipt,
  Resolution,
  ResolutionDetail,
  ScanRun,
  Settings,
  WorkItem,
  WorkItemPatch,
} from '@/contract';
import type { ChatRunStep } from '@/llm/chat/types';
import type { z } from 'zod';

/**
 * One step of a turn. BE-CHAT widened it to the runner's `ChatRunStep` (adds tool ids, proposal
 * `changes`, scan / draft / session cards, usage, budget_exceeded); the scripted demos use the original
 * subset: text, tool-start `{name, summary, args?}`, tool-result `{summary, ok?, result?}` (args/results are
 * persisted credential-redacted), receipt, proposal, resource, error.
 */
export type ChatStep = ChatRunStep;

/** Result of a chat field edit: the applied part (null when nothing landed) and proposals for locked fields. */
export interface ChatPatchResult {
  item: WorkItem;
  receipt: Receipt | null;
  /** One per user-locked field the patch touched (Apply / Keep mine). */
  proposals: Proposal[];
}

export interface ChatOps {
  // ---- reads ----
  /** Current NOW + more-today ordering. */
  topItems(n: number): WorkItem[];
  /** Fuzzy find by id or title words. */
  findItem(query: string): WorkItem | null;
  /** The Work list for a tab + filters (same as GET /items), e.g. `{ tab: 'promises' }`. */
  listItems(query?: z.input<typeof ItemsQuery>): WorkItem[];
  /** Today's calendar events (in the mock clock's day), start order. */
  calendarToday(): CalendarEvent[];
  settings(): Settings;
  findAssets(query: string): Asset[];
  resourceForAsset(asset: Asset): ChatResource;
  resourceForItem(item: WorkItem): ChatResource;

  // ---- real, undoable changes (actor `chat`) ----
  /** Bump an item to #1 (signals.boost + re-rank). */
  moveToTop(itemId: string, reason: string): Receipt;
  /** Append a note to an item. */
  addNote(itemId: string, note: string): Receipt;
  /** Edit fields (startBy, due, effort…). No locks are added; user-locked fields become proposals. */
  patchItem(itemId: string, patch: WorkItemPatch, reason: string): ChatPatchResult;
  /** Close an item with an R-UI-22 resolution (handed_off needs detail.personName or personId). */
  resolveItem(itemId: string, resolution: Resolution, detail?: Partial<Omit<ResolutionDetail, 'inferred'>>, note?: string): ChatPatchResult;
  /** Quick capture from chat (same parsing as POST /items; `~30m`, `#account`). */
  capture(text: string, opts?: { accountId?: string; initiativeId?: string; due?: string }): { item: WorkItem; receipt: Receipt };
  /** Start a connector scan (simulated in the mock). `ok: false` when the connector needs re-auth. */
  scan(connectorId: string, scope: string): { ok: boolean; summary: string; run: ScanRun | null };
  /** Apply weight deltas (clamped 0–10) as a new policy version + visible re-rank. */
  policyApply(weightDeltas: Partial<PolicyWeights>, note: string): { receipt: Receipt; preview: PolicyPreview };

  // ---- previews and staged changes (no audit entry until applied) ----
  /** Re-rank preview for weight deltas (clamped 0–10); changes nothing. */
  policyPreview(weightDeltas: Partial<PolicyWeights>): PolicyPreview;
  /** Stage a field change for Apply / Keep mine. */
  proposeItemPatch(itemId: string, patch: WorkItemPatch, reason: string): Proposal;
  /** Stage a policy change (weight deltas, clamped to 0–10); apply via POST /proposals/:id/apply. */
  proposePolicy(weightDeltas: Partial<PolicyWeights>, note: string): { proposal: Proposal; preview: PolicyPreview };
}

export interface ChatScriptContext {
  text: string;
  /** Message chips plus the thread's own context (as `auto`). */
  context: ContextRef[];
  threadId: string;
  now: Date;
  /** The model answering this turn (always set by the runtime). */
  model?: ChatModel;
  ops: ChatOps;
}

export interface ChatScript {
  id: string;
  description: string;
  /** First matching script wins; put specific scripts before the default. */
  match(text: string, ctx: ChatScriptContext): boolean;
  run(ctx: ChatScriptContext): AsyncGenerator<ChatStep, void, void>;
}
