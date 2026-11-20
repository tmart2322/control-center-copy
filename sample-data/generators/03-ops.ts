/**
 * Domain 03 (ops/telemetry): jobs, schedules, workers, scan runs and their trace, health, auth, app events, notifications,
 * LLM calls/budgets/decisions, change sets, audit events, content revisions. Run: npx tsx sample-data/generators/03-ops.ts
 * Everything is machine-generated and deterministic (rng('ops-*')). See sample-data/CAST-ops.md for the key rows.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OWNER, SAMPLE_DIR, at, flushRefs, readTable, ref, reservedFor, rng, sha, uid, writeTable, type Row } from '../lib/kit';
import { CONN, DAY, HOUR, MIN, NOW_MS, atMs, callCost, iso, mtDay, r2, r6, skillVersion, tms, type ConnKey, HAIKU, SONNET } from './data/ops-lib';
import { planRuns } from './data/ops-runs';
import { enrichRuns } from './data/ops-facts';
import { buildJobs, CUR_WORKER, SCHEDULES, WORKERS, type JobT } from './data/ops-jobs';
import { buildCalls, calibrate, scaleTo, chatNotes, D0_MS, type CallT } from './data/ops-calls';
import { buildTrace, type RunOut } from './data/ops-trace';
import { buildHealth } from './data/ops-health';
import { buildAudit, diffKeys, type CS } from './data/ops-audit';

const R = rng('ops-main');
const MINE = ['jobs', 'job_schedules', 'worker_instances', 'scan_runs', 'scan_run_events', 'scan_ledger_entries', 'scan_cursors', 'connector_health_checks', 'connector_auth_events', 'reauth_attempts', 'app_events', 'notifications', 'llm_budgets', 'llm_budget_days', 'llm_calls', 'llm_call_days', 'llm_decisions', 'llm_decision_days', 'audit_events', 'change_sets', 'content_revisions'];
for (const t of MINE) if (reservedFor(t).length) throw new Error(`unhandled reservation for ${t}: ${JSON.stringify(reservedFor(t))}`);

// ── 1. runs → jobs ─────────────────────────────────────────────────────────────────────────────────
const runs = enrichRuns(planRuns());
const { jobs } = buildJobs(runs);
const jobIdMap = new Map(jobs.map((j) => [j.key, j.id!]));
const jobId = (k: string) => jobIdMap.get(k)!;
const runJob = new Map(jobs.filter((j) => j.runKey).map((j) => [j.runKey!, j]));
const runUuid = (n: number) => uid('scan_runs', n);

// ── 2. LLM calls ───────────────────────────────────────────────────────────────────────────────────
const calls = buildCalls(runs, jobs, jobId);
// a run that stopped at its per-run cost cap spent about the cap (and a little over)
for (const r of runs.filter((x) => x.err?.cause === 'cost_cap')) {
  const set = calls.filter((c) => c.runKey === r.key); set.forEach((c) => { c.fixed = true; });
  scaleTo(set, r.costCap * R.pick([1.012, 1.021, 1.034]), 40);
}
// nothing but blocked calls between the hard-cap block (12:41:20) and the raise (13:12) on 2026-11-10
const blockMs = atMs(-8, '12:41:20'); const raiseMs = tms('2026-11-10T20:12:00.000Z');
for (const c of calls) if (c.budget === 'daily' && c.status !== 'budget_blocked' && c.startMs >= blockMs && c.startMs < raiseMs) c.startMs = raiseMs + R.int(20, 400) * 1000;
calibrate(calls, atMs(-9, '00:00'), atMs(-8, '00:00'), 13.4);
calibrate(calls, atMs(-8, '00:00'), blockMs, 25.02);
calibrate(calls, raiseMs, atMs(-7, '00:00'), 3.7);
// bring ordinary days into a believable range ($2 - $9)
const dayCost = new Map<string, number>();
const sumDay = () => { dayCost.clear(); for (const c of calls) if (c.budget === 'daily' && c.status !== 'budget_blocked') { const d = mtDay(c.startMs); dayCost.set(d, (dayCost.get(d) ?? 0) + callCost(c.model, c.tok)); } };
for (let pass = 0; pass < 2; pass++) {
  sumDay();
  for (const [d, v] of dayCost) {
    if (d === '2026-11-09' || d === '2026-11-10' || d === '2026-11-18') continue;
    const off = Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse('2026-11-18T12:00:00Z')) / DAY);
    const wk = new Date(Date.parse(d + 'T12:00:00Z')).getUTCDay(); const weekend = wk === 0 || wk === 6;
    const want = weekend ? R.int(60, 160) / 100 : R.int(310, 880) / 100;
    if (v < want * 0.55 || v > want * 1.4) calibrate(calls, atMs(off, '00:00'), atMs(off + 1, '00:00'), want);
  }
}
calls.sort((a, b) => a.startMs - b.startMs || a.key.localeCompare(b.key));
for (const c of calls) c.cost = c.status === 'budget_blocked' ? 0 : callCost(c.model, c.tok);
// identical repeats (same skill, same day) share a request hash and mostly hit the prompt cache
const reqHashByKey = new Map<string, string>();
calls.forEach((c, i) => {
  let h = sha(`${c.model}|${c.skill}|${c.skillVer}|${c.seed}|${c.key}`);
  const dupOf = i > 0 && c.skill && !c.rolled && !c.fixed && c.status === 'ok' && i % 37 === 0 ? [...calls.slice(0, i)].reverse().find((x) => x.skill === c.skill && !x.rolled && mtDay(x.startMs) === mtDay(c.startMs) && x.status === 'ok') : undefined;
  if (dupOf) { h = reqHashByKey.get(dupOf.key)!; c.tok = { ...c.tok, cr: c.tok.cr + c.tok.in, in: Math.round(c.tok.in * 0.05), cw: 0 }; c.cost = callCost(c.model, c.tok); c.outcome = dupOf.outcome; }
  reqHashByKey.set(c.key, h);
});
const rolled = calls.filter((c) => c.rolled);
const rows = calls.filter((c) => !c.rolled);
if (rows.length !== 700) throw new Error(`llm_calls rows ${rows.length}`);
rows.forEach((c, i) => { c.id = i + 1; });
const callByKey = new Map(calls.map((c) => [c.key, c]));
void callByKey;
rows[R.int(300, 650)]!.estimated = true;

// per-run totals (rolled calls count: they are the run's spend)
const runOf = new Map<string, RunOut>();
for (const r of runs) runOf.set(r.key, { id: runUuid(r.n), cost: 0, inTok: 0, outTok: 0, jobId: runJob.get(r.key)?.id ?? null, calls: 0 });
for (const c of calls) if (c.runKey) { const o = runOf.get(c.runKey)!; o.cost = r6(o.cost + c.cost); o.inTok += c.tok.in + c.tok.cr + c.tok.cw; o.outTok += c.tok.out; o.calls++; }
for (const r of runs) { const o = runOf.get(r.key)!; if (r.conn === 'vdp') { o.cost = 0; } }

// ── 3. budgets facts (single 'total' budget; daily-budget calls only) ───────────────────────────────
const daily = rows.filter((c) => c.budget === 'daily');
const dayAgg = new Map<string, { spent: number; n: number; first?: number }>();
for (const c of daily) { const d = mtDay(c.startMs); const a = dayAgg.get(d) ?? { spent: 0, n: 0 }; if (c.status !== 'budget_blocked') { a.spent += c.cost; a.n++; } dayAgg.set(d, a); }
for (const c of rolled.filter((x) => x.budget === 'daily')) { const d = mtDay(c.startMs); const a = dayAgg.get(d) ?? { spent: 0, n: 0 }; a.spent += c.cost; a.n++; dayAgg.set(d, a); }
let cum = 0; let alertMs = 0; let alertUsd = 0;
for (const c of daily.filter((x) => mtDay(x.startMs) === '2026-11-10' && x.startMs < blockMs)) { cum += c.cost; if (!alertMs && cum >= 20) { alertMs = c.startMs + c.latencyMs; alertUsd = cum; } }
const spentAtBlock = r2(daily.filter((x) => mtDay(x.startMs) === '2026-11-10' && x.startMs < blockMs).reduce((s, c) => s + c.cost, 0));

// ── 4. change sets and audit (needs flips from health, so build health first) ───────────────────────
const allCs = (() => {
  // health first (flips), audit second; budget-raise change set uuid is predictable
  return null;
})();
void allCs;
const raiseCsId = uid('change_sets', 'budget-raise-placeholder');
void raiseCsId;
const dummyBudget = { alerts: [{ day: '2026-11-10', atMs: alertMs, usd: alertUsd, limit: 25 }], blockMs: blockMs + 20_000, raiseMs, blockUsd: spentAtBlock, raiseCs: '' };
const coreConn = readTable('connectors') as Array<Record<string, any>>;
// pass 1 of health to get flips (the raise change set id is patched in below)
let health = buildHealth({ runs, runOf, jobs, jobId, budget: dummyBudget, coreConn });
const chatAt = calls.filter((c) => c.purpose === 'chat').map((c) => iso(c.startMs + c.latencyMs));
const audit = buildAudit({ runs, runOf, jobs, jobId, flips: health.flips, workers: WORKERS, chatAt });
// number the change sets
const csNum = new Map<string, number>();
for (const s of audit.sets) if (s.n) csNum.set(s.key, s.n);
audit.rest.forEach((s, i) => csNum.set(s.key, audit.free[i]!));
const csId = (key: string) => uid('change_sets', csNum.get(key)!);
const raiseId = csId('budget-raise');
health = buildHealth({ runs, runOf, jobs, jobId, budget: { ...dummyBudget, raiseCs: raiseId }, coreConn });

// ── 5. tables ──────────────────────────────────────────────────────────────────────────────────────
// scan_runs
const failMsg = (r: (typeof runs)[number]) => r.err?.msg ?? null;
const scanRuns: Row[] = runs.map((r) => {
  const o = runOf.get(r.key)!; const def = CONN[r.conn];
  const ok = r.status === 'succeeded' || r.status === 'partial';
  return {
    id: o.id, owner_user_id: OWNER, connector_id: def.id, scope: r.scope ? `${def.scanKind}:${r.scope}` : null, trigger: r.trigger, mode: r.mode, status: r.status,
    window_start: iso(r.winFrom), window_end: iso(r.winTo), job_id: o.jobId, skill_key: def.skill, skill_version: skillVersion(def.skill, def.ver), model_tier: def.tier,
    cursor_before: r.cursorBeforeAt ? { at: iso(r.cursorBeforeAt) } : null, cursor_after: ok && r.cursorAfterAt ? { at: iso(r.cursorAfterAt), turns: r.f.turns, unlinked: r.f.unlinked, value: r.cursorValue } : null,
    items_seen: r.f.seen, items_new: r.f.nw, items_updated: r.f.upd, items_unchanged: r.f.unch, items_skipped: r.f.skipped, links_created: r.f.links, candidates_created: r.f.cands, error_count: r.f.errors,
    cost_usd: r6(o.cost), input_tokens: o.inTok, output_tokens: o.outTok, started_at: iso(r.startMs), finished_at: iso(r.endMs),
    error_code: r.err ? (r.err.cls === 'config' ? 'config' : r.err.cls) : null, error_message: failMsg(r), created_at: iso(r.startMs - 1500),
  };
});
// the jobs' results learn their run and cost
for (const r of runs) { const j = runJob.get(r.key); if (j?.result) { j.result.runId = runUuid(r.n); if (j.kind !== 'connector.reauth') j.result.costUsd = r6(runOf.get(r.key)!.cost); } }
// job costs for non-scan jobs that call the model
const jobCost = new Map<string, number>();
for (const c of calls) if (c.jobKey && !c.runKey) jobCost.set(c.jobKey, r6((jobCost.get(c.jobKey) ?? 0) + c.cost));
for (const j of jobs) if (j.result && 'costUsd' in j.result && !j.runKey) j.result.costUsd = jobCost.get(j.key) ?? 0;
for (const j of jobs.filter((x) => x.kind === 'completion.check' && x.result)) j.result!.calls = calls.filter((c) => c.jobKey === j.key).length;
for (const j of jobs.filter((x) => x.kind === 'nba.generate' && x.result)) j.result!.calls = calls.filter((c) => c.jobKey === j.key).length;

// jobs
const schedId = (k: string) => uid('job_schedules', k);
const jobRows: Row[] = jobs.map((j) => {
  const running = j.status === 'running';
  const lastBeat = tms('2026-11-18T15:59:40.000Z');
  return {
    id: j.id, owner_user_id: OWNER, queue: j.queue, kind: j.kind, payload: j.payload, status: j.status, priority: j.priority, run_at: iso(j.runAtMs), attempts: j.attempts, max_attempts: j.maxAttempts,
    backoff_base_seconds: j.backoffBase, backoff_max_seconds: j.backoffMax, timeout_seconds: j.timeoutS, last_error_class: j.lastErrClass ?? null, last_failed_at: j.lastFailedMs ? iso(j.lastFailedMs) : null,
    dead_at: j.deadMs ? iso(j.deadMs) : null, dead_reason: j.deadReason ?? null, locked_by: running ? CUR_WORKER : null, locked_at: running ? iso(j.startedMs!) : null, lease_expires_at: running ? iso(lastBeat + 5 * MIN) : null, heartbeat_at: running ? iso(lastBeat) : null,
    started_at: j.startedMs ? iso(j.startedMs) : null, finished_at: running || j.status === 'queued' ? null : j.finishedMs ? iso(j.finishedMs) : null, dedupe_key: j.dedupeKey ?? null, generation: j.generation ?? null, supersedes_running: j.supersedes,
    cancel_requested_at: j.cancelReqMs ? iso(j.cancelReqMs) : null, cancel_reason: j.cancelReason ?? null, superseded_by_id: j.supersededByKey ? jobId(j.supersededByKey) : null, idempotency_key: j.idemKey ?? null,
    schedule_id: j.scheduleKey ? schedId(j.scheduleKey) : null, parent_job_id: j.parentKey ? jobId(j.parentKey) : null, correlation_id: j.corr ?? null, last_error_code: j.lastErrCode ?? null, last_error: j.lastErr ?? null,
    result: j.result ?? null, created_at: iso(j.createdMs), updated_at: iso(j.finishedMs ?? j.startedMs ?? j.createdMs),
  };
});
// a superseded job needs a started/finished that is consistent
// job_schedules
const nextSlot = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number) as [number, number]; for (const off of [0, 1]) { const t = atMs(off, hhmm); if (t > NOW_MS) return t; } return atMs(2, hhmm); };
const schedRows: Row[] = SCHEDULES.map((s) => {
  const mine = jobs.filter((j) => j.scheduleKey === s.key).sort((a, b) => a.createdMs - b.createdMs);
  const last = mine[mine.length - 1];
  const [h, m] = s.at.split(':').map(Number);
  return {
    id: schedId(s.key), owner_user_id: OWNER, key: s.key, kind: s.key, queue: s.queue, payload: s.payload ?? {}, interval_seconds: null, cron_expr: `${m} ${h} * * *`, timezone: 'America/Denver', jitter_seconds: 0, catch_up: 'run_once', priority: 0,
    enabled: s.enabled, connector_id: null, paused_reason: s.paused ?? null, next_run_at: iso(nextSlot(s.at)), last_enqueued_at: last ? iso(last.createdMs) : null, last_job_id: last?.id ?? null, created_at: iso(atMs(s.from, '07:20')), updated_at: iso(last?.createdMs ?? atMs(s.from, '07:20')),
  };
});
const workerRows: Row[] = WORKERS.map((w) => ({ id: w.id, role: 'worker', hostname: 'rafael-mbp.example', pid: w.pid, app_version: w.version, started_at: iso(w.startMs), last_beat_at: iso(w.lastBeatMs), stopped_at: w.stopMs ? iso(w.stopMs) : null, stop_reason: w.stopReason ?? null }));

// trace
const trace = buildTrace(runs, runOf);
const cursors = trace.cursors;
{ // two cursors the runs do not create: a retired archived-channel scope and the newly joined channel still backfilling
  const sc = `slack:channel:${'C0SMPL015'}`;
  cursors.push({ id: uid('scan_cursors', 'slack|archived-015'), owner_user_id: OWNER, connector_id: CONN.slack.id, scope: sc, cursor_kind: 'composite', cursor_value: '1761590400.000300', cursor_json: { at: '2026-10-27T18:00:00.000Z', value: '1761590400.000300', turns: 7, unlinked: 0 }, high_watermark_at: '2026-10-27T18:00:00.000Z', low_watermark_at: '2026-09-19T14:00:00.000Z', status: 'retired', last_run_id: null, last_advanced_at: '2026-10-27T18:00:30.000Z', created_at: '2026-10-19T14:50:00.000Z', updated_at: iso(atMs(-20, '10:00')) });
  const c13 = cursors.find((c) => c.scope === 'slack:channel:C0SMPL013');
  if (c13) c13.status = 'backfilling';
  else cursors.push({ id: uid('scan_cursors', 'slack|new-013'), owner_user_id: OWNER, connector_id: CONN.slack.id, scope: 'slack:channel:C0SMPL013', cursor_kind: 'composite', cursor_value: '1763440800.000500', cursor_json: { at: '2026-11-18T05:20:00.000Z', value: '1763440800.000500', turns: 6, unlinked: 1 }, high_watermark_at: '2026-11-18T05:20:00.000Z', low_watermark_at: '2026-11-11T17:00:00.000Z', status: 'backfilling', last_run_id: null, last_advanced_at: '2026-11-18T05:20:30.000Z', created_at: iso(atMs(-2, '09:10')), updated_at: '2026-11-18T05:20:30.000Z' });
}

// llm_calls
const callRows: Row[] = rows.map((c) => {
  const post = c.startMs >= D0_MS;
  const reqHash = reqHashByKey.get(c.key)!;
  return {
    id: c.id, owner_user_id: OWNER, purpose: c.purpose, model: c.model, model_tier: c.model === SONNET ? 'sonnet' : 'haiku', skill_key: c.skill, prompt_version: c.skillVer, request_hash: reqHash,
    job_id: c.jobKey ? jobId(c.jobKey) : null, scan_run_id: c.runKey ? runOf.get(c.runKey)!.id : null, chat_message_id: c.chatMsgKey ? ref('chat_messages', c.chatMsgKey, `assistant message produced by llm_calls id ${c.id}; ${chatNotes.find((n) => n.key === c.chatMsgKey)?.note ?? ''}; created_at ${iso(c.startMs + c.latencyMs)}; chat_messages.llm_call_id = ${c.id}`) : null,
    status: c.status, input_tokens: c.tok.in, output_tokens: c.tok.out, cache_read_tokens: c.tok.cr, cache_write_tokens: c.tok.cw, cost_usd: c.status === 'budget_blocked' ? 0 : c.cost, cost_estimated: !!c.estimated, latency_ms: c.latencyMs, error_code: c.errCode ?? null,
    budget_day: mtDay(c.startMs), started_at: iso(c.startMs), finished_at: iso(c.startMs + c.latencyMs), budget: c.budget, trigger: post ? c.trigger || null : null, model_reason: post ? c.modelReason || null : null,
    content_hash: post && c.status !== 'budget_blocked' ? sha(`${reqHash}|content`).slice(0, 32) : null, outcome: post ? c.outcome || null : null,
  };
});
for (const r of callRows) if (r.cost_usd !== undefined) r.cost_usd = r6(r.cost_usd as number);

// llm_call_days: the first-scan days (2026-10-19 / 10-20) rolled up
const cd = new Map<string, Row>();
for (const c of rolled) {
  const day = mtDay(c.startMs); const tier = c.model === SONNET ? 'sonnet' : 'haiku';
  const key = [day, c.purpose, c.model, tier, c.skill ?? '', c.budget, '', '', c.status].join('|');
  const cur = cd.get(key) ?? { id: 0, owner_user_id: OWNER, day, purpose: c.purpose, model: c.model, model_tier: tier, skill_key: c.skill ?? '', budget: c.budget, trigger: '', model_reason: '', status: c.status, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, estimated_calls: 0, latency_ms_total: 0, first_at: iso(c.startMs), last_at: iso(c.startMs), rolled_up_at: '' };
  cur.calls = (cur.calls as number) + 1; cur.input_tokens = (cur.input_tokens as number) + c.tok.in; cur.output_tokens = (cur.output_tokens as number) + c.tok.out; cur.cache_read_tokens = (cur.cache_read_tokens as number) + c.tok.cr; cur.cache_write_tokens = (cur.cache_write_tokens as number) + c.tok.cw;
  cur.cost_usd = r6((cur.cost_usd as number) + c.cost); cur.latency_ms_total = (cur.latency_ms_total as number) + c.latencyMs; cur.last_at = iso(c.startMs); cd.set(key, cur);
}
const retentionJob = jobs.filter((j) => j.kind === 'retention.scrub' && j.createdMs > atMs(-5, '00:00')).sort((a, b) => a.createdMs - b.createdMs)[0]!;
const callDays = [...cd.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.purpose).localeCompare(String(b.purpose)));
callDays.forEach((r, i) => { r.id = i + 1; r.rolled_up_at = iso(retentionJob.finishedMs!); });

// llm_budgets / llm_budget_days
const budgetId = uid('llm_budgets', 'total');
const budgets: Row[] = [{ id: budgetId, owner_user_id: OWNER, scope: 'total', scope_value: null, daily_limit_usd: 32, alert_at_pct: 80, hard_stop: true, effective_from: '2026-10-18', created_at: '2026-10-18T15:10:00.000Z', updated_at: new Date(raiseMs).toISOString() }];
const budgetDays: Row[] = [...dayAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, a]) => {
  const row: Row = { budget_id: budgetId, day, reserved_usd: 0, spent_usd: r6(a.spent), call_count: a.n, alerted_at: null, blocked_at: null, updated_at: iso(atMs(Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse('2026-11-18T12:00:00Z')) / DAY), '19:00')) };
  if (day === '2026-11-10') { row.alerted_at = iso(alertMs); row.blocked_at = iso(blockMs + 20_000); row.updated_at = iso(atMs(-8, '17:55')); }
  if (day === '2026-11-18') { row.reserved_usd = 0.09; row.updated_at = '2026-11-18T15:58:30.000Z'; }
  return row;
});

// ── 6. llm_decisions (from the audit shipped with 1.3.0: 2026-11-12 21:34Z on) ─────────────────────
const decisions: Row[] = [];
const dkey = new Map<string, Row>();
const addDec = (day: string, skill: string, kind: 'skip' | 'escalate' | 'block', reason: string, trigger: string, subject: string, usd: number, tFirst: number, detail: Row, callId: number | null = null) => {
  const k = [day, skill, kind, reason, trigger, subject].join('|');
  const cur = dkey.get(k);
  if (cur) { cur.count = (cur.count as number) + 1; cur.usd = r6((cur.usd as number) + usd); cur.last_at = iso(tFirst); cur.detail = detail; if (callId) cur.llm_call_id = callId; return; }
  const row: Row = { id: 0, owner_user_id: OWNER, day, skill_key: skill, kind, reason, trigger, subject, count: 1, usd: r6(usd), llm_call_id: callId, detail, first_at: iso(tFirst), last_at: iso(tFirst) };
  dkey.set(k, row); decisions.push(row);
};
const wiU = (n: number) => uid('work_items', `wi-${String(n).padStart(3, '0')}`);
const esc = rows.filter((c) => c.modelReason === 'escalation:unclear' && c.startMs >= D0_MS);
esc.forEach((c, i) => {
  const reason = R.weighted([['verdict_same', 5], ['verdict_changed', 3], ['stronger_invalid', 2], ['unlinked_content', 1]] as any) as string;
  const changed = reason === 'verdict_changed';
  addDec(mtDay(c.startMs), c.skill!, 'escalate', reason, c.trigger || 'interval', wiU(R.int(1, 92)), c.cost, c.startMs, { action: changed ? 'close' : 'keep_open', actionChanged: changed, cheapAction: changed ? 'keep_open' : 'keep_open', from: HAIKU, to: SONNET, jobId: c.jobKey ? jobId(c.jobKey) : 0 }, c.id!);
});
// skips: the model was not called
for (let i = 0; i < 34; i++) {
  const t = atMs(-R.int(0, 6), '08:00') + R.int(0, 9 * 60) * MIN; if (t < D0_MS || t > NOW_MS) { i--; continue; }
  const kind = R.weighted([['turns_backfill', 3], ['status_only', 3], ['min_interval', 2], ['precheck_empty', 3]] as any) as string;
  const skill = kind === 'precheck_empty' ? 'scan-slack' : kind === 'turns_backfill' ? 'scan-slack' : 'settle-item';
  const trig = kind === 'precheck_empty' ? R.pick(['schedule', 'file_watch']) : kind === 'turns_backfill' ? 'backfill' : R.pick(['interval', 'file_watch']);
  const subject = kind === 'precheck_empty' || kind === 'turns_backfill' ? `slack:${R.pick(['inbox', 'channel:C0SMPL001', 'channel:C0SMPL003', 'channel:C0SMPL004'])}` : R.chance(0.5) ? wiU(R.int(1, 92)) : `claude-session-${R.int(1, 30)}`;
  addDec(mtDay(t), skill, 'skip', kind, trig, subject, R.int(2, 18) / 1000, t, { calls: R.int(1, 3), precheckUsd: R.int(1, 9) / 1000, status: R.pick(['ok', 'idle', 'waiting']), window: { from: iso(t - 30 * MIN), to: iso(t) } });
}
// blocks: per-purpose day caps (the closing settings give the stronger model $1/day)
for (const [d, reason, skill, n] of [[-5, 'stronger_day_cap', 'settle-item', 2], [-4, 'stronger_day_cap', 'check-completion', 3], [-3, 'escalation_day_cap', 'settle-item', 1], [-2, 'stronger_day_cap', 'settle-item', 2], [-1, 'stronger_day_cap', 'check-completion', 1]] as Array<[number, string, string, number]>) {
  const t = atMs(d, '14:20') + R.int(0, 50) * MIN;
  for (let i = 0; i < n; i++) addDec(mtDay(t), skill, 'block', reason, 'interval', wiU(R.int(1, 92)), R.int(8, 40) / 1000, t + i * 7 * MIN, { allowanceUsd: 1, capUsd: 1, hardUsd: 32, heldUsd: 0, jobId: jobs.find((j) => j.kind === 'settle.check' && j.createdMs > t - 4 * HOUR)?.id ?? 0, leftUsd: 0.02, mode: 'stronger', readinCapUsd: 2, readinUsd: R.int(0, 60) / 100, runId: runUuid(runs[runs.length - 1]!.n), spentTodayUsd: R.int(300, 780) / 100, spentUsd: 0.98, totalUsd: R.int(300, 780) / 100, wantUsd: 0.06 });
}
decisions.sort((a, b) => tms(a.first_at as string) - tms(b.first_at as string));
// the first two days after the audit shipped are rolled up (sample retention), the rest stay as rows
const rollDays = new Set(['2026-11-12', '2026-11-13']);
const rolledDec = decisions.filter((d) => rollDays.has(d.day as string));
const keptDec = decisions.filter((d) => !rollDays.has(d.day as string));
keptDec.forEach((d, i) => { d.id = i + 1; });
const dd = new Map<string, Row>();
for (const d of rolledDec) {
  const k = [d.day, d.skill_key, d.kind, d.reason, d.trigger].join('|');
  const cur = dd.get(k) ?? { id: 0, owner_user_id: OWNER, day: d.day, skill_key: d.skill_key, kind: d.kind, reason: d.reason, trigger: d.trigger, decisions: 0, count: 0, usd: 0, first_at: d.first_at, last_at: d.last_at, rolled_up_at: iso(atMs(-4, '07:00')) };
  cur.decisions = (cur.decisions as number) + 1; cur.count = (cur.count as number) + (d.count as number); cur.usd = r6((cur.usd as number) + (d.usd as number)); if ((d.last_at as string) > (cur.last_at as string)) cur.last_at = d.last_at; dd.set(k, cur);
}
const decDays = [...dd.values()]; decDays.forEach((d, i) => { d.id = i + 1; });
// guard: escalate rows point only at calls that exist
void esc;

// ── 7. app events, notifications, health, auth ─────────────────────────────────────────────────────
// attach the chat refs and flush
// change_sets / audit rows
const csRows: Row[] = []; const auditRows: Row[] = [];
const allSets = [...audit.sets].sort((a, b) => csNum.get(a.key)! - csNum.get(b.key)!);
for (const s of allSets) {
  csRows.push({
    id: csId(s.key), owner_user_id: OWNER, kind: s.kind, actor_kind: s.actor, actor_ref: s.actorRef, editor_session_id: s.editor ?? null, entity_type: s.etype, entity_id: s.eid, summary: s.summary, undoable: s.undoable,
    coalesce_until: s.coalesceUntil ? iso(s.coalesceUntil) : null, closed_at: iso(s.closedMs), undo_of_change_set_id: s.undoOf ? csId(s.undoOf) : null, rollback_to_at: s.rollbackTo ? iso(s.rollbackTo) : null,
    undone_at: s.undoneMs ? iso(s.undoneMs) : null, undone_by_change_set_id: s.undoneBy ? csId(s.undoneBy) : null, created_at: iso(s.createdMs),
  });
}
const seen = new Set<string>();
const auditPre: Array<{ at: number; row: Row }> = [];
for (const s of allSets) {
  for (const sp of s.rows) {
    const k = `${csId(s.key)}|${sp.table}|${sp.rowId}`; if (seen.has(k)) continue; seen.add(k);
    const before = sp.before; const after = sp.after;
    const changed = sp.op === 'insert' ? Object.keys(after!).sort() : sp.op === 'delete' ? Object.keys(before!).sort() : diffKeys(before, after);
    if (sp.op === 'update' && !changed.length) continue;
    const t0 = s.createdMs + R.int(0, Math.max(1, Math.min(2000, s.closedMs - s.createdMs - 1)));
    const co = sp.coalesced ?? 1;
    auditPre.push({ at: t0, row: { id: 0, owner_user_id: OWNER, change_set_id: csId(s.key), actor_kind: s.actor, actor_ref: s.actorRef, table_name: sp.table, row_id: sp.rowId, entity_type: sp.etype, entity_id: sp.eid, op: sp.op, changed_fields: changed, before, after, coalesced_count: co, destination: null, payload_hash: null, created_at: iso(t0), updated_at: iso(Math.min(s.closedMs, t0 + (co > 1 ? R.int(400, 1500) : 0))) } });
  }
}
auditPre.sort((a, b) => a.at - b.at);
auditPre.forEach((x, i) => { x.row.id = i + 1; auditRows.push(x.row); });

// content revisions
const revisionRows: Row[] = audit.rev.map((r) => { const { _cs, ...rest } = r as any; return { ...rest, change_set_id: _cs ? csId(_cs) : null }; });

// health outputs
const checks = health.checks;
const authEvents = health.authEvents; const reauth = health.reauth;
const appEvents = health.appEvents; const notifications = health.notifs;

// ── 8. write ──────────────────────────────────────────────────────────────────────────────────────
writeTable('jobs', jobRows);
writeTable('job_schedules', schedRows);
writeTable('worker_instances', workerRows);
writeTable('scan_runs', scanRuns);
writeTable('scan_run_events', trace.events);
writeTable('scan_ledger_entries', trace.ledger);
writeTable('scan_cursors', cursors);
writeTable('connector_health_checks', checks);
writeTable('connector_auth_events', authEvents);
writeTable('reauth_attempts', reauth);
writeTable('app_events', appEvents);
writeTable('notifications', notifications);
writeTable('llm_budgets', budgets);
writeTable('llm_budget_days', budgetDays);
writeTable('llm_calls', callRows);
writeTable('llm_call_days', callDays);
writeTable('llm_decisions', keptDec);
writeTable('llm_decision_days', decDays);
writeTable('change_sets', csRows);
writeTable('audit_events', auditRows);
writeTable('content_revisions', revisionRows);
flushRefs('ops');

// ── 9. CAST-ops.md (the addendum later domains read) ───────────────────────────────────────────────
const mt = (ms: number) => new Date(ms - 7 * HOUR).toISOString().slice(5, 16).replace('T', ' ');
const rn = (r: (typeof runs)[number]) => `${r.n}`;
const list = (xs: (string | number)[]) => xs.join(', ');
const L: string[] = [];
const P = (...x: string[]) => L.push(...x);
const failed = runs.filter((r) => r.status === 'failed');
P('# CAST-ops: domain 03 key rows (generated by sample-data/generators/03-ops.ts)', '',
  'Times are MT (UTC-7). Ids: `uid(\'scan_runs\', n)` (n = run number below), jobs and llm_calls are plain bigints, `uid(\'change_sets\', n)`. Read the JSON (`readTable`) to filter by time, entity or purpose; the lists below are the entry points.', '');
P('## Scan runs (160; n is time-ordered, n = 1 is 10-19 07:41)', '',
  `- First scan (budget \`first_scan\`, trigger startup_catchup): runs ${runs.filter((r) => r.story === 'first-scan')[0]!.n}-${runs.filter((r) => r.story === 'first-scan').slice(-1)[0]!.n} (10-19 .. 10-21; the first 10-19..10-21 LLM calls are rolled up into llm_call_days, so those runs have cost but few llm_calls).`,
  `- Status mix: ${list(Object.entries(runs.reduce((a: Record<string, number>, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {})).map(([k, v]) => `${k} ${v}`))}. error_code: transient/rate_limited/auth/config(cost cap)/unknown.`,
  `- Failed runs (${failed.length}): ` + failed.map((r) => `${r.n} ${r.conn} ${r.scope ?? ''} [${r.err!.cause}] ${mt(r.endMs)}`).join('; ') + '.',
  `- Cancelled: ${list(runs.filter((r) => r.status === 'cancelled').map((r) => `${r.n} ${r.conn} (${r.err!.msg.replace('cancelled: ', '')})`))}. Partial: ${list(runs.filter((r) => r.status === 'partial').map((r) => `${r.n} ${r.conn} ${r.scope}`))}.`,
  `- Slack deep backfill 11-09: runs ${list(runs.filter((r) => r.story === 'slack-backfill' && mt(r.startMs).startsWith('11-09')).map(rn))}; 11-10: ${list(runs.filter((r) => /^slack-backfill/.test(r.story ?? '') && mt(r.startMs).startsWith('11-10')).map((r) => rn(r) + (r.err ? '(cost cap)' : '')))}.`,
  `- Slack rate-limit episode 11-12 (degraded 08:35, error 09:05, healthy 10:15): runs ${list(runs.filter((r) => r.story === 'slack-429-ep1').map(rn))} (the manual recovery run and a reconcile run close it).`,
  `- Today (11-18): Slack runs ${list(runs.filter((r) => r.story === 'today-slack').map(rn))} (two 429s, degraded since 08:41); VDP auth failure run ${runs.find((r) => r.story === 'today-vdp' && r.status === 'failed')!.n}, manual run after re-auth ${runs.find((r) => r.story === 'today-vdp' && r.status === 'succeeded')!.n}. The last run per connector finishes exactly at core's connectors.last_success_at.`,
  `- Earlier incidents: VDP cookie lapse 11-04 (runs ${list(runs.filter((r) => r.story === 'vdp-auth-1104').map(rn))}); Org62 REQUEST_LIMIT_EXCEEDED 11-05 (runs ${list(runs.filter((r) => r.story === 'org62-429').map(rn))}); Drive auth 11-14 14:10 (runs ${list(runs.filter((r) => r.story === 'drive-auth').map(rn))}).`,
  `- Reconcile runs (mode reconcile, scope null): ${list(runs.filter((r) => r.mode === 'reconcile').map((r) => `${r.n} ${r.conn}/${r.reconcilePass} ${mt(r.startMs)}`))}.`, '');
const jid = (k: string) => jobs.find((j) => j.key === k)!.id;
P('## Jobs (1..500, ordered by created_at)', '',
  `- Dead letters (${jobs.filter((j) => j.status === 'dead').length}): ` + jobs.filter((j) => j.status === 'dead').map((j) => `${j.id} ${j.kind} ${mt(j.deadMs!)} (${j.deadReason})`).join('; ') + `. Open notification: job ${jid('job-dead-5')} (nba.generate). Job ${jid('job-reauth-vdp-dead')} is this morning's VDP re-auth that the user did not finish.`,
  `- Running now: ${jobs.filter((j) => j.status === 'running').map((j) => j.id)} (settle.check, locked by the current worker). Queued: ${list(jobs.filter((j) => j.status === 'queued').map((j) => `${j.id} ${j.kind}`))}.`,
  `- Paused by the hard cap on 11-10 12:42-13:08 (job succeeded, no run): ${list(jobs.filter((j) => j.tag === 'paused').map((j) => j.id!))}.`,
  `- connector.reauth jobs: ${list(jobs.filter((j) => j.kind === 'connector.reauth').map((j) => `${j.id} (${j.status})`))}. Scheduled maintenance rows carry schedule_id (10 job_schedules; activity.sync is disabled, paused_reason not_wired).`,
  `- For domain 05 (\`draft_send_attempts.job_id\`, \`tool_runs.job_id\`, \`claude_sessions.launch_job_id\`): outbox.dispatch jobs ${list(jobs.filter((j) => j.kind === 'outbox.dispatch').map((j) => `${j.id} ${j.payload.channel}/${j.payload.delivery} ${mt(j.createdMs)}${j.result?.outcome === 'failed' ? ' (failed)' : ''}`))}; tool.run jobs ${list(jobs.filter((j) => j.kind === 'tool.run').map((j) => `${j.id} ${mt(j.createdMs)}`))}.`,
  `- For domain 04/06 (\`jobs.job_id\` links): nba.generate ${list(jobs.filter((j) => j.kind === 'nba.generate').map((j) => `${j.id} ${mt(j.createdMs)}`))}; readin ${list(jobs.filter((j) => j.kind === 'readin').map((j) => `${j.id} ${mt(j.createdMs)}`))}; brief.generate jobs are one per weekday morning.`,
  `- Reevaluate/completion jobs reference \`work_items\` keys wi-001..wi-092 and scan run uuids; correlation_id groups the follow-ups of one scan run.`, '');
const sel = (f: (c: (typeof rows)[number]) => boolean, fmt: (c: (typeof rows)[number]) => string) => list(rows.filter(f).map(fmt));
P('## LLM calls (700 individual rows + rolled-up first-scan days)', '',
  `- Budget: one \`total\` budget (daily_limit_usd 32, hard_stop). Hard cap 11-10: spend crossed 80% of $25 at ${mt(alertMs)} (alerted_at), hit $${spentAtBlock.toFixed(2)} at ${mt(blockMs)} (blocked_at); budget_blocked llm_calls ids ${sel((c) => c.status === 'budget_blocked', (c) => String(c.id))}; raised to soft $22 / hard $32 at ${mt(raiseMs)} (change set ${csNum.get('budget-raise')}); day total $${(dayAgg.get('2026-11-10')?.spent ?? 0).toFixed(2)}. 11-09 total $${(dayAgg.get('2026-11-09')?.spent ?? 0).toFixed(2)}.`,
  `- Rolled up (llm_call_days): 10-19, 10-20, 10-21 (first-scan budget, sample retention). llm_decisions exist from 11-12 21:34Z (the audit shipped with 1.3.0, worker 7); before that trigger / model_reason / content_hash / outcome are NULL on llm_calls. llm_decision_days rolls up 11-12 and 11-13.`,
  `- Draft generation (for \`drafts.llm_call_id\`, sonnet): ${sel((c) => c.purpose === 'draft_generate' && c.status === 'ok', (c) => `${c.id}@${mt(c.startMs)} ${c.skill}`)}.`,
  `- Chat (14, sonnet; each has a reserved \`chat_messages\` key): ${chatNotes.map((n) => `${n.key} = call ${rows.find((c) => c.chatMsgKey === n.key)!.id} @${mt(tms(n.at))} (${n.note})`).join('; ')}.`,
  `- nba_generate: ${sel((c) => c.purpose === 'nba_generate', (c) => `${c.id}@${mt(c.startMs)} ${c.skill}`)}.`,
  `- summarize (briefs/meeting summaries): ${sel((c) => c.purpose === 'summarize', (c) => `${c.id}@${mt(c.startMs)} ${c.skill}`)}.`,
  `- resolve_entity / merge_check / priority_explain / enrich: ${sel((c) => ['resolve_entity', 'merge_check', 'priority_explain', 'enrich'].includes(c.purpose), (c) => `${c.id}@${mt(c.startMs)} ${c.purpose}`)}.`,
  `- scan_extract / classify / commitment_extract are tied to scan runs through scan_run_id (and job_id); done_match to completion.check jobs; \`other\` = settle-item, readin, read-lookup. Escalations (sonnet, model_reason escalation:unclear): ${sel((c) => c.modelReason === 'escalation:unclear', (c) => String(c.id))}.`,
  `- Sonnet share is about 14% (the real data is 7%) because domain 04/05/06 need drafts, NBAs and chat answers to point at.`, '');
const csByKey = (k: string) => csNum.get(k);
P('## Change sets (500; every n exists)', '',
  `- Numbering: the 18 numbers core references are pinned (2, 3, 22, 23, 40, 49, 64, 74, 83, 90, 96, 121, 131, 142, 167, 175, 188, 203; times and entities come from the core rows they stamp). All other numbers are assigned in time order, so n is NOT monotonic in time only for those 18.`,
  `- Mix: connector_sync ${csRows.filter((c) => c.kind === 'connector_sync').length}, engine_pass ${csRows.filter((c) => c.kind === 'engine_pass').length}, user_edit ${csRows.filter((c) => c.kind === 'user_edit').length}, autosave_burst ${csRows.filter((c) => c.kind === 'autosave_burst').length}, chat_tool_call ${csRows.filter((c) => c.kind === 'chat_tool_call').length}, system ${csRows.filter((c) => c.kind === 'system').length}, undo ${csRows.filter((c) => c.kind === 'undo').length}, rollback 1. (Real data is 85% connector; user share is raised on purpose.)`,
  `- User edits of settings (one per settings.* key, n = ${list(allSets.filter((s) => s.key.startsWith('set-') || s.key === 'budget-raise').map((s) => `${csNum.get(s.key)} ${s.eid}`))}).`,
  `- Other user/chat/system sets: ` + allSets.filter((s) => ['chat_tool_call', 'user_edit', 'undo', 'rollback', 'autosave_burst'].includes(s.kind) && !s.key.startsWith('set-') && !s.key.startsWith('pin-') && s.key !== 'budget-raise').sort((a, b) => a.createdMs - b.createdMs).map((s) => `${csNum.get(s.key)} ${s.kind} ${mt(s.createdMs)} ${s.etype ?? ''} "${s.summary.slice(0, 60)}"`).join('; ') + '.',
  `- Work-item edits and chat sets point at \`work_items\` wi-001..wi-092 (user sets ued-*, chat sets chat-*): domain 04 should make those items exist and carry a matching change_set_id on transitions where it keeps one.`,
  `- Priority runs: one engine set per weekday morning (actor_ref engine.priority@v3, entity_type work_items); completion/settle/nba passes follow their jobs; connector_sync sets follow scan runs (1 to 4 commits per successful run) and connector status changes.`, '');
P('## Reservations I made for later domains (reservations/ops.json)', '',
  '- `chat_messages` keys `llm-chat-01`..`llm-chat-14`: the assistant message produced by llm_calls (see the chat list above; `chat_messages.llm_call_id` must be that call id and created_at its finish time).',
  `- \`drafts\` keys \`rev-elderglen-demo-reply\` (the unapproved Slack reply, storyline 2) and \`rev-saltmere-blueprint-email\` (storyline 1): their \`doc_json\` must equal the last \`content_revisions\` row of field doc_json for that entity_id (revisions 1..${audit.rev.filter((r) => r.entity_id === uid('drafts', 'rev-elderglen-demo-reply')).length} and 1..${audit.rev.filter((r) => r.entity_id === uid('drafts', 'rev-saltmere-blueprint-email')).length}); first revision is the engine draft, later ones user edits (autosave bursts).`,
  '- content_revisions also hold the description of work items wi-007 and wi-021 (text field `description`; their last revision is the current description).', '');
P('## Health, auth and workers', '',
  `- Slack: degraded 11-10 09:20 (three cost-cap failures, healthy 10:50), degraded 11-12 08:35 -> error 09:05 -> healthy 10:15 (job ${jid('job-dead-4')} dead on rate limit), degraded again 11-18 08:41 (two 429s, consecutive_failures 2, queued retry job ${jid('job-q-slack')}).`,
  `- Auth: VDP expired 11-04 11:11 (re-auth attempt succeeded 11:34), Drive 11-14 14:10 (manual reconnect 14:54), VDP today 08:12: first refresh attempt failed (MFA not completed, job ${jid('job-reauth-vdp-dead')} dead), retry succeeded 08:29:50 (cookie refreshed 08:30, expires 09:48). Gmail (work): expiring_soon 11-15, refreshed automatically 11-16. reauth_attempts 4 rows, connector_auth_events 19.`,
  '- Connectors that also failed transiently in the fill (org62, gmail x2, calendar, gemini, claude) have last_error_at/last_error_code that core\'s connectors rows do not carry (core has null); see the final report.',
  `- Workers: ${WORKERS.length} instances (versions 1.0.2 .. 1.3.0). Instance 4 (${WORKERS[3]!.id}) was killed without a clean stop (stopped_at NULL, last beat ${mt(WORKERS[3]!.lastBeatMs)}); the current one is ${CUR_WORKER}.`,
  '- Schedules: 10 rows, daily cron in America/Denver; next_run_at is the next local slot after now. Catch-up (`run_once`): jobs missed while the laptop slept run once at wake (payload.slot keeps the original slot).', '');
P('## Deviations to know', '',
  '- audit_events images for tables owned by other domains (work_items, next_best_actions, activity_entries, brief_highlights, missed_opp_findings, use_cases) are partial row images (id, owner_user_id and the changed columns) because their JSON did not exist yet; images for core tables, connectors, opportunities, calendar_events, assets are full rows from the JSON.',
  '- audit_events mix is work_items-heavy (priority re-rank rows); real data is dominated by user_settings and connectors.',
  '- app_events/notifications counts are scaled down (about 130 and 14).');
writeFileSync(path.join(SAMPLE_DIR, 'CAST-ops.md'), L.join('\n') + '\n');
console.log('wrote CAST-ops.md');
void at; void SCHEDULES; void (null as unknown as JobT); void (null as unknown as CS); void (null as unknown as ConnKey);
void DAY; void HOUR;
