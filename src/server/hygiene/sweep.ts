/**
 * HYG-1: the hygiene sweep. Dead data (left by earlier builds, tests and bugs) confuses people: a draft nobody will
 * send, a DC request "handed off" forever, a dead job that later succeeded, a to-do "enriching" for good, a scan of a
 * scope that does not exist, side-car rows of deleted rows. Each category below finds its rows and cleans them up
 * through the app's own state machine, in its own system change set (actor `system:hygiene`), so History shows what
 * changed and audited tables can be undone. The `hygiene.sweep` job (src/jobs/handlers/hygiene.ts) runs it daily and
 * at worker start, so the first worker after a deploy cleans what is already there with the same code.
 *
 * What the user authored (their own drafts, notes, settings, decisions) is never deleted: it is flagged instead
 * (an open Health event that says how many and why).
 *
 * Every category also has its creation path closed in code (see each section): this sweep is the TTL and the net.
 */
import { sql } from 'drizzle-orm';

import type { Draft } from '@/contract';
import { actors, withChangeSet } from '@/db/changeset';
import type { Db, Tx } from '@/db/client';
import { enrichWorkItem, ENRICH_JOB_KIND } from '@/jobs/handlers/enrich';
import { adminSurfaceOf } from '@/contract';
import { loggingProfile } from '@/engines/activity/persona';
import { canvasHolds, canvasInputOf } from '@/lib/canvas/payload';
import { preflightCanvas, preflightSummary } from '@/lib/canvas/preflight';
import { dbPreflightContext } from '@/server/datasource/db/store/canvas-preflight';
import { loadPersona } from '@/server/datasource/db/store/persona';
import { CANVAS_EXPIRY_DAYS, EXPIRED_CANVAS_REASON, NOTHING_LEFT_PREFIX } from '@/server/time/canvas-preflight';
import { connectorOfName, isKnownScope, repairScopeId } from '@/scanner/scope-catalog';
import { draftStatusFromDb, type DbDraftStatus } from '@/server/datasource/db/enums';
import { loadKv } from '@/server/datasource/db/ext';
import { ensureExtractor } from '@/server/datasource/db/seed';
import type { WriteCtx } from '@/server/datasource/db/store/common';
import { confirmHandedOffDcRequests } from '@/server/datasource/db/store/dc-requests';
import { clearStaleDcFlags, sweepStaleAccountDcStatus, withdrawVdpItemsOutOfScope } from '@/server/datasource/db/store/deals-sync';

export const HYGIENE_ACTOR = 'hygiene';
/** A pending draft no one touched for this long, with no to-do and no page of its own, is withdrawn. */
export const STALE_DRAFT_DAYS = 14;
/** An item still "enriching" this long after capture, with no enrich job left, is enriched now. */
export const ENRICH_GRACE_MS = 10 * 60_000;
/** No scan run lasts this long (the job timeout is 15 minutes): a run still `running` after it was abandoned. */
export const ABANDONED_RUN_MS = 2 * 3_600_000;

export const STALE_DRAFT_REASON = 'Withdrawn: stale, no to-do or page for it and untouched for 14 days';
export const SUBJECT_GONE_REASON = 'Withdrawn: what it was for no longer exists';

export interface HygieneCounts {
  /** Engine drafts withdrawn: stale with no to-do, or whose subject is gone. */
  staleDrafts: number;
  /** Your own drafts in the same state: flagged on Health, never touched. */
  staleDraftsFlagged: number;
  /** DC requests reconciled with my DCs (D-68): confirmed, withdrawn, or not created (a stranded hand-off). */
  dcRequestsConfirmed: number;
  /** DC-25: `dcAssigned` flags no DC of mine supports any more (removed in Org62): cleared. */
  staleDcFlags: number;
  /** DC-25: account DC statuses no open opp of mine supports: cleared. */
  staleDcStatus: number;
  /** DC-10 / DC-25: pending VDP items for accounts that left the 100%-DC scope: withdrawn. */
  vdpItemsOutOfScope: number;
  /** Dead jobs a later run of the same job succeeded after: resolved (cancelled as superseded). */
  deadJobsResolved: number;
  /** Queued or dead jobs of a kind no worker handles: cancelled. */
  unhandledJobs: number;
  /** To-dos left "enriching" with no enrich job: enriched now. */
  stuckEnriching: number;
  /** Scan runs on a scope that does not exist: removed (with their cursor); unprefixed ones repaired. */
  unknownScopeRuns: number;
  repairedScopeRuns: number;
  unknownScopeCursors: number;
  /** Side-car kv rows (`cc.ext/…`, read-ins, chat plans) of rows that no longer exist: removed. */
  orphanKv: number;
  /** Activity rows "on a canvas" whose canvas never reached Slack: back to approved (the next batch takes them). */
  orphanCanvasRows: number;
  /** Scan runs left `running` / `queued` after their job ended: closed. */
  abandonedRuns: number;
  /** D-65: logging canvas items never applied (14 days, or nothing left to log): expired with a notice. */
  expiredCanvases: number;
}

