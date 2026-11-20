/**
 * Chat view models shared by the stream hook (src/client/chat) and the dock UI (src/components/chat).
 * Server shapes come from the contract; these add what only the client knows (streaming, tool args,
 * local errors, optimistic turns).
 */
import type { ApiErrorBody, ChatMessage, ChatResource, ChatSseEventType, ContextRef, Proposal, Receipt } from '@/contract';

export interface ChatToolView {
  id: string;
  name: string;
  /** tool-start summary (what it set out to do; shown as "args" when expanded). Null for persisted rows. */
  startSummary: string | null;
  /** Latest human summary (tool-result replaces tool-start). */
  summary: string;
  /** null = still running. */
  ok: boolean | null;
  /** BE-CHAT: the latest tool-progress (chat-started scans), if any. */
  progress?: { done: number; total: number };
}

export interface ChatProposalView {
  proposal: Proposal;
  /** SSE `proposal.summary` ("Shave 5 minutes off the estimate?"); null for persisted parts. */
  summary: string | null;
  /**
   * 2026-11-13 audit C8: an applied card read back after a reload carries its receipt here (the server stores it right
   * after the card), so the thread shows ONE card (the receipt in place), never the card plus a second receipt card.
   */
  receipt?: Receipt;
}

export type ChatTurnStatus = 'connecting' | 'streaming' | 'reconnecting' | 'done' | 'error' | 'stopped';

export interface ChatMessageView {
  id: string;
  threadId: string;
  role: ChatMessage['role'];
  at: string;
  text: string;
  context: ContextRef[];
  isMorningBrief: boolean;
  tools: ChatToolView[];
  receipts: Receipt[];
  proposals: ChatProposalView[];
  resources: ChatResource[];
  /** Live assistant turn: caret on, tools uncollapsed. */
  streaming: boolean;
  /** Live turn status (assistant) — undefined for settled server messages. */
  status?: ChatTurnStatus;
  error: ApiErrorBody | null;
  stopped: boolean;
  /** Optimistic user message not yet confirmed by the server. */
  pending: boolean;
}

/** One in-flight (or just-finished, not yet reconciled) exchange. */
export interface LiveTurn {
  key: string;
  threadId: string;
  userText: string;
  context: ContextRef[];
  sentAt: string;
  /** Server message ids present when the turn started (anything else belongs to this turn). */
  baseIds: string[];
  status: ChatTurnStatus;
  messageId: string | null;
  userMessageId: string | null;
  text: string;
  tools: ChatToolView[];
  receipts: Receipt[];
  proposals: ChatProposalView[];
  resources: ChatResource[];
  error: ApiErrorBody | null;
  lastEvent: ChatSseEventType | null;
  /** Reconnect attempts used so far (shown as "Reconnecting… 2/3"). */
  attempt: number;
  /** "Allow more" on a capped message: this turn may spend this much more (ChatRequest.allowExtraUsd). */
  allowExtraUsd?: number;
}

/** What only the live turn knew, kept for the persisted assistant message after reconciliation. */
export interface TurnExtras {
  error: ApiErrorBody | null;
  stopped: boolean;
  toolArgs: Record<string, string>;
  proposalSummaries: Record<string, string>;
}
