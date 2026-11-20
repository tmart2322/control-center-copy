/**
 * CMP-1: replay the completion pass over a finished scenario DB without re-running the scanners (cheap: only the
 * completion calls). The pass runs as a dry run at the same moments the scenario's `completion.check` jobs ran,
 * each seeing only what existed then (items and evidence created, sources arrived, by that `through`), with the
 * scenario's own `done_check:` rows hidden and its own watermark chain. Sure completions close the item for the
 * rest of the replay (as the closure machine would). Used to measure run-to-run variance and to try a skill change
 * (`--skill <path>`) before committing it. Ledgered as `completion`; stdout carries counts only.
 *   npx tsx scripts/stress/completion-replay.ts <block> <scenarioDb> [label] [--skill <path>]
 */
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { agentSdkCompletionModel, runCompletionPass, type CompletionModel, type CompletionSignal, type CompletionStore, type CompletionWatermark } from '../../src/scanner/completion';
import { DbScannerStore } from '../../src/scanner/store-db';

import { loadJudge, scoreSignals } from './completion-score';
import { assertBudget, recordSpend } from './lib/ledger';
import { privDir, writePriv } from './lib/paths';

const REPLAY_STATUSES = ['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'done', 'snoozed'] as const;

async function main() {
  const args = process.argv.slice(2);
  const flag = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const skillPath = flag('--skill');
  // --no-model: no LLM at all; every item is answered not_done, and the transcript shows what each call would have
  // been given (candidates and relations). For reading the deterministic half by hand.
  const noModel = args.includes('--no-model');
  if (noModel) args.splice(args.indexOf('--no-model'), 1);
  const [block, dbName, label = `${dbName}-replay`] = args;
  const j = await loadJudge(block!, dbName!);
  const db = j.h.db;
  try {
    const u = await db.execute<{ id: string; name: string | null }>(sql`select id, display_name as name from users order by created_at limit 1`);
    const userId = u.rows[0]!.id;
    const checkpoints = (
      await db.execute<{ t: string }>(sql`
        select distinct (result->'watermark'->>'through')::timestamptz::text as t from jobs
         where kind = 'completion.check' and status = 'succeeded' and result ? 'watermark' order by 1`)
    ).rows.map((r) => Date.parse(r.t) + 60_000);
    let now = checkpoints[0] ?? Date.now();
    const store = new DbScannerStore({ db, userId, clock: () => new Date(now) });
    const closed = new Set<string>();
    const wrapped = Object.assign(Object.create(store) as DbScannerStore, {
      completionItems: async (o: { asOf?: string; limit?: number } = {}) =>
        (await store.completionItems({ ...o, statuses: REPLAY_STATUSES }))
          .filter((it) => !closed.has(it.workItemId))
          .map((it) => ({ ...it, status: it.status === 'done' ? 'open' : it.status, evidence: it.evidence.filter((e) => !(e.reason ?? '').startsWith('done_check:')) })),
      budgetStatus: async () => ({ todayUsd: 0, softCapUsd: 5, hardCapUsd: 15, state: 'ok' as const }),
    }) as CompletionStore;
    const real: CompletionModel = noModel ? async () => ({ ok: true, text: '{"verdicts":[]}', costUsd: 0, inputTokens: 0, outputTokens: 0 }) : agentSdkCompletionModel({ timeoutMs: 120_000 });
    let spend = 0;
    let calls = 0;
    // Every prompt and reply, for reading the model's judgement by hand (private file only: it holds message text).
    const transcript: Array<{ at: string; user: string; reply: string; ok: boolean }> = [];
    const model: CompletionModel = async (req) => {
      if (!noModel) assertBudget(0.02);
      const r = await real(req);
      transcript.push({ at: new Date(now).toISOString(), user: req.user, reply: r.text, ok: r.ok });
      spend += r.costUsd;
      calls += 1;
      recordSpend({ scenario: `completion-replay:${label}`, kind: 'completion', model: req.model, costUsd: r.costUsd, note: 'dry-run replay' });
      return r;
    };
    let wm: CompletionWatermark | null = null;
    const signals: Array<CompletionSignal & { checkpoint: string }> = [];
    let withCandidates = 0;
    for (const t of checkpoints) {
      now = t;
      const res = await runCompletionPass({ store: wrapped, model, now: new Date(t), watermark: wm, meName: u.rows[0]!.name ?? undefined, dryRun: true, ...(skillPath ? { skillPath: path.resolve(skillPath) } : {}) });
      wm = res.watermark;
      withCandidates += res.withCandidates;
      for (const s of res.signals) {
        signals.push({ ...s, checkpoint: new Date(t).toISOString() });
        if (s.role === 'completion' && s.confidence === 'sure') closed.add(s.workItemId);
      }
    }
    const scored = scoreSignals(
      j,
      signals.map((s) => {
        const ref = j.refOfId.get(s.sourceItemId) ?? '';
        return { wid: s.workItemId, ref, role: s.role, confidence: s.confidence === 'sure' ? 0.95 : 0.75, at: j.times.get(ref) ?? 0 };
      }),
    );
    const report = { label, block, skill: skillPath ?? 'skills/check-completion.md', checkpoints: checkpoints.length, itemChecksWithCandidates: withCandidates, calls, costUsd: Number(spend.toFixed(4)), keyItemsFinishedInBlock: j.doneKeys.length, keyItemsFinishedCaptured: j.captured.length, completion: scored.summary, signals: signals.length };
    writePriv(path.join(privDir('reports'), `completion-${label}.json`), JSON.stringify({ ...report, details: scored.judged.map((x, i) => ({ ...x, gate: signals[i]!.gate, p: signals[i]!.modelConfidence, basis: signals[i]!.basis, relations: signals[i]!.relations, reason: signals[i]!.reason, checkpoint: signals[i]!.checkpoint })) }, null, 1));
    writePriv(path.join(privDir('reports'), `completion-${label}.transcript.json`), JSON.stringify(transcript, null, 1));
    console.log(JSON.stringify(report, null, 1));
  } finally {
    await j.h.close();
  }
}

main().catch((e) => {
  console.error((e as Error).stack ?? (e as Error).message);
  process.exit(1);
});
