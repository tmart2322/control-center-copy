/**
 * Watch subscriptions, briefs and brief highlights (R-UI-21).
 *
 * watch_subscriptions: targetKind → scope_kind + the scope arc (channel → channels row; opp/account/person
 *   → FK; search → search_query) · label · cadence/style (+ override when lossy) · enabled · version.
 *   Briefs without a user watch (opportunity briefs) hang off an `auto_managed` subscription, which the
 *   Watches list hides.
 * briefs: period → period_start/end · status · summary · highlight_count · generated_at · unread ⇔ seen_at
 *   is null. Ext: title, kind, through, sources, everythingElse, account/opp chips.
 * brief_highlights: ordinal · title · summary → body · relevance → level + relevance_score · status ·
 *   promoted_work_item_id · version · at → created_at; reasons → brief_highlight_reasons (weight order).
 *   Ext: sources.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { Brief, BriefHighlight, WatchSubscription } from '@/contract';
import { briefHighlightReasons, briefHighlights, briefs, channels, watchSubscriptions } from '@/db/schema';

import { applyOverride, cadenceFromDb, cadenceToDb, overrideIfLossy, scopeFromDb, scopeToDb, styleFromDb, styleToDb, type DbCadence, type Override } from '../enums';
import { hashKey, uuidFor } from '../ids';
import { ext, isoReq, toDate, updateRow, writeExt, type ReadCtx, type WriteCtx } from './common';

// ---------------------------------------------------------------------------
// Watches
// ---------------------------------------------------------------------------

interface WatchExt {
  cadence: Override<WatchSubscription['cadence'], DbCadence>;
  target: string;
}

export async function loadWatches(rc: ReadCtx): Promise<(WatchSubscription & { autoManaged: boolean })[]> {
  const rows = await rc.db
    .select({ w: watchSubscriptions, ch: channels })
    .from(watchSubscriptions)
    .leftJoin(channels, eq(channels.id, watchSubscriptions.channelId))
    .where(eq(watchSubscriptions.ownerUserId, rc.userId))
    .orderBy(asc(watchSubscriptions.createdAt), asc(watchSubscriptions.id));
  return rows.map(({ w, ch }) => {
    const x = ext<WatchExt>(rc, 'watch_subscriptions', w.id);
    const target = x.target ?? ch?.externalId ?? w.opportunityId ?? w.accountId ?? w.personId ?? w.initiativeId ?? w.searchQuery ?? '';
    return {
      id: w.id,
      version: w.version,
      targetKind: scopeFromDb(w.scopeKind),
      target,
      label: w.label,
      cadence: applyOverride(w.cadence, cadenceFromDb(w.cadence), x.cadence),
      style: styleFromDb(w.style),
      enabled: w.enabled,
      createdAt: isoReq(w.createdAt),
      updatedAt: isoReq(w.updatedAt),
      autoManaged: w.autoManaged,
    };
  });
}

async function channelFor(w: WriteCtx, externalId: string, name: string): Promise<string> {
  const id = uuidFor(`channel:${externalId}`);
  await w.tx
    .insert(channels)
    .values({ id, ownerUserId: w.userId, system: 'slack', externalId, name, kind: 'public', watchMode: 'digest' })
    .onConflictDoNothing();
  const [row] = await w.tx.select({ id: channels.id }).from(channels).where(and(eq(channels.ownerUserId, w.userId), eq(channels.system, 'slack'), eq(channels.externalId, externalId)));
  return row!.id;
}

async function scopeColumns(w: WriteCtx, s: Pick<WatchSubscription, 'targetKind' | 'target' | 'label'>, exists: (kind: 'opportunity' | 'account' | 'person', id: string) => Promise<boolean>) {
  const base = { channelId: null as string | null, opportunityId: null as string | null, accountId: null as string | null, personId: null as string | null, searchQuery: null as string | null };
  let scopeKind = scopeToDb(s.targetKind);
  let extTarget: string | undefined;
  switch (s.targetKind) {
    case 'channel':
      base.channelId = await channelFor(w, s.target, s.label);
      break;
    case 'opp':
    case 'account':
    case 'person': {
      const kind = s.targetKind === 'opp' ? 'opportunity' : s.targetKind;
      if (await exists(kind, uuidFor(s.target))) {
        if (kind === 'opportunity') base.opportunityId = uuidFor(s.target);
        else if (kind === 'account') base.accountId = uuidFor(s.target);
        else base.personId = uuidFor(s.target);
        if (uuidFor(s.target) !== s.target) extTarget = s.target;
      } else {
        // a target outside the directory is watched as a search for its text
        scopeKind = 'search_query';
        base.searchQuery = s.target;
        extTarget = s.target;
      }
      break;
    }
    case 'search':
      base.searchQuery = s.target;
      break;
  }
  return { scopeKind, ...base, extTarget };
}

export async function insertWatch(w: WriteCtx, s: WatchSubscription, exists: (kind: 'opportunity' | 'account' | 'person', id: string) => Promise<boolean>, opts: { autoManaged?: boolean } = {}): Promise<string> {
  const id = uuidFor(s.id);
  const sc = await scopeColumns(w, s, exists);
  const cadence = cadenceToDb(s.cadence);
  await w.tx.insert(watchSubscriptions).values({
    id,
    ownerUserId: w.userId,
    scopeKind: sc.scopeKind,
    channelId: sc.channelId,
    opportunityId: sc.opportunityId,
    accountId: sc.accountId,
    personId: sc.personId,
    searchQuery: sc.searchQuery,
    label: s.label,
    cadence,
    style: styleToDb(s.style),
    autoManaged: !!opts.autoManaged,
    enabled: s.enabled,
    version: s.version,
    createdAt: toDate(s.createdAt)!,
    updatedAt: toDate(s.updatedAt)!,
  });
  await writeExt(w, 'watch_subscriptions', id, { cadence: overrideIfLossy(s.cadence, cadence, cadenceFromDb) ?? undefined, target: sc.extTarget });
  return id;
}

export async function updateWatch(w: WriteCtx, cur: WatchSubscription, next: WatchSubscription, ifVersion: number, exists: (kind: 'opportunity' | 'account' | 'person', id: string) => Promise<boolean>) {
  const id = uuidFor(cur.id);
  const patch: Record<string, unknown> = {};
  if (cur.targetKind !== next.targetKind || cur.target !== next.target) {
    const sc = await scopeColumns(w, next, exists);
    Object.assign(patch, { scopeKind: sc.scopeKind, channelId: sc.channelId, opportunityId: sc.opportunityId, accountId: sc.accountId, personId: sc.personId, searchQuery: sc.searchQuery });
  }
  if (cur.label !== next.label) patch.label = next.label;
  const cadence = cadenceToDb(next.cadence);
  if (cur.cadence !== next.cadence) patch.cadence = cadence;
  if (cur.style !== next.style) patch.style = styleToDb(next.style);
  if (cur.enabled !== next.enabled) patch.enabled = next.enabled;
  const prev = (w.kv.get(`cc.ext/watch_subscriptions/${id}`) as WatchExt | undefined) ?? {};
  await updateRow(w, watchSubscriptions, id, patch, { bump: true, ifVersion, lock: false, extChanged: true });
  await writeExt(w, 'watch_subscriptions', id, { ...prev, cadence: overrideIfLossy(next.cadence, cadence, cadenceFromDb) ?? undefined });
}

// ---------------------------------------------------------------------------
// Briefs and highlights
// ---------------------------------------------------------------------------

interface BriefExt {
  title: string;
  kind: Brief['kind'];
  through: string;
  sources: Brief['sources'];
  everythingElse: Brief['everythingElse'];
  accountId: string;
  oppId: string;
  subscriptionNull: boolean;
}

const RELEVANCE_SCORE: Record<BriefHighlight['relevance'], number> = { high: 0.85, medium: 0.6, low: 0.35 };
const LEVEL: Record<BriefHighlight['relevance'], 'must_read' | 'worth_a_look' | 'fyi'> = { high: 'must_read', medium: 'worth_a_look', low: 'fyi' };
const relevanceFromLevel = (l: 'must_read' | 'worth_a_look' | 'fyi'): BriefHighlight['relevance'] => (l === 'must_read' ? 'high' : l === 'worth_a_look' ? 'medium' : 'low');

export async function loadBriefs(rc: ReadCtx, watches: Map<string, { targetKind: WatchSubscription['targetKind']; label: string; accountId: string | null; oppId: string | null }>): Promise<Brief[]> {
  const rows = await rc.db.select().from(briefs).where(eq(briefs.ownerUserId, rc.userId)).orderBy(asc(briefs.createdAt), asc(briefs.id));
  if (!rows.length) return [];
  const hs = await rc.db.select().from(briefHighlights).where(inArray(briefHighlights.briefId, rows.map((r) => r.id))).orderBy(asc(briefHighlights.ordinal));
  const reasons = hs.length ? await rc.db.select().from(briefHighlightReasons).where(inArray(briefHighlightReasons.highlightId, hs.map((h) => h.id))).orderBy(desc(briefHighlightReasons.weight), asc(briefHighlightReasons.id)) : [];
  return rows.map((r) => {
    const x = ext<BriefExt>(rc, 'briefs', r.id);
    const sub = watches.get(r.subscriptionId);
    const highlights: BriefHighlight[] = hs
      .filter((h) => h.briefId === r.id)
      .map((h) => {
        const hx = ext<{ sources: BriefHighlight['sources'] }>(rc, 'brief_highlights', h.id);
        return {
          id: h.id,
          version: h.version,
          briefId: r.id,
          title: h.title,
          summary: h.body ?? '',
          relevance: relevanceFromLevel(h.level),
          reasons: reasons.filter((x2) => x2.highlightId === h.id).map((x2) => x2.explanation),
          sources: hx.sources ?? [],
          status: h.status,
          promotedWorkItemId: h.promotedWorkItemId,
          at: isoReq(h.createdAt),
        };
      });
    return {
      id: r.id,
      kind: x.kind ?? (sub?.targetKind ?? 'channel'),
      title: x.title ?? sub?.label ?? 'Brief',
      subscriptionId: x.subscriptionNull ? null : r.subscriptionId,
      oppId: x.oppId ?? null,
      accountId: x.accountId ?? null,
      period: { from: isoReq(r.periodStart), to: isoReq(r.periodEnd) },
      through: x.through ?? isoReq(r.periodEnd),
      sources: x.sources ?? [],
      summary: r.summary ?? '',
      unread: r.seenAt === null,
      status: r.status === 'superseded' ? 'ready' : r.status,
      highlights,
      everythingElse: x.everythingElse ?? [],
      generatedAt: isoReq(r.generatedAt ?? r.createdAt),
    };
  });
}

export async function insertBrief(w: WriteCtx, b: Brief, subscriptionId: string, subLabel: string | null): Promise<string> {
  const id = uuidFor(b.id);
  await w.tx.insert(briefs).values({
    id,
    ownerUserId: w.userId,
    subscriptionId,
    periodStart: toDate(b.period.from)!,
    periodEnd: toDate(b.period.to)!,
    status: b.status,
    summary: b.summary,
    highlightCount: b.highlights.length,
    sourceItemCount: b.sources.length,
    nothingNew: b.highlights.length === 0,
    generatedAt: toDate(b.generatedAt),
    seenAt: b.unread ? null : toDate(b.generatedAt),
    createdAt: toDate(b.generatedAt)!,
  });
  await writeExt(w, 'briefs', id, {
    title: b.title !== subLabel ? b.title : undefined,
    kind: b.kind,
    through: b.through !== b.period.to ? b.through : undefined,
    sources: b.sources,
    everythingElse: b.everythingElse,
    accountId: b.accountId ?? undefined,
    oppId: b.oppId ?? undefined,
    subscriptionNull: b.subscriptionId === null ? true : undefined,
  });
  let ordinal = 0;
  for (const h of b.highlights) await insertHighlight(w, id, h, ordinal++);
  return id;
}

async function insertHighlight(w: WriteCtx, briefId: string, h: BriefHighlight, ordinal: number) {
  const id = uuidFor(h.id);
  await w.tx.insert(briefHighlights).values({
    id,
    ownerUserId: w.userId,
    briefId,
    ordinal,
    title: h.title,
    body: h.summary,
    relevanceScore: RELEVANCE_SCORE[h.relevance],
    level: LEVEL[h.relevance],
    topicKey: hashKey(h.id, h.title),
    status: h.status,
    promotedAt: h.status === 'promoted' ? toDate(h.at) : null,
    promotedWorkItemId: h.promotedWorkItemId ? uuidFor(h.promotedWorkItemId) : null,
    dismissedAt: h.status === 'dismissed' ? toDate(h.at) : null,
    version: h.version,
    createdAt: toDate(h.at)!,
    updatedAt: toDate(h.at)!,
  });
  if (h.reasons.length) {
    await w.tx.insert(briefHighlightReasons).values(
      h.reasons.map((text, i) => ({ highlightId: id, kind: 'my_interest' as const, featureKey: `reason_${i}`, weight: Math.round((1 - i * 0.05) * 1000) / 1000, explanation: text })),
    );
  }
  await writeExt(w, 'brief_highlights', id, { sources: h.sources });
}

/** Highlight state changes go through the helper (versioned, audited under the brief). */
export async function updateHighlight(w: WriteCtx, cur: BriefHighlight, next: BriefHighlight, ifVersion: number | undefined) {
  const id = uuidFor(cur.id);
  const patch: Record<string, unknown> = {};
  if (cur.status !== next.status) {
    patch.status = next.status;
    if (next.status === 'promoted') patch.promotedAt = w.now;
    if (next.status === 'dismissed') patch.dismissedAt = w.now;
  }
  if (cur.promotedWorkItemId !== next.promotedWorkItemId) patch.promotedWorkItemId = next.promotedWorkItemId ? uuidFor(next.promotedWorkItemId) : null;
  await updateRow(w, briefHighlights, id, patch, { bump: true, ifVersion, lock: false, stampUpdatedAt: true });
}

export async function markBriefSeen(w: WriteCtx, briefId: string) {
  await w.tx.update(briefs).set({ seenAt: w.now }).where(eq(briefs.id, uuidFor(briefId)));
}

