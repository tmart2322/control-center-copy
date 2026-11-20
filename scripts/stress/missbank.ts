/**
 * STRESS-2 Slack miss bank: small replay scenarios built from the recordings and the Opus answer keys (blocks A, B2),
 * so a scanner variant is scored in cents instead of a full rerun. Private outputs only (`<stress>/missbank/`).
 *
 *   npx tsx scripts/stress/missbank.ts build
 *       → bank.json: cases (every Slack-origin key item: misses, hits, flaky; the scanner-right extras), hard controls
 *         (key items adjudicated key_wrong: guesses that must stay noise), plain controls (qualifying messages in the
 *         bank's windows that no key item cites), and a few noise-only windows; grouped into the scanner's own windows
 *         (inbox 2 h slots from local 00:15, channel 6 h slots).
 *   npx tsx scripts/stress/missbank.ts run <variant> <rep> [day…]     variant: rec | tri | esc
 *       → one fresh DB per day (control_center_stress_mb_<variant>_<rep>_<day>), the day's windows in time order as
 *         backfill jobs through the production ScannerRuntime, live Haiku (+ Sonnet for esc); scored, then dropped.
 *   npx tsx scripts/stress/missbank.ts score
 *       → per-variant recall on cases, control precision, item precision, cost, escalations; per-case pass counts.
 */
import fs from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { SCANNER_MODEL } from '../../src/llm/models';
import { scanJob, type RuntimeJob } from '../../src/scanner/runtime/jobs';
import { isTrivial } from '../../src/scanner/triage/slack-triage';

import type { AnswerKey } from './answer-key';
import { World } from './driver/world';
import { dropDb } from './lib/db';
import { privDir, readJson, writePriv } from './lib/paths';
import { loadProfile } from './lib/profile';
import { addDays, localDay, localToUtc } from './lib/time';
import { tsMs, type SlackIndex } from './replay/slack';
import { slackRecallVariant } from './scenarios/accuracy';
import { normRef } from './score';

const H = 3_600_000;
const BLOCKS = { A: { from: '2026-10-21', to: '2026-10-22' }, B2: { from: '2026-11-02', to: '2026-11-04' } } as const;
type Block = keyof typeof BLOCKS;
export type Variant = 'rec' | 'tri' | 'esc';

export interface BankCase {
  id: string;
  block: Block;
  key?: string;
  kind: string;
  /** miss/hit/flaky: the item in SLK-1 (A) or B2-after; fp_right: a real item the key lacked; hard: key_wrong guess. */
  type: 'miss' | 'hit' | 'flaky' | 'fp_right' | 'hard';
  /** Normalized key refs (any role): a scanner item with non-context evidence on one of them matches. */
  refs: string[];
  origin: string;
  window: string;
}

export interface BankWindow {
  id: string;
  day: string;
  scope: string;
  from: string;
  to: string;
  cases: string[];
  controls: string[];
  noiseOnly?: boolean;
}

export interface Bank {
  builtAt: string;
  cases: BankCase[];
  windows: BankWindow[];
  /** Every ref any key item cites (both blocks), plus the scanner-right extras: never a control. */
  keyRefs: string[];
}

const bankDir = () => privDir('missbank');
/** `CC_MB_TAG=v1.2` keeps a skill iteration's results apart (`results-v1.2/`). */
const resultsDirName = () => (process.env.CC_MB_TAG ? `results-${process.env.CC_MB_TAG}` : 'results');

function slotOf(ts: number, scope: string): { from: string; to: string; day: string } {
  const hours = scope === 'inbox' ? 2 : 6;
  const day = localDay(ts);
  let start = localToUtc(addDays(day, -1), '00:15').getTime();
  while (start + hours * H <= ts) start += hours * H;
  return { from: new Date(start).toISOString(), to: new Date(start + hours * H).toISOString(), day: localDay(start) };
}

