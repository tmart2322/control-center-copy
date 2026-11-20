/**
 * Optimistic cache patches for list payloads (pure). The page hooks apply these inside
 * `useOptimisticMutation({ optimistic })`; tests exercise them directly.
 */
import type { BriefsPayload, ItemsPayload, TodayPayload, TriagePayload, Brief, OutboxPayload } from '@/contract';

/** Remove items from a Work list payload (done / snoozed / resolved leave the current tab). */
export function withoutItems(p: ItemsPayload, ids: ReadonlySet<string>): ItemsPayload {
  const items = p.items.filter((i) => !ids.has(i.id));
  const removed = p.items.length - items.length;
  if (!removed) return p;
  return { ...p, items, total: Math.max(0, p.total - removed), counts: { ...p.counts, [p.tab]: Math.max(0, (p.counts[p.tab] ?? 0) - removed) } };
}

/** Move items to another initiative (label comes from a known ref; null = no initiative). */
export function withInitiative(p: ItemsPayload, ids: ReadonlySet<string>, initiative: { id: string; label: string } | null): ItemsPayload {
  return {
    ...p,
    items: p.items.map((i) =>
      ids.has(i.id)
        ? {
            ...i,
            initiativeId: initiative?.id ?? null,
            refs: { ...i.refs, initiative: initiative ? { type: 'initiative' as const, id: initiative.id, label: initiative.label, href: `/initiatives/${initiative.id}` } : null },
          }
        : i,
    ),
  };
}

/** Remove a triage item and keep the counts honest (SETTLE-1: Closed for you is never counted). */
export function withoutTriageItem(p: TriagePayload, id: string): TriagePayload {
  let removed = 0;
  let counted = 0;
  const groups = p.groups.map((g) => {
    const items = g.items.filter((i) => i.id !== id);
    removed += g.items.length - items.length;
    if (g.group !== 'closed_for_you') counted += g.items.length - items.length;
    return { ...g, items };
  });
  return removed ? { ...p, groups, count: Math.max(0, p.count - counted) } : p;
}

/** Nav count + triage count on the Today payload (the nav badge reads these). */
export function withTriageCount(t: TodayPayload, delta: number): TodayPayload {
  return { ...t, triageCount: Math.max(0, t.triageCount + delta), navCounts: { ...t.navCounts, triage: Math.max(0, t.navCounts.triage + delta) } };
}

export function withBriefsUnread(t: TodayPayload, delta: number): TodayPayload {
  return { ...t, navCounts: { ...t.navCounts, briefsUnread: Math.max(0, t.navCounts.briefsUnread + delta) } };
}

export type HighlightStatus = 'new' | 'seen' | 'promoted' | 'dismissed';

/** Set a highlight's status inside one brief. */
export function withHighlightStatus(b: Brief, id: string, status: HighlightStatus, promotedWorkItemId: string | null = null): Brief {
  return { ...b, highlights: b.highlights.map((h) => (h.id === id ? { ...h, status, promotedWorkItemId: status === 'promoted' ? promotedWorkItemId : h.promotedWorkItemId } : h)) };
}

const OPEN: ReadonlySet<string> = new Set(['new', 'seen']);

/** Keep the briefs list's "worth a look" counts in step with a highlight leaving the open set. */
export function withWorthALook(p: BriefsPayload, briefId: string, delta: number): BriefsPayload {
  const bump = (list: BriefsPayload['watched']) => list.map((b) => (b.id === briefId ? { ...b, worthALook: Math.max(0, b.worthALook + delta) } : b));
  return { ...p, watched: bump(p.watched), opportunities: bump(p.opportunities), counts: { ...p.counts, worthALook: Math.max(0, p.counts.worthALook + delta) } };
}

export function isOpenHighlight(status: string): boolean {
  return OPEN.has(status);
}

/** Outbox: flip one draft's group/status locally (e.g. while a send is in flight). */
export function withOutboxDraft(p: OutboxPayload, draftId: string, patch: (d: OutboxPayload['groups'][number]['items'][number]['draft']) => OutboxPayload['groups'][number]['items'][number]['draft']): OutboxPayload {
  return { ...p, groups: p.groups.map((g) => ({ ...g, items: g.items.map((i) => (i.draft.id === draftId ? { ...i, draft: patch(i.draft) } : i)) })) };
}
