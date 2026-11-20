/** Shared scenario plumbing: drain, counts, invariants, artifacts. */
import { sql } from 'drizzle-orm';

import { checkInvariants, CursorMonitor, type InvariantOptions, type InvariantResult } from '../invariants';
import { loadProfile } from '../lib/profile';
import { World, type WorldOptions } from '../driver/world';

export interface ScenarioResult {
  invariants: InvariantResult[];
  checks?: Record<string, unknown>;
  replay: unknown;
  costUsd: number;
  counts: Record<string, unknown>;
}

export interface ScenarioCtx {
  log: (m: string) => void;
}

export interface Scenario {
  description: string;
  run(ctx: ScenarioCtx): Promise<ScenarioResult>;
}

export async function makeWorld(ctx: ScenarioCtx, o: Omit<WorldOptions, 'profile' | 'log'> & { profile?: WorldOptions['profile'] }): Promise<World> {
  const w = new World({ ...o, profile: o.profile ?? loadProfile(), log: ctx.log });
  await w.init();
  return w;
}

/** Stop planning, then run until every queued job has run (jumping to run_at), then a graceful shutdown. */
export async function drain(w: World, maxSteps = 400): Promise<void> {
  const hooks = (w.runtime as unknown as { o: { hooks?: Array<{ name: string }> } }).o;
  hooks.hooks = (hooks.hooks ?? []).filter((h) => h.name !== 'scanner.plan');
  for (let i = 0; i < maxSteps; i++) {
    const started = await w.step();
    if (started) continue;
    const r = await w.handle.db.execute<{ t: string | null; n: string }>(sql`select min(run_at)::text as t, count(*)::text as n from jobs where status = 'queued'`);
    if (Number(r.rows[0]!.n) === 0 && w.runtime.activeCount === 0) break;
    const t = r.rows[0]!.t ? Date.parse(r.rows[0]!.t) : w.clock.nowMs() + 60_000;
    await w.clock.jumpTo(Math.max(t + 50, w.clock.nowMs() + 1000));
  }
  await w.shutdown('drained');
}

export async function counts(w: World): Promise<Record<string, unknown>> {
  const one = async (s: ReturnType<typeof sql>) => (await w.handle.db.execute<Record<string, string>>(s)).rows;
  const [si, wi, ev, runs, jobs, cov, unl] = await Promise.all([
    one(sql`select source::text as k, count(*)::text as n from source_items group by 1`),
    one(sql`select kind::text || ':' || status::text as k, count(*)::text as n from work_items group by 1`),
    one(sql`select role::text as k, count(*)::text as n from work_item_evidence group by 1`),
    one(sql`select scope || ':' || status::text as k, count(*)::text as n from scan_runs group by 1`),
    one(sql`select kind || ':' || status::text as k, count(*)::text as n from jobs group by 1`),
    one(sql`select scope as k, count(*)::text as n from scan_ledger_entries where outcome = 'complete' group by 1`),
    one(sql`select status::text as k, count(*)::text as n from reconcile_findings group by 1`),
  ]);
  const m = (rows: Array<Record<string, string>>) => Object.fromEntries(rows.map((r) => [r.k, Number(r.n)]));
  return { sourceItems: m(si), workItems: m(wi), evidence: m(ev), scanRuns: m(runs), jobs: m(jobs), ledger: m(cov), findings: m(unl) };
}

export async function finish(w: World, inv: InvariantOptions = {}, extra: InvariantResult[] = [], checks: Record<string, unknown> = {}, monitor?: CursorMonitor): Promise<ScenarioResult> {
  await drain(w);
  if (monitor) await monitor.observe(w.handle.db);
  const invariants = [...(await checkInvariants(w.handle.db, inv)), ...(monitor ? [monitor.result()] : []), ...extra];
  const rs = w.replayStats();
  const misses = (rs.slack?.misses ?? 0) + (rs.google?.misses ?? 0) + (rs.org62?.misses ?? 0);
  const leaks = (rs.slack?.leaks ?? 0) + (rs.google?.leaks ?? 0) + (rs.org62?.leaks ?? 0);
  invariants.push({ name: 'H1 replay never leaked data newer than the simulated now', ok: leaks === 0, detail: `leaks=${leaks}` });
  invariants.push({ name: 'H2 replay misses (harness gaps; 0 = every call answered from recordings)', ok: misses === 0, detail: `misses=${misses}${misses ? `: ${[...(rs.slack?.missReasons ?? []), ...(rs.google?.missReasons ?? []), ...(rs.org62?.missReasons ?? [])].slice(0, 4).join(' | ')}` : ''}`, info: true });
  const decoy = w.toolLog.filter((t) => t.fault === 'DISALLOWED_TOOL_EXECUTED').length;
  invariants.push({ name: 'H3 no non-allowlisted tool ever executed', ok: decoy === 0, detail: `executed=${decoy}` });
  const c = await counts(w);
  const res: ScenarioResult = { invariants, checks, replay: rs, costUsd: w.costUsd, counts: c };
  w.saveArtifacts({ invariants, checks, counts: c });
  await w.close();
  return res;
}
