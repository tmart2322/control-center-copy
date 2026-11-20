'use client';
/**
 * Home's live layer (docs/UX.md "Live updates"): the shared live-list merge over Do now's cards and every section's
 * rows, keyed the way Home selects them (`c:<id>`, `r:<section>:<id>`). While you sit on Home, real things come in:
 * a new card or row enters at its place with a gentle mark, rows already on screen never swap places because of a
 * background refetch, a row done elsewhere fades out where it was, and the one open in the panel stays until you move.
 */
import { useMemo } from 'react';
import type { HomeCard, HomePayload, HomeRow, HomeSectionId } from '@/contract';
import { useLiveList, type LiveList } from '@/components/lists/live-list';
import { cardKey, rowKey } from './model';

interface Entry {
  id: string;
  card?: HomeCard;
  section?: HomeSectionId;
  row?: HomeRow;
}

/** The entity id behind a Home key (what a write names: src/client/intent.ts). */
export function homeKeyEntity(key: string): string {
  if (key.startsWith('c:')) return key.slice(2);
  if (key.startsWith('r:')) return key.slice(key.indexOf(':', 2) + 1);
  return key;
}

/** Pure: Home in the merged order (cards first, then each section's rows), rows fading out included. */
export function homeInOrder(h: HomePayload, order: Entry[]): HomePayload {
  const cards = order.filter((e) => e.card).map((e) => e.card!);
  const bySection = new Map<HomeSectionId, HomeRow[]>();
  for (const e of order) if (e.row && e.section) bySection.set(e.section, [...(bySection.get(e.section) ?? []), e.row]);
  // Do now holds three: a card fading out keeps its slot, and the one replacing it slides in when it has gone.
  return {
    ...h,
    doNow: { ...h.doNow, cards: cards.slice(0, Math.max(3, h.doNow.cards.length)).map((c, i) => ({ ...c, rank: i + 1 })) },
    sections: h.sections.map((s) => ({ ...s, rows: bySection.get(s.id) ?? [] })),
  };
}

export function useLiveHome(h: HomePayload | undefined, resetKey: string, opts: { hold?: boolean; keep?: string | null; frozen?: boolean }): { data: HomePayload | undefined; live: LiveList<Entry> } {
  const flat = useMemo<Entry[] | undefined>(
    () => (h ? [...h.doNow.cards.map((card) => ({ id: cardKey(card), card })), ...h.sections.flatMap((s) => s.rows.map((row) => ({ id: rowKey(s.id, row), section: s.id, row })))] : undefined),
    [h],
  );
  // Home has no page scroll: a few arrivals slide in, a burst waits behind the pill.
  const live = useLiveList(flat, resetKey, { hold: opts.hold, keep: opts.keep, frozen: opts.frozen, localId: homeKeyEntity });
  const data = useMemo(() => (h ? homeInOrder(h, live.items) : h), [h, live.items]);
  return { data, live };
}
