/**
 * CMP-1: one real (writing) completion pass over a finished scenario DB, then the real `reevaluate` job: the path
 * a new skill version takes in production on its first pass (no watermark: every open item is checked back to its
 * own ask). Evidence goes through the scanner writer, the closure machine decides, and auto-closed items must show
 * in "Closed for you" (statement Q6) with an Undo change set. Ledgered as `completion`; stdout carries counts only.
 * The scenario DB is modified (drop it afterwards).
 *   npx tsx scripts/stress/completion-live-pass.ts <block> <scenarioDb> [label]
 */
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { statementSql } from '../../src/db/queries';
import { JobRegistry } from '../../src/jobs/registry';
import { reevaluateHandler } from '../../src/jobs/handlers/reevaluate';
import { pgReevaluateEnqueuer } from '../../src/jobs/scan';
import { agentSdkCompletionModel, runCompletionPass, type CompletionModel } from '../../src/scanner/completion';
import { DbScannerStore } from '../../src/scanner/store-db';
import { WorkerRuntime } from '../../src/worker/runtime';

import { loadJudge, scoreSignals } from './completion-score';
import { assertBudget, recordSpend } from './lib/ledger';
import { privDir, writePriv } from './lib/paths';
import { SimClock } from './lib/sim-clock';

async function main() {
  const [block, dbName, label = `${dbName}-live-pass`] = process.argv.slice(2);
  const j = await loadJudge(block!, dbName!);
  const db = j.h.db;
  try {
    const clock = await SimClock.fromDb(db);
    await clock.bindDb(db);
    const u = await db.execute<{ id: string; name: string | null }>(sql`select id, display_name as name from users order by created_at limit 1`);
    const userId = u.rows[0]!.id;
    const store = new DbScannerStore({ db, userId, clock: () => clock.now() });
    const real = agentSdkCompletionModel({ timeoutMs: 120_000 });
    let spend = 0;
    const model: CompletionModel = async (req) => {
      assertBudget(0.02);
      const r = await real(req);
      spend += r.costUsd;
      recordSpend({ scenario: `completion-live-pass:${label}`, kind: 'completion', model: req.model, costUsd: r.costUsd, note: 'one real pass, no watermark' });
      return r;
    };
    const startedAt = clock.now().toISOString();
    const res = await runCompletionPass({ store, model, now: clock.now(), watermark: null, meName: u.rows[0]!.name ?? undefined, reevaluate: pgReevaluateEnqueuer(db, userId) });

    // The closure machine on the real path: drain the re-evaluations the evidence queued.
    const registry = new JobRegistry();
    registry.register({ kind: 'reevaluate', queue: 'engine', wired: true, description: 'reevaluate', handler: reevaluateHandler({ supersededWaitMs: 500 }) });
    const rt = new WorkerRuntime({ db, userId, workerId: `completion-live-pass-${process.pid}`, registry, services: {}, pools: [{ name: 'engine', queues: ['engine'], concurrency: 2 }], clock: () => clock.now(), listenUrl: null, hooks: [], log: () => undefined, drainMs: 500 });
    try {
      for (let i = 0; i < 120; i++) {
        await rt.reap();
        await rt.pollOnce();
        await rt.idle(60_000);
        const open = await db.execute<{ n: number; t: string | null }>(sql`select count(*)::int as n, min(run_at)::text as t from jobs where kind = 'reevaluate' and status in ('queued', 'running')`);
        if (!open.rows[0]!.n) break;
        const t = open.rows[0]!.t ? Date.parse(open.rows[0]!.t) : clock.nowMs();
        if (t > clock.nowMs()) await clock.jumpTo(t + 100);
      }
    } finally {
      await rt.stop('done');
    }

    const tr = await db.execute<{ wid: string; to: string; cs: string | null }>(sql`
      select t.work_item_id as wid, t.to_status::text as to, t.change_set_id::text as cs
        from work_item_transitions t join work_item_evidence e on e.id = t.evidence_id
       where t.actor_kind = 'engine' and t.undone_at is null and t.occurred_at >= ${startedAt}::timestamptz
         and e.rationale like 'done_check:%' and t.to_status in ('done', 'likely_done', 'in_progress')`);
    const q6 = await db.execute<{ work_item_id: string; undo_change_set_id: string | null }>(statementSql('Q6', [userId, startedAt]));
    const scored = scoreSignals(
      j,
      res.signals.map((s) => {
        const ref = j.refOfId.get(s.sourceItemId) ?? '';
        return { wid: s.workItemId, ref, role: s.role, confidence: s.confidence === 'sure' ? 0.95 : 0.75, at: j.times.get(ref) ?? 0 };
      }),
    );
    const judgedOf = new Map(scored.judged.map((x) => [`${x.wid}|${x.ref}`, x.v]));
    const closed = tr.rows.filter((r) => r.to === 'done').map((r) => {
      const s = res.signals.find((x) => x.workItemId === r.wid && x.role === 'completion' && x.confidence === 'sure');
      const ref = s ? (j.refOfId.get(s.sourceItemId) ?? '') : '';
      return { wid: r.wid, v: judgedOf.get(`${r.wid}|${ref}`) ?? 'unknown', inClosedForYou: q6.rows.some((q) => q.work_item_id === r.wid && !!q.undo_change_set_id) };
    });
    const report = {
      label,
      block,
      skill: res.skill,
      status: res.status,
      items: res.items,
      withCandidates: res.withCandidates,
      calls: res.calls,
      costUsd: Number(spend.toFixed(4)),
      verdicts: res.verdicts,
      signals: res.signals.length,
      completion: scored.summary,
      transitions: tr.rows.reduce<Record<string, number>>((a, r) => ((a[r.to] = (a[r.to] ?? 0) + 1), a), {}),
      autoClosed: { n: closed.length, right: closed.filter((c) => c.v === 'right').length, wrong: closed.filter((c) => c.v === 'wrong' || c.v === 'premature').length, unkeyed: closed.filter((c) => c.v === 'unkeyed').length, inClosedForYouWithUndo: closed.filter((c) => c.inClosedForYou).length },
    };
    writePriv(path.join(privDir('reports'), `completion-${label}.json`), JSON.stringify({ ...report, details: scored.judged.map((x, i) => ({ ...x, gate: res.signals[i]!.gate, p: res.signals[i]!.modelConfidence, basis: res.signals[i]!.basis, reason: res.signals[i]!.reason })), closed }, null, 1));
    console.log(JSON.stringify(report, null, 1));
  } finally {
    await j.h.close();
  }
}

main().catch((e) => {
  console.error((e as Error).stack ?? (e as Error).message);
  process.exit(1);
});