function scopeOf(classes: string[], channelId: string, channels: Set<string>): string | undefined {
  if (classes.some((c) => c === 'dm' || c === 'mentions' || c === 'mine') || !classes.length) return 'inbox';
  if (channels.has(channelId)) return `channel:${channelId}`;
  return undefined;
}

function build(): Bank {
  const root = privDir();
  const ix = readJson<SlackIndex>(path.join(root, 'recordings', 'slack', 'index.json'));
  const prof = loadProfile();
  const channels = new Set(prof.channels.filter((c) => c.watch || c.account).map((c) => c.id));
  const cases: BankCase[] = [];
  const keyRefs = new Set<string>();
  const outcome: Record<Block, Map<string, number>> = { A: new Map(), B2: new Map() };
  const runsOf: Record<Block, string[]> = { A: ['score-A-slack-new-1.json', 'score-A-slack-new-2.json'], B2: ['score-B2-after.json'] };
  for (const b of Object.keys(BLOCKS) as Block[]) {
    for (const f of runsOf[b]) {
      const sc = readJson<{ falseNegatives: Array<{ key: string }> }>(path.join(root, 'reports', f));
      const fn = new Set(sc.falseNegatives.map((x) => x.key));
      const key = readJson<AnswerKey>(path.join(root, 'answer-key', `${b}.json`));
      for (const it of key.items) outcome[b].set(it.key, (outcome[b].get(it.key) ?? 0) + (fn.has(it.key) ? 0 : 1));
    }
  }
  const windows = new Map<string, BankWindow>();
  const windowFor = (ts: number, scope: string) => {
    const s = slotOf(ts, scope);
    const id = `${scope}@${s.from}`;
    if (!windows.has(id)) windows.set(id, { id, day: s.day, scope, from: s.from, to: s.to, cases: [], controls: [] });
    return windows.get(id)!;
  };
  for (const b of Object.keys(BLOCKS) as Block[]) {
    const key = readJson<AnswerKey>(path.join(root, 'answer-key', `${b}.json`));
    const adj = readJson<{ fp: Record<string, string>; fn: Record<string, string> }>(path.join(root, 'answer-key', `${b}.adjudication.json`), { fp: {}, fn: {} });
    for (const it of key.items) for (const r of it.refs) keyRefs.add(normRef(r.ref));
    for (const fp of Object.entries(adj.fp).filter(([ref, v]) => v === 'scanner_right' && ref.startsWith('S:'))) keyRefs.add(normRef(fp[0]));
    for (const it of key.items.filter((x) => !x.handedOff)) {
      const o = it.refs.find((r) => r.role === 'origin') ?? it.refs[0];
      if (!o || !o.ref.startsWith('S:')) continue;
      const m = ix.messages[o.ref.slice(2)];
      if (!m) continue;
      const scope = scopeOf(m.classes, m.channelId, channels);
      if (!scope) continue;
      const w = windowFor(tsMs(m.ts), scope);
      const hits = outcome[b].get(it.key) ?? 0;
      const runs = runsOf[b].length;
      const type: BankCase['type'] = adj.fn[it.key] === 'key_wrong' ? 'hard' : hits === runs ? 'hit' : hits === 0 ? 'miss' : 'flaky';
      const c: BankCase = { id: `${b}:${it.key}`, block: b, key: it.key, kind: it.kind, type, refs: [...new Set(it.refs.map((r) => normRef(r.ref)))], origin: normRef(o.ref), window: w.id };
      cases.push(c);
      w.cases.push(c.id);
    }
    for (const [ref] of Object.entries(adj.fp).filter(([ref, v]) => v === 'scanner_right' && ref.startsWith('S:'))) {
      const m = ix.messages[ref.slice(2)];
      if (!m) continue;
      const scope = scopeOf(m.classes, m.channelId, channels);
      if (!scope) continue;
      const w = windowFor(tsMs(m.ts), scope);
      const c: BankCase = { id: `${b}:fp:${ref.slice(2)}`, block: b, kind: 'ask', type: 'fp_right', refs: [normRef(ref)], origin: normRef(ref), window: w.id };
      cases.push(c);
      w.cases.push(c.id);
    }
  }
  // Noise-only windows: per block, the 2 busiest inbox slots whose messages no key item cites.
  const inBlock = (day: string) => Object.values(BLOCKS).some((b) => day >= b.from && day <= b.to);
  const qualifies = (m: SlackIndex['messages'][string]) => m.classes.some((c) => c === 'dm' || c === 'mentions' || c === 'mine') && !isTrivial(m.text);
  const slots = new Map<string, { n: number; cited: boolean; ts: number; block: Block }>();
  for (const m of Object.values(ix.messages)) {
    if (!qualifies(m)) continue;
    const s = slotOf(tsMs(m.ts), 'inbox');
    if (!inBlock(s.day)) continue;
    const id = `inbox@${s.from}`;
    const cur = slots.get(id) ?? { n: 0, cited: false, ts: tsMs(m.ts), block: (s.day <= BLOCKS.A.to ? 'A' : 'B2') as Block };
    cur.n += 1;
    if (keyRefs.has(`S:${m.key}`)) cur.cited = true;
    slots.set(id, cur);
  }
  for (const b of Object.keys(BLOCKS) as Block[]) {
    const quiet = [...slots.entries()].filter(([id, s]) => s.block === b && !s.cited && !windows.has(id)).sort((x, y) => y[1].n - x[1].n).slice(0, 2);
    for (const [, s] of quiet) windowFor(s.ts, 'inbox').noiseOnly = true;
  }
  // Controls: qualifying messages in each window's scope class that no key item cites.
  for (const w of windows.values()) {
    const from = Date.parse(w.from);
    const to = Date.parse(w.to);
    for (const m of Object.values(ix.messages)) {
      const t = tsMs(m.ts);
      if (t < from || t >= to) continue;
      const inScope = w.scope === 'inbox' ? qualifies(m) : m.classes.includes(`ch:${w.scope.slice('channel:'.length)}`) && !isTrivial(m.text);
      if (!inScope || keyRefs.has(`S:${m.key}`)) continue;
      w.controls.push(`S:${m.key}`);
    }
  }
  const bank: Bank = { builtAt: new Date().toISOString(), cases, windows: [...windows.values()].sort((a, b) => a.from.localeCompare(b.from) || a.scope.localeCompare(b.scope)), keyRefs: [...keyRefs] };
  writePriv(path.join(bankDir(), 'bank.json'), JSON.stringify(bank, null, 1));
  return bank;
}

