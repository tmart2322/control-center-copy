'use client';
/**
 * The draft approval queue the docked panel pages through ("‹ 3 of 29 ›").
 *
 * The panel's entity API is frozen ({ kind, id, label }), so a page that opens one draft out of a list of
 * them publishes that list here, and DraftPanel reads it: it shows the pager when its draft is in the queue,
 * and moves to the next ready draft once its own leaves `ready` (pushed, sent, scheduled or rejected).
 * Home's "Approve N drafts" card publishes its `draftIds`. One queue at a time; the last publisher owns it and
 * clears it on unmount, so a page that publishes nothing (the Outbox, which pages its own list) shows no pager.
 */
import { useEffect, useSyncExternalStore } from 'react';

export interface DraftQueue {
  /** Who published it (only the owner may clear it). */
  owner: string;
  /** Every draft in the queue, in order. */
  ids: readonly string[];
}

let current: DraftQueue | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Publish (or replace) the queue. An unchanged list keeps its identity, so readers don't re-render. */
export function publishDraftQueue(owner: string, ids: readonly string[]): void {
  if (current && current.owner === owner && same(current.ids, ids)) return;
  current = { owner, ids: [...ids] };
  emit();
}

/** Clear the queue if `owner` still holds it. */
export function clearDraftQueue(owner: string): void {
  if (!current || current.owner !== owner) return;
  current = null;
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const snapshot = () => current;
const serverSnapshot = () => null;

/** The current queue (null when no page published one). */
export function useDraftQueue(): DraftQueue | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** A page's side: publish `ids` while mounted (an empty list clears it). */
export function useDraftQueueSource(owner: string, ids: readonly string[] | null | undefined): void {
  const key = ids?.join('\n') ?? '';
  useEffect(() => {
    if (key) publishDraftQueue(owner, key.split('\n'));
    else clearDraftQueue(owner);
  }, [owner, key]);
  useEffect(() => () => clearDraftQueue(owner), [owner]);
}

/** Position of `id` in the queue and its neighbours (pure). */
export function queuePosition(ids: readonly string[], id: string): { index: number; total: number; prev: string | null; next: string | null } | null {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  return { index, total: ids.length, prev: index > 0 ? ids[index - 1]! : null, next: index < ids.length - 1 ? ids[index + 1]! : null };
}
