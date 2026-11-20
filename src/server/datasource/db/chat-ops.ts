/**
 * Chat ops in db mode: what a chat backend (BE-6) may read and change. The async twin of the mock's
 * `ChatOps` (src/server/datasource/mock/chat-runtime.ts), with the same CONTRACT-1 rules:
 * - every change is one change set with actor `chat` (actions chat.edit, chat.resolve, chat.capture,
 *   chat.note, chat.move, chat.scan, policy.apply) and is undoable through its auditId;
 * - chat never adds `userLockedFields` (only user edits lock);
 * - a chat write to a field the user locked does not land: it becomes a proposal (Apply / Keep mine).
 */
import type {
  Asset,
  CalendarEvent,
  ChatResource,
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
import type { z } from 'zod';

export interface DbChatPatchResult {
  item: WorkItem;
  /** The applied part (null when nothing landed). */
  receipt: Receipt | null;
  /** One per user-locked field the patch touched. */
  proposals: Proposal[];
}

export interface DbChatOps {
  // ---- reads ----
  topItems(n: number): Promise<WorkItem[]>;
  findItem(query: string): Promise<WorkItem | null>;
  listItems(query?: z.input<typeof ItemsQuery>): Promise<WorkItem[]>;
  calendarToday(): Promise<CalendarEvent[]>;
  settings(): Promise<Settings>;
  findAssets(query: string): Promise<Asset[]>;
  resourceForAsset(asset: Asset): ChatResource;
  resourceForItem(item: WorkItem): ChatResource;

  // ---- changes (actor `chat`) ----
  moveToTop(itemId: string, reason: string): Promise<Receipt>;
  addNote(itemId: string, note: string): Promise<Receipt>;
  patchItem(itemId: string, patch: WorkItemPatch, reason: string): Promise<DbChatPatchResult>;
  resolveItem(itemId: string, resolution: Resolution, detail?: Partial<Omit<ResolutionDetail, 'inferred'>>, note?: string): Promise<DbChatPatchResult>;
  capture(text: string, opts?: { accountId?: string; initiativeId?: string; due?: string }): Promise<{ item: WorkItem; receipt: Receipt }>;
  scan(connectorId: string, scope: string): Promise<{ ok: boolean; summary: string; run: ScanRun | null }>;
  policyPreview(weightDeltas: Partial<PolicyWeights>): Promise<PolicyPreview>;
  policyApply(weightDeltas: Partial<PolicyWeights>, note: string): Promise<{ receipt: Receipt; preview: PolicyPreview }>;

  // ---- staged (Apply / Keep mine) ----
  proposeItemPatch(itemId: string, patch: WorkItemPatch, reason: string): Promise<Proposal>;
}