// ------------------------------------------------------------------ run

const recall = (v: Variant) => slackRecallVariant(v);

export interface ShardResult {
  variant: Variant;
  rep: number;
  day: string;
  costUsd: number;
  windows: number;
  runs: Array<{ window: string; status: string; detail?: string; costUsd?: number }>;
  passes: World['passLog'];
  items: Array<{ wi: string; title: string; kind: string; refs: Array<{ ref: string; role: string; reason: string }>; excerpt: string }>;
  autoRecorded: number;
}

async function runShard(bank: Bank, variant: Variant, rep: number, day: string, log: (m: string) => void): Promise<ShardResult> {
  const ws = bank.windows.filter((w) => w.day === day);
  const name = `mb_${variant}_${rep}_${day.replace(/-/g, '')}`;
  const w = new World({ scenario: name, start: ws[0]!.from, sources: ['slack'], runner: 'live', profile: loadProfile(), slackRecall: recall(variant), liveRunEstimateUsd: variant === 'esc' ? 0.35 : 0.2, log });
  await w.init();
  const runs: ShardResult['runs'] = [];
  let keep = false;
  try {
    await w.boot({ idle: true });
    for (const win of ws) {
      const target = Math.max(w.clock.nowMs(), Date.parse(win.to) + 10 * 60_000);
      if (target > w.clock.nowMs()) await w.clock.jumpTo(target);
      const queue: RuntimeJob[] = [scanJob({ connector: 'slack', scope: win.scope, window: { from: win.from, to: win.to }, mode: 'backfill', trigger: 'manual', runAt: w.clock.now().toISOString(), model: SCANNER_MODEL })];
      while (queue.length) {
        const job = queue.shift()!;
        const out = await w.scanning.scanner.executeJob(job);
        runs.push({ window: win.id, status: out.status, detail: out.detail?.slice(0, 160), costUsd: out.costUsd });
        for (const f of out.followUps) if (f.kind === 'scan' && f.mode === 'continuation') queue.push(f);
      }
      log(`[${name}] ${win.id} done; spend $${w.costUsd.toFixed(3)}`);
    }
    const r = await w.handle.db.execute<{ wid: string; title: string; kind: string; ext: string; src: string; role: string; reason: string; excerpt: string }>(sql`
      select w.id as wid, w.title, w.kind::text as kind, s.external_id as ext, s.source::text as src, ev.role::text as role, coalesce(ev.rationale, '') as reason,
             left(coalesce(s.body, s.title, ''), 300) as excerpt
        from work_items w join work_item_evidence ev on ev.work_item_id = w.id join source_items s on s.id = ev.source_item_id
       where w.title not like 'Where does this belong?%'`);
    const items = new Map<string, ShardResult['items'][number]>();
    for (const x of r.rows) {
      const it = items.get(x.wid) ?? { wi: x.wid, title: x.title, kind: x.kind, refs: [], excerpt: '' };
      it.refs.push({ ref: normRef(`${x.src === 'slack' ? 'S' : x.src}:${x.ext}`), role: x.role, reason: x.reason.slice(0, 160) });
      if (x.role === 'origin' || !it.excerpt) it.excerpt = x.excerpt;
      items.set(x.wid, it);
    }
    const auto = w.passLog.reduce((a, p) => a + (p.passes.find((s) => s.pass === 'traversal')?.autoRecorded ?? 0), 0);
    const res: ShardResult = { variant, rep, day, costUsd: w.costUsd, windows: ws.length, runs, passes: w.passLog, items: [...items.values()], autoRecorded: auto };
    writePriv(path.join(bankDir(), resultsDirName(), `${variant}-${rep}-${day}.json`), JSON.stringify(res, null, 1));
    return res;
  } catch (e) {
    keep = true; // a failed shard keeps its DB for a re-score (dropped at the end of the campaign)
    throw e;
  } finally {
    await w.close();
    if (!keep && process.env.CC_MB_KEEP_DB !== '1') dropDb(w.dbName);
  }
}

