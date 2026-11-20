'use client';
/**
 * TODO(CONTRACT): enrichment chip decisions. The contract carries `EnrichmentChip.status`
 * (suggested · accepted · rejected) but no route to change it, so accept/reject persists locally
 * (localStorage, per item) until `POST /items/:id/enrichment/:chipId/{accept,reject}` exists.
 * Every caller goes through `decideChip`, so the swap is one function.
 */
import { useSyncExternalStore } from 'react';

export type ChipDecision = 'accepted' | 'rejected';
type Decisions = Record<string, ChipDecision>;

const KEY = (itemId: string) => `cc:enrich:${itemId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, Decisions>();
const EMPTY: Decisions = {};

function read(itemId: string): Decisions {
  if (cache.has(itemId)) return cache.get(itemId)!;
  let v: Decisions = EMPTY;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY(itemId)) : null;
    if (raw) v = JSON.parse(raw) as Decisions;
  } catch {
    v = EMPTY;
  }
  cache.set(itemId, v);
  return v;
}

/** Record (or clear, with `null`) a decision. Returns the previous one, for Undo. */
export function decideChip(itemId: string, chipId: string, decision: ChipDecision | null): ChipDecision | null {
  const cur = read(itemId);
  const prev = cur[chipId] ?? null;
  const next: Decisions = { ...cur };
  if (decision) next[chipId] = decision;
  else delete next[chipId];
  cache.set(itemId, next);
  try {
    localStorage.setItem(KEY(itemId), JSON.stringify(next));
  } catch {
    /* private mode: in-memory only */
  }
  for (const l of listeners) l();
  return prev;
}

export function chipDecisions(itemId: string): Decisions {
  return read(itemId);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useChipDecisions(itemId: string): Decisions {
  return useSyncExternalStore(
    subscribe,
    () => read(itemId),
    () => EMPTY,
  );
}

/** Tests only. */
export function resetChipDecisions() {
  cache.clear();
  for (const l of listeners) l();
}