export const zeroCounts = (): HygieneCounts => ({
  staleDrafts: 0,
  staleDraftsFlagged: 0,
  dcRequestsConfirmed: 0,
  staleDcFlags: 0,
  staleDcStatus: 0,
  vdpItemsOutOfScope: 0,
  deadJobsResolved: 0,
  unhandledJobs: 0,
  stuckEnriching: 0,
  unknownScopeRuns: 0,
  repairedScopeRuns: 0,
  unknownScopeCursors: 0,
  orphanKv: 0,
  orphanCanvasRows: 0,
  abandonedRuns: 0,
  expiredCanvases: 0,
});

export interface SweepOptions {
  now: Date;
  /** Job kinds a worker handles (the registry's). Without it the unhandled-jobs category is skipped. */
  knownKinds?: ReadonlySet<string>;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
}

const iso = (d: Date) => d.toISOString();

class NothingChanged extends Error {}

/** A count, or the sum of a record's counts. */
const total = (r: unknown): number => (typeof r === 'number' ? r : r && typeof r === 'object' ? Object.values(r).reduce<number>((a, v) => a + (typeof v === 'number' ? v : 0), 0) : 0);

/**
 * One category's writes in its own system change set, titled with what it did (History). Rolled back when it changed
 * nothing, so a clean database gets no empty "Hygiene" entries every day.
 */
async function inChangeSet<T>(db: Db, userId: string, reason: string, fn: (tx: Tx) => Promise<T>, summary?: (r: T) => string, changed: (r: T) => boolean = (r) => total(r) > 0): Promise<T> {
  let out: T | undefined;
  try {
    await withChangeSet({ db, userId, actor: actors.system(HYGIENE_ACTOR), reason, undoable: true }, async (tx, cs) => {
      out = await fn(tx);
      if (!changed(out)) throw new NothingChanged();
      if (summary) await tx.execute(sql`update change_sets set summary = ${summary(out).slice(0, 200)} where id = ${cs.id}`);
    });
  } catch (e) {
    if (!(e instanceof NothingChanged)) throw e;
  }
  return out as T;
}

/** A Health event (open until the next sweep finds nothing): what the sweep flagged instead of touching. */
async function flag(tx: Tx | Db, userId: string, code: string, n: number, message: string): Promise<void> {
  const fp = `hygiene|${code}`;
  if (!n) {
    await tx.execute(sql`update app_events set resolved_at = now() where owner_user_id = ${userId} and fingerprint = ${fp} and resolved_at is null`);
    return;
  }
  await tx.execute(sql`
    insert into app_events (owner_user_id, severity, component, code, error_class, message, detail, fingerprint)
    values (${userId}, 'warn', 'hygiene', ${code}, null, ${message.slice(0, 200)}, ${JSON.stringify({ count: n })}::jsonb, ${fp})
    on conflict (fingerprint) where resolved_at is null
    do update set message = excluded.message, detail = excluded.detail, last_occurred_at = now()`);
}

// ---------------------------------------------------------------------------
// 1. Stale drafts. Prevention: this TTL (drafts the engine made expire after 14 days with nothing to send them for),
//    OUTBOX-W for closed to-dos (withdraw.ts), and the subject check here for merged to-dos and VDPs that left.
// ---------------------------------------------------------------------------