// ------------------------------------------------------------------ score

interface CaseScore {
  id: string;
  type: BankCase['type'];
  pass: boolean;
  via?: string;
}

export function scoreShards(bank: Bank, shards: ShardResult[], adj: Record<string, 'scanner_right' | 'key_right'> = {}) {
  const keyRefs = new Set(bank.keyRefs);
  const byWindowDay = new Set(shards.map((s) => s.day));
  const cases = bank.cases.filter((c) => byWindowDay.has(bank.windows.find((w) => w.id === c.window)!.day));
  const items = shards.flatMap((s) => s.items);
  const nonCtx = (it: ShardResult['items'][number]) => it.refs.filter((r) => r.role !== 'context');
  const caseScores: CaseScore[] = cases.map((c) => {
    const refs = new Set(c.refs);
    const hit = items.find((it) => nonCtx(it).some((r) => refs.has(r.ref)));
    const via = hit ? (nonCtx(hit).find((r) => refs.has(r.ref))!.reason.match(/^(triage|escalate):/)?.[1] ?? 'traversal') : undefined;
    return c.type === 'hard' ? { id: c.id, type: c.type, pass: !hit, via } : { id: c.id, type: c.type, pass: !!hit, via };
  });
  // Items: TP when any non-context ref is in the key; else FP (pending adjudication).
  // Refs that only key_wrong items cite (the hard controls) are no evidence of a real item.
  const realRefs = new Set(bank.cases.filter((c) => c.type !== 'hard').flatMap((c) => c.refs));
  const hardOnly = new Set(bank.cases.filter((c) => c.type === 'hard').flatMap((c) => c.refs).filter((r) => !realRefs.has(r)));
  const inKey = (r: string) => keyRefs.has(r) && !hardOnly.has(r);
  const fps = items.filter((it) => !nonCtx(it).some((r) => inKey(r.ref)) && !it.refs.some((r) => inKey(r.ref) && r.role === 'origin'));
  // Adjudicated: an item whose origin was ruled scanner_right is real, so its refs are no control failure.
  const realFp = fps.filter((it) => adj[(it.refs.find((r) => r.role === 'origin') ?? it.refs[0])?.ref ?? ''] !== 'scanner_right');
  const controls = bank.windows.filter((w) => byWindowDay.has(w.day)).flatMap((w) => w.controls);
  const fpRefs = new Set(realFp.flatMap((it) => nonCtx(it).map((r) => r.ref)));
  const hardCases = caseScores.filter((c) => c.type === 'hard');
  const controlFails = controls.filter((r) => fpRefs.has(r));
  const pos = caseScores.filter((c) => c.type !== 'hard');
  const passes = shards.flatMap((s) => s.passes.flatMap((p) => p.passes));
  const sum = (f: (p: (typeof passes)[number]) => number) => passes.reduce((a, p) => a + f(p), 0);
  return {
    cases: caseScores,
    recall: pos.length ? pos.filter((c) => c.pass).length / pos.length : null,
    recallByType: Object.fromEntries((['miss', 'flaky', 'hit', 'fp_right'] as const).map((t) => [t, { n: pos.filter((c) => c.type === t).length, pass: pos.filter((c) => c.type === t && c.pass).length }])),
    controls: { n: controls.length + hardCases.length, fails: controlFails.length + hardCases.filter((c) => !c.pass).length, precision: (controls.length + hardCases.length - controlFails.length - hardCases.filter((c) => !c.pass).length) / Math.max(1, controls.length + hardCases.length) },
    items: { n: items.length, fp: fps.length, precision: items.length ? (items.length - fps.length) / items.length : null },
    fps: fps.map((f) => ({ wi: f.wi, title: f.title, kind: f.kind, origin: (f.refs.find((r) => r.role === 'origin') ?? f.refs[0])?.ref, reason: (f.refs.find((r) => r.role === 'origin') ?? f.refs[0])?.reason, excerpt: f.excerpt.slice(0, 200) })),
    costUsd: shards.reduce((a, s) => a + s.costUsd, 0),
    costByPass: { traversal: sum((p) => (p.pass === 'traversal' ? p.costUsd : 0)), triage: sum((p) => (p.pass === 'triage' ? p.costUsd : 0)), escalate: sum((p) => (p.pass === 'escalate' ? p.costUsd : 0)) },
    triaged: sum((p) => (p.pass === 'triage' ? (p.messages ?? 0) : 0)),
    escalated: sum((p) => (p.pass === 'escalate' ? (p.messages ?? 0) : 0)),
    autoRecorded: shards.reduce((a, s) => a + s.autoRecorded, 0),
    failedRuns: shards.flatMap((s) => s.runs.filter((r) => r.status !== 'succeeded')).length,
  };
}

