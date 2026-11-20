/**
 * History (B-081), db side. The read model (model.ts) supplies the records every page composes from; the facts
 * that only Postgres keeps come from SQL here:
 *
 *   closes     work_item_transitions to `done` in the requested window that are not undone (undo stamps
 *              `undone_at` down the undo/redo chain, db/changeset.ts markUndoChain), with the actor that made them.
 *              The record's current close (work_items.done_at) covers items closed without a transition.
 *   Org62      activity_entries.synced_to_canvas_at / logged_at / verified_at: when a row reached the canvas or
 *              Org62 (the contract ActivityEntry carries only updatedAt).
 *
 * Both go to the composer the mock uses too (src/server/history/compose.ts), so the two DataSources agree on the
 * same data (tests/be1b/history.test.ts). No new tables, columns or snapshots.
 */
import { and, asc, eq, gte, isNotNull, isNull, lt, or } from 'drizzle-orm';

import type { HistoryDay, HistoryMonth } from '@/contract';
import type { Db } from '@/db/client';
import { activityEntries, workItemTransitions, workItems } from '@/db/schema';
import { composeHistoryDay, composeHistoryMonth, dayWindow, monthGrid, monthOf, todayIn, type HistoryClosure, type HistorySources } from '@/server/history/compose';

import type { ReadModel } from './model';
import { onsiteDaysIn } from './store/onsite';

const BY_ACTOR: Record<string, HistoryClosure['by']> = { user: 'you', engine: 'engine', autonomy_policy: 'engine', chat: 'chat' };

/** Closes from the state-machine log in [from, to): to `done`, not undone. */
export async function transitionClosures(db: Db, userId: string, from: number, to: number): Promise<HistoryClosure[]> {
  const rows = await db
    .select({ itemId: workItemTransitions.workItemId, at: workItemTransitions.occurredAt, actor: workItemTransitions.actorKind })
    .from(workItemTransitions)
    .innerJoin(workItems, eq(workItems.id, workItemTransitions.workItemId))
    .where(
      and(
        eq(workItems.ownerUserId, userId),
        eq(workItemTransitions.toStatus, 'done'),
        isNull(workItemTransitions.undoneAt),
        gte(workItemTransitions.occurredAt, new Date(from)),
        lt(workItemTransitions.occurredAt, new Date(to)),
      ),
    )
    .orderBy(asc(workItemTransitions.occurredAt), asc(workItemTransitions.id));
  return rows.map((r) => ({ itemId: r.itemId, at: r.at.toISOString(), by: BY_ACTOR[r.actor] ?? 'other' }));
}

/**
 * When each activity row reached the canvas / Org62, by its contract status (the stamp columns). Every stamped row
 * of the user, not just the window's: a row missing from the map falls back to its updatedAt in the composer, so
 * a row stamped outside the window must still be here (a few hundred rows a quarter).
 */
export async function org62Stamps(db: Db, userId: string, m: ReadModel): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: activityEntries.id, synced: activityEntries.syncedToCanvasAt, logged: activityEntries.loggedAt, verified: activityEntries.verifiedAt })
    .from(activityEntries)
    .where(and(eq(activityEntries.ownerUserId, userId), or(isNotNull(activityEntries.syncedToCanvasAt), isNotNull(activityEntries.loggedAt), isNotNull(activityEntries.verifiedAt))))
    .orderBy(asc(activityEntries.id));
  const out = new Map<string, string>();
  for (const r of rows) {
    const status = m.get('activity', r.id)?.status;
    const at = status === 'synced_to_canvas' ? r.synced : status === 'logged' ? (r.logged ?? r.synced) : status === 'verified' || status === 'verify_failed' ? (r.verified ?? r.logged ?? r.synced) : null;
    if (at) out.set(r.id, at.toISOString());
  }
  return out;
}

async function sources(db: Db, m: ReadModel, now: Date, from: number, to: number): Promise<HistorySources> {
  const userId = m.ctx.userId;
  return {
    timezone: m.settings().profile.timezone,
    now,
    workItems: m.all('workItems'),
    accounts: m.all('accounts'),
    activity: m.all('activity'),
    timeBlocks: m.all('timeBlocks'),
    events: m.all('events'),
    drafts: m.all('drafts'),
    agentRuns: m.all('agentRuns'),
    pastClosures: await transitionClosures(db, userId, from, to),
    org62At: await org62Stamps(db, userId, m),
    onsite: onsiteDaysIn(m.ctx.kv, localDayOf(from, m.settings().profile.timezone), localDayOf(to - 1, m.settings().profile.timezone)),
  };
}

const localDayOf = (ms: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** GET /history?month */
export async function historyMonth(db: Db, m: ReadModel, month: string | undefined, now: Date): Promise<HistoryMonth> {
  const tz = m.settings().profile.timezone;
  const g = monthGrid(month ?? monthOf(todayIn(now, tz)));
  return composeHistoryMonth(await sources(db, m, now, dayWindow(g.gridStart, tz).from, dayWindow(g.gridEnd, tz).to), month);
}

/** GET /history/:day */
export async function historyDay(db: Db, m: ReadModel, day: string, now: Date): Promise<HistoryDay> {
  const { from, to } = dayWindow(day, m.settings().profile.timezone);
  return composeHistoryDay(await sources(db, m, now, from, to), day);
}