export async function sweepStaleDrafts(db: Db, userId: string, o: SweepOptions): Promise<{ withdrawn: number; flagged: number }> {
  const cutoff = new Date(o.now.getTime() - STALE_DRAFT_DAYS * 86_400_000);
  const r = await db.execute<{ id: string; mine: boolean; why: 'stale' | 'gone' }>(sql`
    select d.id::text as id, (d.created_by in ('user', 'chat') or d.edited_by_user) as mine,
           case when d.work_item_id is not null and (w.id is null or w.merged_into_id is not null) then 'gone'
                when d.action_type = 'vdp_update' and d.payload -> 'target' ->> 'url' is not null
                     and not exists (select 1 from vdp_records v where v.owner_user_id = d.owner_user_id and v.url = d.payload -> 'target' ->> 'url') then 'gone'
                else 'stale' end as why
      from drafts d left join work_items w on w.id = d.work_item_id
     where d.owner_user_id = ${userId} and d.status in ('ready', 'failed') and d.updated_at < ${iso(cutoff)}::timestamptz
       and ((d.work_item_id is null and d.payload is null)
         or (d.work_item_id is not null and (w.id is null or w.merged_into_id is not null))
         or (d.action_type = 'vdp_update' and d.payload -> 'target' ->> 'url' is not null
             and not exists (select 1 from vdp_records v where v.owner_user_id = d.owner_user_id and v.url = d.payload -> 'target' ->> 'url')))`);
  const engine = r.rows.filter((x) => !x.mine);
  const flagged = r.rows.length - engine.length;
  await flag(db, userId, 'stale_user_drafts', flagged, `${flagged} draft${flagged === 1 ? '' : 's'} you wrote ${flagged === 1 ? 'has' : 'have'} waited ${STALE_DRAFT_DAYS}+ days with no to-do: send or discard ${flagged === 1 ? 'it' : 'them'} in the Outbox`);
  if (!engine.length) return { withdrawn: 0, flagged };
  const withdrawn = await inChangeSet(
    db,
    userId,
    'Hygiene: stale drafts',
    async (tx) => {
      let n = 0;
      for (const d of engine) {
        const res = await tx.execute(sql`
          update drafts set status = 'discarded', reject_reason = ${d.why === 'gone' ? SUBJECT_GONE_REASON : STALE_DRAFT_REASON}, version = version + 1, updated_at = ${iso(o.now)}::timestamptz
           where id = ${d.id}::uuid and owner_user_id = ${userId} and status in ('ready', 'failed')`);
        n += res.rowCount ?? 0;
      }
      return n;
    },
    (n) => `Hygiene: withdrew ${n} stale draft${n === 1 ? '' : 's'}`,
  );
  return { withdrawn: withdrawn ?? 0, flagged };
}

// ---------------------------------------------------------------------------
// 2. DC requests a delivered canvas handed off, whose DC Org62 now shows. Prevention: confirmDcRequests runs the same
//    rule on every DC sync (dc-requests.ts confirmHandedOffDcRequests), not only on an exact split.
// ---------------------------------------------------------------------------

async function writeCtx(tx: Tx, cs: WriteCtx['cs'], db: Db, userId: string, now: Date): Promise<WriteCtx> {
  const me = await tx.execute<{ person_id: string | null; name: string | null; tz: string | null }>(sql`select person_id, display_name as name, timezone as tz from users where id = ${userId}`);
  const m = me.rows[0];
  return { tx, cs, userId, me: { id: m?.person_id ?? userId, name: m?.name ?? 'me' }, now, extractorId: await ensureExtractor(db), timezone: m?.tz ?? 'America/Denver', kv: await loadKv(tx, userId) };
}

