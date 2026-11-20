/**
 * Briefs and watch subscriptions (R-UI-21). Briefs are reading material: they never compete with the Top 3.
 */
import { z } from 'zod';
import { BriefRelevance, Id, IsoDateTime, SourceRef, Url, Version } from './common';

export const WatchTargetKind = z.enum(['channel', 'opp', 'account', 'person', 'search']);
export type WatchTargetKind = z.infer<typeof WatchTargetKind>;

export const WatchCadence = z.enum(['daily_0730', 'every_4h', 'since_last_open']);
export type WatchCadence = z.infer<typeof WatchCadence>;

export const WatchSubscription = z.object({
  id: Id,
  version: Version,
  targetKind: WatchTargetKind,
  /** Channel id, opp id, account id, person id, or the search query. */
  target: z.string(),
  label: z.string(), // "#team-updates"
  cadence: WatchCadence,
  style: z.enum(['brief', 'detailed']),
  enabled: z.boolean().default(true),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WatchSubscription = z.infer<typeof WatchSubscription>;

export const BriefHighlight = z.object({
  id: Id,
  version: Version,
  briefId: Id,
  title: z.string(),
  summary: z.string(),
  relevance: BriefRelevance,
  /** Reasons tied to YOUR accounts, opps, initiatives and policy. */
  reasons: z.array(z.string()).min(1),
  sources: z.array(SourceRef),
  status: z.enum(['new', 'seen', 'promoted', 'dismissed']),
  promotedWorkItemId: Id.nullable().default(null),
  /**
   * What a promoted highlight became, read from its item when the brief is read (never stored): `triage` = a
   * suggestion still waiting in Triage (Promote), `task` = a task on your list (Make task, or a promotion you
   * accepted). The card shows that one state. Absent when the highlight is not promoted or the item is gone.
   */
  promotedAs: z.enum(['triage', 'task']).optional(),
  at: IsoDateTime,
});
export type BriefHighlight = z.infer<typeof BriefHighlight>;

/** Fill `promotedAs` on a brief's promoted highlights from their items' states (both DataSources, at read time). */
export function withPromotedAs<B extends { highlights: BriefHighlight[] }>(b: B, stateOf: (workItemId: string) => string | null | undefined): B {
  if (!b.highlights.some((h) => h.status === 'promoted' && h.promotedWorkItemId)) return b;
  return {
    ...b,
    highlights: b.highlights.map((h) => {
      if (h.status !== 'promoted' || !h.promotedWorkItemId) return h;
      const s = stateOf(h.promotedWorkItemId);
      // a suggestion you dismissed in Triage is neither: the card keeps the plain Promoted word
      return s && s !== 'dismissed' ? { ...h, promotedAs: s === 'suggested' ? 'triage' : 'task' } : h;
    }),
  };
}

export const BriefKind = z.enum(['channel', 'opp', 'account', 'person', 'search']);
export type BriefKind = z.infer<typeof BriefKind>;

export const Brief = z.object({
  id: Id,
  kind: BriefKind,
  title: z.string(),
  subscriptionId: Id.nullable().default(null),
  oppId: Id.nullable().default(null),
  accountId: Id.nullable().default(null),
  period: z.object({ from: IsoDateTime, to: IsoDateTime }),
  /** "through 10:41" */
  through: IsoDateTime,
  sources: z.array(SourceRef),
  /** Prose, markdown, ≤ 72ch measure in the UI. */
  summary: z.string(),
  unread: z.boolean(),
  status: z.enum(['generating', 'ready', 'failed']),
  highlights: z.array(BriefHighlight),
  /** "Everything else", collapsed, grouped by thread. */
  everythingElse: z.array(
    z.object({
      thread: z.string(),
      url: Url.nullable().default(null),
      items: z.array(z.object({ at: IsoDateTime, author: z.string(), text: z.string() })),
    }),
  ),
  generatedAt: IsoDateTime,
});
export type Brief = z.infer<typeof Brief>;

export const BriefSummary = z.object({
  id: Id,
  kind: BriefKind,
  title: z.string(),
  unread: z.boolean(),
  worthALook: z.number().int(),
  through: IsoDateTime,
  status: z.enum(['generating', 'ready', 'failed']),
});
export type BriefSummary = z.infer<typeof BriefSummary>;

export const BriefsPayload = z.object({
  watched: z.array(BriefSummary),
  opportunities: z.array(BriefSummary),
  watches: z.array(WatchSubscription),
  counts: z.object({ unread: z.number().int(), worthALook: z.number().int() }),
});
export type BriefsPayload = z.infer<typeof BriefsPayload>;

export const WatchesPayload = z.object({ watches: z.array(WatchSubscription) });
export type WatchesPayload = z.infer<typeof WatchesPayload>;