function score() {
  const bank = readJson<Bank>(path.join(bankDir(), 'bank.json'));
  const dir = path.join(bankDir(), resultsDirName());
  const shards = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson<ShardResult>(path.join(dir, f))) : [];
  const adj = readJson<Record<string, 'scanner_right' | 'key_right'>>(path.join(bankDir(), 'adjudication.json'), {});
  const days = [...new Set(bank.windows.map((w) => w.day))];
  const out: Record<string, unknown> = {};
  const perCase: Record<string, Record<string, number>> = {};
  for (const v of ['rec', 'tri', 'esc'] as Variant[]) {
    const reps = [...new Set(shards.filter((s) => s.variant === v).map((s) => s.rep))].sort();
    const rows = reps
      .map((rep) => {
        const ss = shards.filter((s) => s.variant === v && s.rep === rep);
        if (days.some((d) => !ss.find((s) => s.day === d))) return undefined; // incomplete rep
        const sc = scoreShards(bank, ss, adj);
        // Adjudicated: an FP whose origin was ruled scanner_right is a true item (and not a control failure).
        const right = sc.fps.filter((f) => f.origin && adj[f.origin] === 'scanner_right').length;
        for (const c of sc.cases) (perCase[c.id] ??= {})[v] = ((perCase[c.id] ??= {})[v] ?? 0) + (c.pass ? 1 : 0);
        return { rep, ...sc, itemsAdj: { n: sc.items.n, fp: sc.items.fp - right, precision: sc.items.n ? (sc.items.n - sc.items.fp + right) / sc.items.n : null }, pendingFp: sc.fps.filter((f) => !f.origin || !adj[f.origin]).map((f) => f.origin) };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    out[v] = {
      reps: rows.length,
      recall: rows.map((r) => r.recall),
      controlPrecision: rows.map((r) => r.controls.precision),
      itemPrecisionAdj: rows.map((r) => r.itemsAdj.precision),
      costUsd: rows.map((r) => r.costUsd),
      costByPass: rows.map((r) => r.costByPass),
      escalated: rows.map((r) => r.escalated),
      triaged: rows.map((r) => r.triaged),
      autoRecorded: rows.map((r) => r.autoRecorded),
      failedRuns: rows.map((r) => r.failedRuns),
      recallByType: rows.map((r) => r.recallByType),
      controls: rows.map((r) => r.controls),
      pendingFp: rows.flatMap((r) => r.pendingFp),
      fps: rows.flatMap((r) => r.fps),
    };
  }
  const report = { bank: { cases: bank.cases.length, byType: Object.fromEntries(['miss', 'flaky', 'hit', 'fp_right', 'hard'].map((t) => [t, bank.cases.filter((c) => c.type === t).length])), windows: bank.windows.length, controls: bank.windows.reduce((a, w) => a + w.controls.length, 0), days }, variants: out, perCase };
  writePriv(path.join(bankDir(), process.env.CC_MB_TAG ? `score-${process.env.CC_MB_TAG}.json` : 'score.json'), JSON.stringify(report, null, 1));
  return report;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'build') {
    const b = build();
    const byType = Object.fromEntries(['miss', 'flaky', 'hit', 'fp_right', 'hard'].map((t) => [t, b.cases.filter((c) => c.type === t).length]));
    console.log(JSON.stringify({ cases: b.cases.length, byType, windows: b.windows.length, noiseOnly: b.windows.filter((w) => w.noiseOnly).length, controls: b.windows.reduce((a, w) => a + w.controls.length, 0), perDay: Object.fromEntries([...new Set(b.windows.map((w) => w.day))].map((d) => [d, b.windows.filter((w) => w.day === d).length])) }, null, 1));
  } else if (cmd === 'run') {
    const [variant, rep, ...days] = rest as [Variant, string, ...string[]];
    const bank = readJson<Bank>(path.join(bankDir(), 'bank.json'));
    const all = [...new Set(bank.windows.map((w) => w.day))];
    const todo = days.length ? days : all;
    const results = await Promise.all(todo.map((d) => runShard(bank, variant, Number(rep), d, (m) => console.log(m))));
    console.log(JSON.stringify({ variant, rep, cost: results.reduce((a, r) => a + r.costUsd, 0), items: results.reduce((a, r) => a + r.items.length, 0) }));
  } else if (cmd === 'score') {
    const r = score();
    console.log(JSON.stringify({ bank: r.bank, variants: Object.fromEntries(Object.entries(r.variants).map(([k, v]) => [k, { ...(v as Record<string, unknown>), fps: undefined, recallByType: undefined, controls: undefined }])) }, null, 1));
  } else {
    console.error('usage: missbank.ts build | run <rec|tri|esc> <rep> [day…] | score');
    process.exit(2);
  }
}

if (/missbank\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((e) => {
    console.error((e as Error).stack);
    process.exit(1);
  });
}