export async function sweepDcRequests(db: Db, userId: string, o: SweepOptions): Promise<number> {
  const live = await db.execute<{ n: number }>(sql`select count(*)::int as n from deal_contribution_requests where owner_user_id = ${userId} and status not in ('dismissed', 'verified')`);
  if (!live.rows[0]?.n) return 0;
  let n = 0;
  try {
    await withChangeSet({ db, userId, actor: actors.system(HYGIENE_ACTOR), reason: 'Hygiene: DC requests Org62 now shows', undoable: true }, async (tx, cs) => {
      n = await confirmHandedOffDcRequests(await writeCtx(tx, cs, db, userId, o.now));
      if (!n) throw new NothingChanged();
      await tx.execute(sql`update change_sets set summary = ${`Hygiene: reconciled ${n} DC request${n === 1 ? '' : 's'} with Org62 (confirmed, withdrawn or not created)`} where id = ${cs.id}`);
    });
  } catch (e) {
    if (!(e instanceof NothingChanged)) throw e;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 2b. Deals (DC-25): the flags and statuses Org62 no longer supports, and VDP items out of scope. Prevention: the
//     DC sync does the same on every Org62 pass (dc-requests.ts syncMyDcs, deals-sync.ts); this is the net for
//     data from before D-68 and for passes that never ran.
// ---------------------------------------------------------------------------

export async function sweepDeals(db: Db, userId: string, o: SweepOptions): Promise<{ staleDcFlags: number; staleDcStatus: number; vdpItemsOutOfScope: number }> {
  const zero = { staleDcFlags: 0, staleDcStatus: 0, vdpItemsOutOfScope: 0 };
  let out = zero;
  try {
    await withChangeSet({ db, userId, actor: actors.system(HYGIENE_ACTOR), reason: 'Hygiene: deals', undoable: true }, async (tx, cs) => {
      const w = await writeCtx(tx, cs, db, userId, o.now);
      out = { staleDcFlags: await clearStaleDcFlags(w), staleDcStatus: await sweepStaleAccountDcStatus(w), vdpItemsOutOfScope: await withdrawVdpItemsOutOfScope(w) };
      const n = out.staleDcFlags + out.staleDcStatus + out.vdpItemsOutOfScope;
      if (!n) throw new NothingChanged();
      const parts = [out.staleDcFlags ? `${out.staleDcFlags} stale DC flag${out.staleDcFlags === 1 ? '' : 's'}` : null, out.staleDcStatus ? `${out.staleDcStatus} stale DC status${out.staleDcStatus === 1 ? '' : 'es'}` : null, out.vdpItemsOutOfScope ? `${out.vdpItemsOutOfScope} VDP item${out.vdpItemsOutOfScope === 1 ? '' : 's'} out of scope` : null].filter(Boolean);
      await tx.execute(sql`update change_sets set summary = ${`Hygiene: cleared ${parts.join(', ')}`.slice(0, 200)} where id = ${cs.id}`);
    });
  } catch (e) {
    if (!(e instanceof NothingChanged)) throw e;
    out = zero;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Jobs. Dead jobs a later run of the same job succeeded after are history, not a failure to act on; jobs of a kind
//    no worker handles only ever dead-letter. Prevention: `enrich` and `tool.run` have handlers now, `agent.answer`
//    and `canvas.sync` are no longer queued, and tests/hygiene/job-kinds.test.ts fails when code queues a kind the
//    worker's registry does not handle.
// ---------------------------------------------------------------------------

/** The jobs a dead one is "the same job" as: the kind plus its connector / scope / item / connector id. */
const FAMILY = (t: string) => sql.raw(`coalesce(${t}.payload->>'connector','') || '|' || coalesce(${t}.payload->>'scope','') || '|' || coalesce(${t}.payload->>'connectorId','') || '|' || coalesce(${t}.payload->>'work_item_id', ${t}.payload->>'workItemId', '')`);

export async function sweepJobs(db: Db, userId: string, o: SweepOptions): Promise<{ resolved: number; unhandled: number }> {
  const r = await inChangeSet(db, userId, 'Hygiene: dead and unhandled jobs', async (tx) => {
    const sup = await tx.execute<{ id: string }>(sql`
      with sup as (
        select j.id, (select k.id from jobs k
                       where k.owner_user_id = j.owner_user_id and k.kind = j.kind and k.status = 'succeeded' and k.created_at > j.created_at
                         and ${FAMILY('k')} = ${FAMILY('j')}
                       order by k.id limit 1) as by
          from jobs j where j.owner_user_id = ${userId} and j.status = 'dead')
      update jobs j set status = 'cancelled', dead_at = null, superseded_by_id = sup.by, updated_at = now(),
             cancel_reason = 'superseded: a later run of the same job succeeded'
        from sup where j.id = sup.id and sup.by is not null
      returning j.id::text as id`);
    let unhandled = 0;
    if (o.knownKinds) {
      const kinds = [...o.knownKinds];
      const un = await tx.execute<{ id: string }>(sql`
        update jobs set status = 'cancelled', dead_at = null, finished_at = coalesce(finished_at, now()), updated_at = now(),
               cancel_reason = 'no handler: no worker runs this kind of job', lease_expires_at = null, locked_by = null
         where owner_user_id = ${userId} and status in ('queued', 'dead')
           and kind <> all(${kinds.length ? sql`array[${sql.join(kinds.map((k) => sql`${k}::text`), sql`, `)}]` : sql`array[]::text[]`})
        returning id::text as id`);
      unhandled = un.rows.length;
      sup.rows.push(...un.rows);
    }
    const ids = sup.rows.map((x) => x.id);
    if (ids.length) {
      const arr = sql`array[${sql.join(ids.map((i) => sql`${i}::bigint`), sql`, `)}]`;
      await tx.execute(sql`
        update notifications set status = 'resolved', resolved_at = now(), resolved_by = 'system', updated_at = now()
         where owner_user_id = ${userId} and kind = 'job_dead_lettered' and status in ('open', 'seen', 'snoozed') and job_id = any(${arr})`);
    }
    // a "dead-lettered" Health event whose kind and code no longer have a dead job
    await tx.execute(sql`
      update app_events e set resolved_at = now()
       where e.owner_user_id = ${userId} and e.component = 'worker.jobs' and e.code = 'job_dead_lettered' and e.resolved_at is null
         and not exists (select 1 from jobs j where j.owner_user_id = e.owner_user_id and j.status = 'dead'
                          and j.kind = e.detail->>'kind' and coalesce(j.last_error_code, '') = coalesce(e.detail->>'code', ''))`);
    return { resolved: sup.rows.length - unhandled, unhandled };
  }, (x) => `Hygiene: resolved ${x.resolved} dead job${x.resolved === 1 ? '' : 's'} a later run fixed, cancelled ${x.unhandled} no worker handles`);
  return r ?? { resolved: 0, unhandled: 0 };
}

// ---------------------------------------------------------------------------
// 4. To-dos stuck "enriching". Prevention: the `enrich` job has a real handler (src/jobs/handlers/enrich.ts).
// ---------------------------------------------------------------------------

export async function sweepStuckEnriching(db: Db, userId: string, o: SweepOptions): Promise<number> {
  const before = new Date(o.now.getTime() - ENRICH_GRACE_MS).toISOString();
  const r = await db.execute<{ id: string }>(sql`
    select split_part(s.key, '/', 3) as id from user_settings s
     where s.owner_user_id = ${userId} and s.key like 'cc.ext/work_items/%' and s.value -> 'enrichment' ->> 'status' = 'enriching'
       and coalesce((s.value -> 'enrichment' ->> 'startedAt')::timestamptz, s.updated_at) < ${before}::timestamptz
       and not exists (select 1 from jobs j where j.owner_user_id = s.owner_user_id and j.kind = ${ENRICH_JOB_KIND} and j.status in ('queued', 'running')
                         and coalesce(j.payload->>'workItemId', j.payload->>'work_item_id') = split_part(s.key, '/', 3))`);
  let n = 0;
  for (const x of r.rows) {
    if (!/^[0-9a-f-]{36}$/i.test(x.id)) continue;
    const res = await enrichWorkItem(db, userId, x.id, { now: o.now, reason: 'Hygiene: enriched a to-do left "enriching"' });
    if (res.status === 'done') n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 5. Scan runs on scopes that do not exist (`org62:org62:events`) and unprefixed placeholders (`dcs`, `manual`).
//    Prevention: the scan route validates scopes (400 with the valid list), the runtime refuses unknown scopes
//    (never registered, never "succeeded"), and placeholders carry the ledger's `<connector>:<scope>` id.
// ---------------------------------------------------------------------------

export async function sweepScanScopes(db: Db, userId: string, _o: SweepOptions): Promise<{ removed: number; repaired: number; cursors: number }> {
  const runs = await db.execute<{ scope: string; name: string; kind: string; n: number }>(sql`
    select r.scope, c.name, c.kind::text as kind, count(*)::int as n
      from scan_runs r join connectors c on c.id = r.connector_id
     where r.owner_user_id = ${userId}
     group by r.scope, c.name, c.kind`);
  const curs = await db.execute<{ id: string; scope: string; name: string; kind: string }>(sql`
    select sc.id::text as id, sc.scope, c.name, c.kind::text as kind
      from scan_cursors sc join connectors c on c.id = sc.connector_id where sc.owner_user_id = ${userId}`);
  const conn = (name: string, kind: string) => connectorOfName(name) ?? connectorOfName(kind);
  const repairs: Array<{ from: string; to: string | null; name: string }> = [];
  for (const r of runs.rows) {
    const c = conn(r.name, r.kind);
    if (!c) continue;
    const to = repairScopeId(c, r.scope);
    if (to !== r.scope) repairs.push({ from: r.scope, to, name: r.name });
  }
  const badCursors = curs.rows.filter((x) => {
    const c = conn(x.name, x.kind);
    if (!c) return false;
    const i = x.scope.indexOf(':');
    return !(i > 0 && x.scope.slice(0, i) === c && isKnownScope(c, x.scope.slice(i + 1)));
  });
  const r = await inChangeSet(db, userId, 'Hygiene: scan runs on scopes that do not exist', async (tx) => {
    let removed = 0;
    let repaired = 0;
    for (const rp of repairs) {
      const where = sql`r.owner_user_id = ${userId} and r.scope = ${rp.from} and r.connector_id in (select id from connectors where owner_user_id = ${userId} and name = ${rp.name})`;
      if (rp.to) {
        const u = await tx.execute(sql`update scan_runs r set scope = ${rp.to} where ${where}`);
        repaired += u.rowCount ?? 0;
        continue;
      }
      // its queued job (if any) never runs either
      await tx.execute(sql`
        update jobs set status = 'cancelled', finished_at = now(), updated_at = now(), cancel_reason = 'unknown scan scope'
         where owner_user_id = ${userId} and status = 'queued' and id in (select r.job_id from scan_runs r where ${where} and r.job_id is not null)`);
      // a run on a scope that does not exist read nothing: it goes (a row that did read items keeps its history)
      const d = await tx.execute(sql`delete from scan_runs r where ${where} and r.status <> 'running' and r.items_seen = 0`);
      removed += d.rowCount ?? 0;
    }
    for (const c of badCursors) await tx.execute(sql`delete from scan_cursors where id = ${c.id}::uuid and owner_user_id = ${userId}`);
    // runtime jobs still queued on a scope the catalog does not know
    const q = await tx.execute<{ id: string; connector: string; scope: string }>(sql`
      select id::text as id, payload->>'connector' as connector, payload->>'scope' as scope from jobs
       where owner_user_id = ${userId} and status = 'queued' and kind like 'scan.%' and payload->>'kind' = 'scan'`);
    for (const j of q.rows) {
      const c = connectorOfName(j.connector);
      if (c && !isKnownScope(c, j.scope ?? '')) {
        await tx.execute(sql`update jobs set status = 'cancelled', finished_at = now(), updated_at = now(), cancel_reason = 'unknown scan scope' where id = ${j.id}::bigint and status = 'queued'`);
        removed++;
      }
    }
    return { removed, repaired, cursors: badCursors.length };
  }, (x) => `Hygiene: removed ${x.removed} scan run${x.removed === 1 ? '' : 's'} on scopes that do not exist, repaired ${x.repaired}, ${x.cursors} cursor${x.cursors === 1 ? '' : 's'}`);
  return r ?? { removed: 0, repaired: 0, cursors: 0 };
}

// ---------------------------------------------------------------------------
// 6. Side-car kv rows of rows that no longer exist, and kv rows of features no longer present. Prevention: dropping a
//    projected activity row or time block deletes its ext in the same write (store/projections.ts), and this sweep is
//    the net for every other side-car. Only `cc.ext/<table>/<id>` rows of a REAL table are matched to their row:
//    `cc.ext/app_runs/…`, `cc.ext/mapping_questions/…` and the like are singletons with no table behind them, kept.
//    `settings.*` (yours) is never touched.
// ---------------------------------------------------------------------------

/**
 * kv prefixes of features the app no longer has: removed by the sweep. Add a prefix here when a feature that wrote kv
 * rows is retired (never a prefix any code still reads; tests/hygiene/hygiene-db.test.ts checks the list).
 */
export const RETIRED_KV_PREFIXES: readonly string[] = [];

export async function sweepOrphanKv(db: Db, userId: string, _o: SweepOptions): Promise<number> {
  const t = await db.execute<{ t: string }>(sql`
    select distinct split_part(key, '/', 2) as t from user_settings
     where owner_user_id = ${userId} and key like 'cc.ext/%' and to_regclass('public.' || split_part(key, '/', 2)) is not null`);
  const tables = t.rows.map((x) => x.t).filter((x) => /^[a-z_][a-z0-9_]*$/.test(x));
  const r = await inChangeSet(db, userId, 'Hygiene: side-car rows of deleted rows', async (tx) => {
    let n = 0;
    for (const table of tables) {
      const prefix = `cc.ext/${table}/`;
      const res = await tx.execute(sql`
        delete from user_settings s where s.owner_user_id = ${userId} and s.key like ${`${prefix}%`}
           and not exists (select 1 from ${sql.raw(`public.${table}`)} x where x.id::text = substr(s.key, ${prefix.length + 1}))`);
      n += res.rowCount ?? 0;
    }
    for (const prefix of RETIRED_KV_PREFIXES) {
      const res = await tx.execute(sql`delete from user_settings where owner_user_id = ${userId} and key like ${`${prefix}%`} and key not like 'settings.%'`);
      n += res.rowCount ?? 0;
    }
    const readin = await tx.execute(sql`
      delete from user_settings s where s.owner_user_id = ${userId} and s.key like 'readin/work_item/%'
         and not exists (select 1 from work_items w where w.id::text = split_part(s.key, '/', 3))`);
    const plans = await tx.execute(sql`
      delete from user_settings s where s.owner_user_id = ${userId} and s.key like 'cc.chat.plan/%'
         and not exists (select 1 from chat_threads t where t.id::text = s.value ->> 'threadId')`);
    return n + (readin.rowCount ?? 0) + (plans.rowCount ?? 0);
  }, (n) => `Hygiene: removed ${n} side-car row${n === 1 ? '' : 's'} of deleted rows`);
  return r ?? 0;
}

// ---------------------------------------------------------------------------
// 7. Activity rows "on a canvas" whose canvas never reached Slack (rejected, discarded, or none at all: the old
//    Sync to canvas). Prevention: only a delivered canvas moves rows to synced_to_canvas (db/outbox.ts), and the old
//    syncCanvas route no longer marks rows (db/index.ts).
// ---------------------------------------------------------------------------

export async function sweepCanvasRows(db: Db, userId: string, o: SweepOptions): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`select id::text as id from activity_entries where owner_user_id = ${userId} and status = 'synced_to_canvas'`);
  if (!rows.rows.length) return 0;
  const d = await db.execute<{ id: string; status: DbDraftStatus; payload: Draft['destination'] | null }>(sql`
    select id::text as id, status::text as status, payload from drafts where owner_user_id = ${userId} and payload ->> 'action' = 'slack_canvas.create'`);
  const holds = canvasHolds(d.rows.filter((x) => x.payload).map((x) => ({ id: x.id, status: draftStatusFromDb(x.status), destination: x.payload! })));
  const orphan = rows.rows.filter((r) => !holds.sent?.has(r.id) && !holds.rows.has(r.id)).map((r) => r.id);
  if (!orphan.length) return 0;
  const r = await inChangeSet(db, userId, 'Hygiene: activity rows with no canvas', async (tx) => {
    const res = await tx.execute(sql`
      update activity_entries set status = 'approved', synced_to_canvas_at = null, version = version + 1, updated_at = ${iso(o.now)}::timestamptz
       where owner_user_id = ${userId} and status = 'synced_to_canvas'
         and id::text = any(array[${sql.join(orphan.map((i) => sql`${i}::text`), sql`, `)}])`);
    return res.rowCount ?? 0;
  }, (n) => `Hygiene: ${n} row${n === 1 ? '' : 's'} back to approved (no canvas reached Slack)`);
  return r ?? 0;
}

// ---------------------------------------------------------------------------
// 8. Scan runs left running or queued after their job ended (a worker killed mid-run). Prevention: this sweep runs at
//    every worker start, right where a crash leaves them.
// ---------------------------------------------------------------------------

export async function sweepAbandonedRuns(db: Db, userId: string, o: SweepOptions): Promise<number> {
  const before = new Date(o.now.getTime() - ABANDONED_RUN_MS).toISOString();
  const r = await inChangeSet(db, userId, 'Hygiene: abandoned scan runs', async (tx) => {
    const running = await tx.execute(sql`
      update scan_runs r set status = 'failed', finished_at = ${iso(o.now)}::timestamptz, error_code = 'abandoned',
             error_message = 'abandoned: the worker stopped during this run (its window runs again)'
       where r.owner_user_id = ${userId} and r.status = 'running' and r.started_at < ${before}::timestamptz`);
    const queued = await tx.execute(sql`
      update scan_runs r set status = 'cancelled', finished_at = ${iso(o.now)}::timestamptz,
             error_message = 'its job ended without running it'
       where r.owner_user_id = ${userId} and r.status = 'queued' and r.started_at < ${before}::timestamptz
         and not exists (select 1 from jobs j where j.id = r.job_id and j.status in ('queued', 'running'))`);
    return (running.rowCount ?? 0) + (queued.rowCount ?? 0);
  }, (n) => `Hygiene: closed ${n} abandoned scan run${n === 1 ? '' : 's'}`);
  return r ?? 0;
}

// ---------------------------------------------------------------------------
// 9. D-65 (TL-24): logging canvas items never applied. One whose rows are all gone (logged by hand, declined,
//    cancelled, dismissed, no longer approved: the Apply preflight would refuse it) or that waited 14 days expires
//    with a notice; its rows (still approved) go on the next batch. Prevention: the same preflight at every Apply,
//    and an edit unstages a held row (src/server/time/canvas-preflight.ts).
// ---------------------------------------------------------------------------

export async function sweepStaleCanvases(db: Db, userId: string, o: SweepOptions): Promise<number> {
  const r = await db.execute<{ id: string; payload: Draft['destination'] | null; updated_at: Date | string }>(sql`
    select id::text as id, payload, updated_at from drafts
     where owner_user_id = ${userId} and payload ->> 'action' = 'slack_canvas.create' and status in ('ready', 'failed')
       -- 2026-11-13 audit B3: never one whose last live Apply may have created it (no answer, or the app stopped
       -- mid-way): it stays, holding its rows, until you check Slack and Apply again or reject it
       and not exists (select 1 from draft_send_attempts a where a.draft_id = drafts.id and not a.dry_run and a.status in ('unknown', 'started')
                        and a.attempt_no = (select max(b.attempt_no) from draft_send_attempts b where b.draft_id = drafts.id and not b.dry_run))`);
  const items = r.rows.filter((x): x is typeof x & { payload: Extract<Draft['destination'], { kind: 'action' }> } => !!x.payload && x.payload.kind === 'action' && adminSurfaceOf({ destination: x.payload }) === 'log');
  const cutoff = o.now.getTime() - CANVAS_EXPIRY_DAYS * 86_400_000;
  const expire: { id: string; reason: string }[] = [];
  if (items.length) {
    const ctx = await dbPreflightContext(db, userId, items.map((x) => canvasInputOf(x.payload)), { taskTypeRequired: loggingProfile(await loadPersona(db, userId)).taskTypeRequired, useCases: true });
    for (const x of items) {
      const p = preflightCanvas(canvasInputOf(x.payload), ctx);
      if (p.changed && p.empty) expire.push({ id: x.id, reason: `${NOTHING_LEFT_PREFIX}: ${preflightSummary(p)}` });
      else if (new Date(x.updated_at).getTime() < cutoff) expire.push({ id: x.id, reason: EXPIRED_CANVAS_REASON });
    }
  }
  const n =
    (expire.length
      ? await inChangeSet(
          db,
          userId,
          'Hygiene: logging canvases never applied',
          async (tx) => {
            let k = 0;
            for (const e of expire) {
              const res = await tx.execute(sql`
                update drafts set status = 'discarded', reject_reason = ${e.reason.slice(0, 300)}, version = version + 1, updated_at = ${iso(o.now)}::timestamptz
                 where id = ${e.id}::uuid and owner_user_id = ${userId} and status in ('ready', 'failed')`);
              k += res.rowCount ?? 0;
            }
            return k;
          },
          (k) => `Hygiene: ${k} logging canvas${k === 1 ? '' : 'es'} expired (never applied); their rows go on the next batch`,
        )
      : 0) ?? 0;
  // the notice (Health): open until a sweep expires none
  await flag(db, userId, 'expired_canvases', n, `${n} logging canvas${n === 1 ? '' : 'es'} expired: never applied for ${CANVAS_EXPIRY_DAYS} days, or nothing left to log. Their rows go on the next batch (Activity ▸ Log it)`);
  return n;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export async function runHygieneSweep(db: Db, userId: string, o: SweepOptions): Promise<{ counts: HygieneCounts; errors: string[] }> {
  const counts = zeroCounts();
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${name}:${(e as { code?: string }).code ?? (e as Error).name}`);
      o.log?.('hygiene: category failed', { category: name, code: (e as { code?: string }).code ?? (e as Error).name });
    }
  };
  await step('drafts', async () => {
    const r = await sweepStaleDrafts(db, userId, o);
    counts.staleDrafts = r.withdrawn;
    counts.staleDraftsFlagged = r.flagged;
  });
  await step('dc_requests', async () => void (counts.dcRequestsConfirmed = await sweepDcRequests(db, userId, o)));
  await step('deals', async () => {
    const r = await sweepDeals(db, userId, o);
    counts.staleDcFlags = r.staleDcFlags;
    counts.staleDcStatus = r.staleDcStatus;
    counts.vdpItemsOutOfScope = r.vdpItemsOutOfScope;
  });
  await step('jobs', async () => {
    const r = await sweepJobs(db, userId, o);
    counts.deadJobsResolved = r.resolved;
    counts.unhandledJobs = r.unhandled;
  });
  await step('enriching', async () => void (counts.stuckEnriching = await sweepStuckEnriching(db, userId, o)));
  await step('scan_scopes', async () => {
    const r = await sweepScanScopes(db, userId, o);
    counts.unknownScopeRuns = r.removed;
    counts.repairedScopeRuns = r.repaired;
    counts.unknownScopeCursors = r.cursors;
  });
  await step('kv', async () => void (counts.orphanKv = await sweepOrphanKv(db, userId, o)));
  await step('canvas_rows', async () => void (counts.orphanCanvasRows = await sweepCanvasRows(db, userId, o)));
  await step('runs', async () => void (counts.abandonedRuns = await sweepAbandonedRuns(db, userId, o)));
  await step('canvases', async () => void (counts.expiredCanvases = await sweepStaleCanvases(db, userId, o)));
  return { counts, errors };
}
