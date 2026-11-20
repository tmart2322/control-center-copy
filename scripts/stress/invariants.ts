/**
 * Invariant checker: SQL run against a scenario DB after every scenario (and, for cursor monotonicity, after
 * every driver step). Each check returns pass/fail with counts and a few ids (never content).
 */
import { sql } from 'drizzle-orm';

import type { Db } from '../../src/db/client';

export interface InvariantResult {
  name: string;
  ok: boolean;
  detail: string;
  /** Informational checks never fail a scenario. */
  info?: boolean;
}

export interface InvariantOptions {
  /** Dead jobs the scenario injected on purpose. */
  allowedDead?: number;
  /** Scopes whose coverage may legitimately have holes (e.g. a paused connector). */
  holeTolerantScopes?: string[];
  /** One-query coverage question: scope + local window. */
  coverageQuestion?: { scope: string; from: string; to: string };
}

const q = async <T extends Record<string, unknown>>(db: Db, s: ReturnType<typeof sql>) => (await db.execute<T>(s)).rows;

export async function checkInvariants(db: Db, o: InvariantOptions = {}): Promise<InvariantResult[]> {
  const out: InvariantResult[] = [];
  const push = (name: string, ok: boolean, detail: string, info = false) => out.push({ name, ok, detail, info });

  // I1 no duplicate source items per (owner, dedupeKey); same external id under two dedupe keys is a drift.
  const dup = await q<{ n: string }>(db, sql`select count(*) as n from (select owner_user_id, dedupe_key from source_items group by 1, 2 having count(*) > 1) x`);
  // The trainings fetcher deliberately records a second view of a training email (`training:gmail:<id>`, kind
  // training_notice); that pair is reported, not failed. Any other external id under two keys is drift.
  const dupExt = await q<{ n: string; dual: string }>(db, sql`
    select count(*) filter (where not dual)::text as n, count(*) filter (where dual)::text as dual from (
      select owner_user_id, source, external_id, bool_and(dedupe_key like 'training:%' or dedupe_key = 'gmail:' || external_id) and count(*) = 2 as dual
        from source_items group by 1, 2, 3 having count(distinct dedupe_key) > 1) x`);
  push('I1 no duplicate source items', Number(dup[0]!.n) === 0 && Number(dupExt[0]!.n) === 0, `dupKeys=${dup[0]!.n} externalIdsWithSeveralKeys=${dupExt[0]!.n} (training dual views=${dupExt[0]!.dual})`);

  // I2 + I3 per scope, computed from the ledger: merged complete coverage from the first scan must reach the
  // cursor (never ahead of coverage) with no hole (1 s tolerance).
  const scopes = await q<{ connector_id: string; scope: string; hw: string }>(db, sql`
    select connector_id, scope, high_watermark_at::text as hw from scan_cursors where high_watermark_at is not null
       and scope not like '%:reconcile:%' and scope not like '%:thread:%' and scope not like '%:completion:%'`); // pseudo-scopes (reconcile, targeted threads, the CMP-1 completion pass): bookkeeping cursors, no time coverage
  const ahead: string[] = [];
  const holeScopes: string[] = [];
  for (const sc of scopes) {
    const rows = await q<{ f: string; t: string }>(db, sql`
      select lower(covered)::text as f, upper(covered)::text as t from scan_ledger_entries
       where connector_id = ${sc.connector_id} and scope = ${sc.scope} and outcome = 'complete' and covered is not null and not isempty(covered)
       order by lower(covered)`);
    const hw = Date.parse(sc.hw);
    const rs = rows.map((r) => ({ a: Date.parse(r.f), b: Date.parse(r.t) })).sort((x, y) => x.a - y.a);
    if (!rs.length) {
      ahead.push(sc.scope);
      continue;
    }
    let at = rs[0]!.a;
    let holesHere = 0;
    for (const r of rs) {
      if (r.a > hw) break;
      if (r.a > at + 1000) holesHere++;
      at = Math.max(at, r.b);
    }
    if (at < hw - 1000) ahead.push(sc.scope);
    if (holesHere && !(o.holeTolerantScopes ?? []).includes(sc.scope)) holeScopes.push(`${sc.scope}(${holesHere})`);
  }
  push('I2 cursor never ahead of coverage', ahead.length === 0, `${scopes.length} cursors; ahead: ${ahead.slice(0, 6).join(', ') || 'none'}`);
  push('I3 no coverage holes first-scan → cursor', holeScopes.length === 0, holeScopes.length ? `holes in ${holeScopes.slice(0, 6).join(', ')}` : 'none');

  // I4 every job terminal after drain, no orphaned leases, no dead jobs except injected ones.
  const jobs = await q<{ status: string; n: string }>(db, sql`select status::text, count(*)::text as n from jobs group by 1`);
  const by = Object.fromEntries(jobs.map((j) => [j.status, Number(j.n)]));
  const orphan = await q<{ n: string }>(db, sql`select count(*)::text as n from jobs where status = 'running'`);
  const dead = by.dead ?? 0;
  push('I4 jobs terminal, no orphaned leases, no unexpected dead', Number(orphan[0]!.n) === 0 && dead <= (o.allowedDead ?? 0), `by status ${JSON.stringify(by)}; running=${orphan[0]!.n}; dead=${dead} (allowed ${o.allowedDead ?? 0})`);
  const runningRuns = await q<{ n: string }>(db, sql`select count(*)::text as n from scan_runs where status = 'running'`);
  push('I4b no scan run left running', Number(runningRuns[0]!.n) === 0, `running scan_runs=${runningRuns[0]!.n}`);

  // I5 no item proposed twice for the same ask: one source item is the CREATING origin (an item's first origin
  // evidence) of at most one work item. A message that is also linked as a further origin of another item (one
  // message with two asks, the same ask by mail and Slack, or a role misassignment) is reported (I5c) and scored.
  const twice = await q<{ n: string }>(db, sql`
    with firsts as (select distinct on (work_item_id) work_item_id, source_item_id from work_item_evidence
                     where role = 'origin' and source_item_id is not null order by work_item_id, created_at, id)
    select count(*)::text as n from (select source_item_id from firsts group by 1 having count(*) > 1) x`);
  push('I5 no source item is the creating origin of two items', Number(twice[0]!.n) === 0, `sourceItemsCreatingSeveralItems=${twice[0]!.n}`);
  const shared = await q<{ n: string }>(db, sql`
    select count(*)::text as n from (select source_item_id from work_item_evidence where role = 'origin' and source_item_id is not null
                                     group by 1 having count(distinct work_item_id) > 1) x`);
  push('I5c source items that are an origin of several items (informational: multi-ask, cross-source, or a misassigned role; scored)', true, `n=${shared[0]!.n}`, true);
  const sameTitle = await q<{ n: string }>(db, sql`
    select count(*)::text as n from (select owner_user_id, lower(title) from work_items where status not in ('dismissed') group by 1, 2 having count(*) > 1) x`);
  push('I5b duplicate titles (informational; cross-source dupes are scored against the answer key)', true, `duplicateTitles=${sameTitle[0]!.n}`, true);

  // I6 evidence references are valid (same owner; source item exists; not purged-and-referenced as origin of nothing).
  const bad = await q<{ n: string }>(db, sql`
    select count(*)::text as n from work_item_evidence ev
      left join work_items w on w.id = ev.work_item_id
      left join source_items s on s.id = ev.source_item_id
     where w.id is null or (ev.source_item_id is not null and (s.id is null or s.owner_user_id <> w.owner_user_id))`);
  push('I6 evidence references valid', Number(bad[0]!.n) === 0, `invalid=${bad[0]!.n}`);

  // I7 coverage never claims time AFTER its run window (that would hide a gap). Claims before the window are real
  // lookbacks (Calendar lists two days back, Gmail overlaps) and are reported, not failed.
  const after = await q<{ n: string }>(db, sql`
    select count(*)::text as n from scan_ledger_entries e join scan_runs r on r.id = e.scan_run_id
     where e.outcome = 'complete' and e.covered is not null and not isempty(e.covered) and upper(e.covered) > r.window_end + interval '1 second'`);
  const before = await q<{ k: string; n: string }>(db, sql`
    select e.scope as k, count(*)::text as n from scan_ledger_entries e join scan_runs r on r.id = e.scan_run_id
     where e.outcome = 'complete' and e.covered is not null and not isempty(e.covered) and lower(e.covered) < r.window_start - interval '10 minutes' group by 1`);
  push('I7 coverage never claims past its run window', Number(after[0]!.n) === 0, `after=${after[0]!.n}; lookback-before-window: ${before.map((b) => `${b.k}=${b.n}`).join(', ') || 'none'}`);

  // I11 the coverage question is one query.
  if (o.coverageQuestion) {
    const cq = o.coverageQuestion;
    const rows = await q<{ n: string; runs: string; covered: string | null }>(db, sql`
      select count(*)::text as n, count(distinct scan_run_id)::text as runs,
             (select range_agg(covered * tstzrange(${cq.from}::timestamptz, ${cq.to}::timestamptz))::text from scan_ledger_entries
               where scope = ${cq.scope} and outcome = 'complete' and covered && tstzrange(${cq.from}::timestamptz, ${cq.to}::timestamptz)) as covered
        from scan_ledger_entries where scope = ${cq.scope} and outcome = 'complete' and covered && tstzrange(${cq.from}::timestamptz, ${cq.to}::timestamptz)`);
    const r = rows[0]!;
    push(`I11 coverage question (${cq.scope})`, Number(r.n) > 0, `ledger rows=${r.n} runs=${r.runs} covered=${r.covered ?? 'none'}`);
  }
  return out;
}

