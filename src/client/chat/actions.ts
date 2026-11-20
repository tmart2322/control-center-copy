/**
 * Receipt undo and proposal apply state (pure). One audit id can cover several receipt lines (a re-rank
 * moves many rows in one change set), so undo state is keyed by audit id: undoing one line flips every
 * line that shares it. An undo that lies is worse than none, so a line only shows "Undone" after the
 * server confirms (or reports it was already undone).
 */
import type { Proposal, Receipt } from '@/contract';

export type UndoStatus = 'idle' | 'pending' | 'undone' | 'error';
export interface UndoState {
  status: UndoStatus;
  message?: string;
}

export type ProposalStatus = 'pending' | 'applying' | 'applied' | 'dismissing' | 'dismissed' | 'error';
export interface ProposalState {
  status: ProposalStatus;
  /** Audit id of the apply (Undo). */
  auditId?: string | null;
  receipt?: Receipt | null;
  message?: string;
}

export interface ChatActionsState {
  undo: Record<string, UndoState>;
  proposals: Record<string, ProposalState>;
}

export const EMPTY_ACTIONS: ChatActionsState = { undo: {}, proposals: {} };

export type ChatAction =
  | { type: 'undo/start'; auditId: string }
  | { type: 'undo/ok'; auditId: string }
  | { type: 'undo/fail'; auditId: string; message: string }
  | { type: 'proposal/start'; id: string; verb: 'apply' | 'dismiss' }
  | { type: 'proposal/applied'; id: string; auditId: string | null; receipt: Receipt | null }
  | { type: 'proposal/dismissed'; id: string }
  | { type: 'proposal/fail'; id: string; message: string; settled?: ProposalStatus }
  | { type: 'hydrate'; state: ChatActionsState };

export function actionsReducer(state: ChatActionsState, a: ChatAction): ChatActionsState {
  switch (a.type) {
    case 'undo/start':
      return { ...state, undo: { ...state.undo, [a.auditId]: { status: 'pending' } } };
    case 'undo/ok':
      return { ...state, undo: { ...state.undo, [a.auditId]: { status: 'undone' } } };
    case 'undo/fail':
      return { ...state, undo: { ...state.undo, [a.auditId]: { status: 'error', message: a.message } } };
    case 'proposal/start':
      return { ...state, proposals: { ...state.proposals, [a.id]: { ...state.proposals[a.id], status: a.verb === 'apply' ? 'applying' : 'dismissing', message: undefined } } };
    case 'proposal/applied':
      return { ...state, proposals: { ...state.proposals, [a.id]: { status: 'applied', auditId: a.auditId, receipt: a.receipt } } };
    case 'proposal/dismissed':
      return { ...state, proposals: { ...state.proposals, [a.id]: { status: 'dismissed' } } };
    case 'proposal/fail':
      return { ...state, proposals: { ...state.proposals, [a.id]: { ...state.proposals[a.id], status: a.settled ?? 'error', message: a.message } } };
    case 'hydrate':
      return {
        undo: { ...a.state.undo, ...state.undo },
        proposals: { ...a.state.proposals, ...state.proposals },
      };
  }
}

export function undoStateOf(state: ChatActionsState, auditId: string): UndoState {
  return state.undo[auditId] ?? { status: 'idle' };
}

/** A proposal's effective state: local action state wins over the status it was streamed with. */
export function proposalStateOf(state: ChatActionsState, p: Proposal): ProposalState {
  const local = state.proposals[p.id];
  if (local) return local;
  if (p.status === 'applied') return { status: 'applied' };
  if (p.status === 'rejected' || p.status === 'superseded') return { status: 'dismissed' };
  return { status: 'pending' };
}

/** Unique audit ids of a receipt, most recent change first (the order Undo all reverts them). */
export function auditIdsForUndoAll(receipt: Pick<Receipt, 'changes'>, state: ChatActionsState): string[] {
  const ids: string[] = [];
  for (const c of receipt.changes) if (!ids.includes(c.auditId)) ids.push(c.auditId);
  return ids.reverse().filter((id) => {
    const s = undoStateOf(state, id).status;
    return s === 'idle' || s === 'error';
  });
}

/** Summary for a receipt card header: how many lines are still live vs undone. */
export function receiptProgress(receipt: Pick<Receipt, 'changes'>, state: ChatActionsState): { total: number; undone: number; pending: number } {
  let undone = 0;
  let pending = 0;
  for (const c of receipt.changes) {
    const s = undoStateOf(state, c.auditId).status;
    if (s === 'undone') undone++;
    else if (s === 'pending') pending++;
  }
  return { total: receipt.changes.length, undone, pending };
}

/** Server messages that mean the change is already reverted: treat as success, not an error. */
export function isAlreadyUndone(message: string): boolean {
  return /already undone/i.test(message);
}

/** "Proposal is applied" / "Proposal is rejected" from a stale card: settle to that state. */
export function settledProposalStatus(message: string): ProposalStatus | null {
  const m = /proposal is (applied|rejected|superseded)/i.exec(message);
  if (!m) return null;
  return m[1].toLowerCase() === 'applied' ? 'applied' : 'dismissed';
}

/** Only terminal results are remembered across reloads (pending/error are transient). */
export function persistable(state: ChatActionsState): ChatActionsState {
  return {
    undo: Object.fromEntries(Object.entries(state.undo).filter(([, v]) => v.status === 'undone')),
    proposals: Object.fromEntries(
      Object.entries(state.proposals)
        .filter(([, v]) => v.status === 'applied' || v.status === 'dismissed')
        .map(([k, v]) => [k, { status: v.status, auditId: v.auditId ?? null, receipt: v.receipt ?? null }]),
    ),
  };
}
