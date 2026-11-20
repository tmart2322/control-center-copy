'use client';
/**
 * The NOW stack and "more today" as shown, held stable against live updates (UI-SPEC §10):
 * - nothing the cursor is on disappears or moves because of a live event;
 * - the user's own removals free their slot (and come back where they were on undo / rollback);
 * - arrivals append below with a "n new ↓" marker;
 * - an explicit re-rank (or an undo) takes the server order.
 * Order reconciliation is pure (model.ts); this hook only keeps the refs.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NowCard, TodayPayload, WorkItem } from '@/contract';
import { subscribeLive } from '@/client/live';
import { consumeReentries, isActionable, isFreshArrival, reconcileOrder, type ReconcileResult } from './model';

/** Live reasons that mean "the user (or the dev clock) asked for a new order": take it. */
const ADOPT_REASONS = new Set(['today.rerank', 'policy.apply', 'policy.revert', 'undo', 'scenario.reset']);
const ADOPT_WINDOW_MS = 4000;

export interface TodayModel {
  cards: NowCard[];
  rows: WorkItem[];
  /** Rows that arrived while the page was open (cleared once seen). */
  newRowIds: string[];
  /** "Re-rank ready · n": the server's pending count, or positions held back on screen. */
  rerankCount: number;
  /** Ids held on screen although the server dropped them (they sit under the cursor). */
  held: string[];
  /** Server instant of the first load (fresh-arrival cutoff). */
  since: string | null;
}

export function useTodayModel(
  data: TodayPayload | undefined,
  extras: WorkItem[],
  pins: { card: string | null; row: string | null },
): TodayModel & { remove: (id: string) => void; adopt: () => void; clearNew: () => void } {
  const adoptUntil = useRef(0);
  const removed = useRef(new Set<string>());
  const restoreCards = useRef(new Map<string, number>());
  const restoreRows = useRef(new Map<string, number>());
  const lastCards = useRef(new Map<string, NowCard>());
  const cardsRef = useRef<{ sig: string; res: ReconcileResult } | null>(null);
  const rowsRef = useRef<{ sig: string; res: ReconcileResult } | null>(null);
  const since = useRef<string | null>(null);
  const fresh = useRef(new Set<string>());
  const [, bump] = useState(0);

  const adopt = useCallback(() => {
    adoptUntil.current = Date.now() + ADOPT_WINDOW_MS;
    bump((n) => n + 1);
  }, []);
  useEffect(
    () =>
      subscribeLive((ev) => {
        if (ev.topic === 'today' && ADOPT_REASONS.has(ev.reason)) adopt();
      }),
    [adopt],
  );

  if (data && !since.current) since.current = data.now;
  const adopting = Date.now() < adoptUntil.current;

  // ---- NOW cards -------------------------------------------------------------
  const serverCards = (data?.nowStack.cards ?? []).filter((c) => isActionable(c.item));
  for (const c of serverCards) lastCards.current.set(c.item.id, c);
  const serverCardIds = serverCards.map((c) => c.item.id);
  const cardSig = `${serverCardIds.join(',')}|${pins.card ?? ''}|${adopting ? 1 : 0}|${removed.current.size}`;
  if (data && (!cardsRef.current || cardsRef.current.sig !== cardSig)) {
    const prev = cardsRef.current?.res.order ?? null;
    const res = reconcileOrder({ prev, server: serverCardIds, max: 3, pinned: pins.card, removedByUser: removed.current, restore: restoreCards.current, adopt: adopting });
    consumeReentries(prev, res.order, restoreCards.current, removed.current);
    cardsRef.current = { sig: cardSig, res };
  }
  const cardRes = cardsRef.current?.res ?? { order: [], added: [], held: [], outOfOrder: 0 };

  // A held card shows its latest item data when the item is still listed elsewhere.
  const latestItem = new Map<string, WorkItem>();
  for (const it of [...(data?.moreToday.items ?? []), ...extras]) latestItem.set(it.id, it);
  const cards = cardRes.order
    .map((id) => {
      const c = lastCards.current.get(id);
      if (!c) return null;
      const latest = serverCardIds.includes(id) ? c.item : latestItem.get(id) ?? c.item;
      return latest === c.item ? c : { ...c, item: latest };
    })
    .filter((c): c is NowCard => !!c && isActionable(c.item));
  const shownCardIds = new Set(cards.map((c) => c.item.id));

  // ---- more today ----------------------------------------------------------------
  // Top-3 items the screen holds back (a pinned card took their slot) stay reachable at the top of the list.
  const displaced = serverCards.filter((c) => !shownCardIds.has(c.item.id)).map((c) => c.item);
  const seen = new Set<string>();
  const serverRows = [...displaced, ...(data?.moreToday.items ?? []), ...extras].filter((it) => {
    if (seen.has(it.id) || shownCardIds.has(it.id) || !isActionable(it)) return false;
    seen.add(it.id);
    return true;
  });
  const rowById = new Map(serverRows.map((r) => [r.id, r]));
  const rowSig = `${serverRows.map((r) => r.id).join(',')}|${pins.row ?? ''}|${adopting ? 1 : 0}|${removed.current.size}`;
  if (data && (!rowsRef.current || rowsRef.current.sig !== rowSig)) {
    const prev = rowsRef.current?.res.order ?? null;
    const res = reconcileOrder({ prev, server: serverRows.map((r) => r.id), pinned: pins.row, removedByUser: removed.current, restore: restoreRows.current, adopt: adopting });
    consumeReentries(prev, res.order, restoreRows.current, null);
    // Arrivals (also while adopting a new order) that were created / reopened since the page opened.
    if (prev && since.current) {
      const before = new Set(prev);
      for (const id of res.order) if (!before.has(id) && rowById.get(id) && isFreshArrival(rowById.get(id)!, since.current)) fresh.current.add(id);
    }
    rowsRef.current = { sig: rowSig, res };
  }
  const lastRows = useRef(new Map<string, WorkItem>());
  for (const r of serverRows) lastRows.current.set(r.id, r);
  const rows = (rowsRef.current?.res.order ?? []).map((id) => rowById.get(id) ?? lastRows.current.get(id)).filter((r): r is WorkItem => !!r && !shownCardIds.has(r.id) && isActionable(r));
  const newRowIds = rows.filter((r) => fresh.current.has(r.id)).map((r) => r.id);

  const remove = useCallback((id: string) => {
    const ci = cardsRef.current?.res.order.indexOf(id) ?? -1;
    if (ci >= 0) restoreCards.current.set(id, ci);
    const ri = rowsRef.current?.res.order.indexOf(id) ?? -1;
    if (ri >= 0) restoreRows.current.set(id, ri);
    removed.current.add(id);
    fresh.current.delete(id);
  }, []);
  const clearNew = useCallback(() => {
    if (!fresh.current.size) return;
    fresh.current.clear();
    bump((n) => n + 1);
  }, []);

  return {
    cards,
    rows,
    newRowIds,
    rerankCount: Math.max(data?.nowStack.rerankReady ?? 0, cardRes.outOfOrder),
    held: cardRes.held,
    since: since.current,
    remove,
    adopt,
    clearNew,
  };
}
