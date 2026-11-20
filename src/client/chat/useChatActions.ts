'use client';
/**
 * Receipt Undo / Undo all and proposal Apply / Dismiss, against the real API (POST /audit/:id/undo,
 * POST /proposals/:id/apply|reject). State logic lives in ./actions (pure, tested); this hook adds the
 * calls and remembers settled results across reloads, since persisted chat parts don't record them.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Proposal } from '@/contract';
import { api, ApiError } from '@/client/api';
import { actionsReducer, EMPTY_ACTIONS, isAlreadyUndone, persistable, settledProposalStatus, undoStateOf, type ChatActionsState } from './actions';
import { CHAT_KEYS, readJson, writeJson } from './storage';

export interface ChatActionsApi {
  state: ChatActionsState;
  undo(auditId: string): Promise<boolean>;
  /** Sequential, most recent first (the order a change set must be reverted in). */
  undoMany(auditIds: string[]): Promise<void>;
  apply(p: Proposal): Promise<void>;
  dismiss(p: Proposal): Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

export function useChatActions(opts: { persist?: boolean } = {}): ChatActionsApi {
  const persist = opts.persist !== false;
  const [state, dispatch] = useReducer(actionsReducer, EMPTY_ACTIONS);
  const stateRef = useRef(state);
  stateRef.current = state;
  const hydrated = useRef(false);

  useEffect(() => {
    if (persist) dispatch({ type: 'hydrate', state: readJson<ChatActionsState>(CHAT_KEYS.actions, EMPTY_ACTIONS) });
    hydrated.current = true;
  }, [persist]);
  useEffect(() => {
    if (persist && hydrated.current) writeJson(CHAT_KEYS.actions, persistable(state));
  }, [persist, state]);

  const undo = useCallback(async (auditId: string) => {
    const s = undoStateOf(stateRef.current, auditId).status;
    if (s === 'pending' || s === 'undone') return s === 'undone';
    dispatch({ type: 'undo/start', auditId });
    try {
      await api('undoAudit', { params: { id: auditId }, body: {} });
      dispatch({ type: 'undo/ok', auditId });
      return true;
    } catch (err) {
      const m = message(err);
      if (isAlreadyUndone(m)) {
        dispatch({ type: 'undo/ok', auditId });
        return true;
      }
      const friendly = err instanceof ApiError && err.code === 'conflict' ? 'Changed since, so it can’t be undone here.' : m;
      dispatch({ type: 'undo/fail', auditId, message: friendly });
      return false;
    }
  }, []);

  const undoMany = useCallback(
    async (auditIds: string[]) => {
      for (const id of auditIds) await undo(id);
    },
    [undo],
  );

  const apply = useCallback(async (p: Proposal) => {
    dispatch({ type: 'proposal/start', id: p.id, verb: 'apply' });
    try {
      const r = await api('applyProposal', { params: { id: p.id }, body: {} });
      dispatch({ type: 'proposal/applied', id: p.id, auditId: r.auditId, receipt: r.receipt ?? null });
    } catch (err) {
      const m = message(err);
      dispatch({ type: 'proposal/fail', id: p.id, message: m, settled: settledProposalStatus(m) ?? undefined });
    }
  }, []);

  const dismiss = useCallback(async (p: Proposal) => {
    dispatch({ type: 'proposal/start', id: p.id, verb: 'dismiss' });
    try {
      await api('rejectProposal', { params: { id: p.id }, body: {} });
      dispatch({ type: 'proposal/dismissed', id: p.id });
    } catch (err) {
      const m = message(err);
      dispatch({ type: 'proposal/fail', id: p.id, message: m, settled: settledProposalStatus(m) ?? undefined });
    }
  }, []);

  return { state, undo, undoMany, apply, dismiss };
}