/** Snapshot of every scope's cursor, for monotonicity across steps. */
export async function cursorSnapshot(db: Db): Promise<Record<string, number>> {
  const r = await q<{ scope: string; hw: string }>(db, sql`select scope, high_watermark_at::text as hw from scan_cursors where high_watermark_at is not null`);
  return Object.fromEntries(r.map((x) => [x.scope, Date.parse(x.hw)]));
}

export class CursorMonitor {
  private last: Record<string, number> = {};
  readonly regressions: string[] = [];
  async observe(db: Db): Promise<void> {
    const s = await cursorSnapshot(db);
    for (const [k, v] of Object.entries(s)) {
      if (this.last[k] !== undefined && v < this.last[k]!) this.regressions.push(`${k}: ${new Date(this.last[k]!).toISOString()} → ${new Date(v).toISOString()}`);
      this.last[k] = Math.max(v, this.last[k] ?? v);
    }
  }
  result(): InvariantResult {
    return { name: 'I2b cursors monotonic across steps', ok: this.regressions.length === 0, detail: this.regressions.slice(0, 5).join('; ') || 'monotonic' };
  }
}

/** Catch-up order: within a catch-up batch, the head (newest hour) runs first, then backfill oldest → newest. */
export async function catchUpOrder(db: Db, scope: string, since: string): Promise<InvariantResult> {
  const runs = await q<{ ws: string; we: string; st: string; trig: string }>(db, sql`
    select window_start::text as ws, window_end::text as we, started_at::text as st, trigger::text as trig
      from scan_runs where scope = ${scope} and started_at >= ${since}::timestamptz and status in ('succeeded', 'failed')
     order by started_at, id`);
  // Planned windows only: retries of a window (same bounds), continuations and splits (inside an earlier window) are
  // follow-ups of a planned job, not plan order.
  const cu: typeof runs = [];
  for (const r of runs.filter((x) => /catch/.test(x.trig))) {
    const ws = Date.parse(r.ws);
    const we = Date.parse(r.we);
    if (cu.some((k) => Date.parse(k.ws) <= ws && we <= Date.parse(k.we))) continue;
    cu.push(r);
  }
  if (cu.length < 2) return { name: `I8 head first, then backfill oldest→newest (${scope})`, ok: true, detail: `catch-up runs=${cu.length} (nothing to order)`, info: true };
  const head = cu[0]!;
  const maxEnd = Math.max(...cu.map((r) => Date.parse(r.we)));
  const headOk = Date.parse(head.we) >= maxEnd - 1000;
  const rest = cu.slice(1).filter((r) => Date.parse(r.we) < Date.parse(head.ws) + 1000);
  let asc = true;
  for (let i = 1; i < rest.length; i++) if (Date.parse(rest[i]!.ws) < Date.parse(rest[i - 1]!.ws)) asc = false;
  return { name: `I8 head first, then backfill oldest→newest (${scope})`, ok: headOk && asc, detail: `runs=${cu.length} headFirst=${headOk} backfillAscending=${asc}` };
}
