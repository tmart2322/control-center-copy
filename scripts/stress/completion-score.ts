/**
 * CMP-1: score the completion pass of a scenario DB against the block's answer key.
 *
 *   links    every `done_check:` evidence row (completion, and progress for "partial") is matched to the key item
 *            its work item stands for (through the scanner's own non-context evidence on the key's refs):
 *              right      the key item was finished in the block and the cited message is a key completion ref,
 *                         or comes at/after the key's first completion (another message of the same delivery)
 *              premature  the key item was finished, but the cited message is before that
 *              wrong      the key item was not finished in the block
 *              unkeyed    the work item matches no key item (written out for adjudication by hand)
 *   recall   key items finished in the block whose matched work item got a right completion link
 *            (over all such key items, and over those the scanner captured at all)
 *   closure  the real path: items the engine moved to done / likely_done, right or wrong the same way
 *   cost     completion.check jobs (result.costUsd), per scan run and per day
 *
 * Adjudication (`<stress>/answer-key/<block>.completion-adjudication.json`: {"<workItemId>|<sourceRef>": "right" |
 * "right_subtask" | "wrong"}) settles unkeyed and disputed links. Details with titles and excerpts go to a private file only; stdout carries counts.
 *   npx tsx scripts/stress/completion-score.ts <block> <scenarioDb> [label]
 */
import fs from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import type { AnswerKey } from './answer-key';
import { openStressDb, urlOf } from './lib/db';
import { privDir, readJson, writePriv } from './lib/paths';
import { dayBounds, localDay } from './lib/time';
import { dbRef, normRef, observability } from './score';

type EvRow = { wid: string; title: string; status: string; ref: string; sid: string; role: string; rationale: string | null; confidence: number; at: string; linked: string; from_me: boolean; excerpt: string };

const TOL_MS = 10 * 60_000;
const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

/** Slack refs carry their time; other refs are looked up in the DB. */
function refTime(ref: string, dbTimes: Map<string, number>): number | undefined {
  const t = dbTimes.get(ref);
  if (t != null) return t;
  const m = /^S:[A-Z0-9]+:(\d{9,11}\.\d+)$/.exec(ref);
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

export type LinkVerdict = 'right' | 'premature' | 'wrong' | 'unkeyed';

/**
 * Everything needed to judge one completion signal against the key, read from a scenario DB once: which key items
 * each work item stands for (through the scanner's own non-context evidence), source times, finished key items.
 */
export async function loadJudge(block: string, dbName: string) {
  const dir = privDir('answer-key');
  const key = readJson<AnswerKey>(path.join(dir, `${block}.json`));
  const adj = readJson<{ fn: Record<string, string> }>(path.join(dir, `${block}.adjudication.json`), { fn: {} });
  const cAdj = readJson<Record<string, 'right' | 'right_subtask' | 'wrong'>>(path.join(dir, `${block}.completion-adjudication.json`), {});
  const blockEnd = Date.parse(dayBounds(key.to).to);
  const blockStart = Date.parse(dayBounds(key.from).from);
  const unobservable = observability(blockEnd);
  const items = key.items
    .filter((it) => !it.handedOff && adj.fn[it.key] !== 'key_wrong')
    .map((it) => ({ ...it, refs: it.refs.map((r) => ({ ...r, ref: normRef(r.ref) })).filter((r) => !unobservable.has(r.ref)) }))
    .filter((it) => it.refs.length > 0);
  const digestRefs = new Set(
    fs
      .readFileSync(path.join(dir, `${block}.digest.txt`), 'utf8')
      .split('\n')
      .map((l) => l.match(/^\[([^\]]+)\]/)?.[1])
      .filter((x): x is string => !!x)
      .map(normRef),
  );
  const h = openStressDb(urlOf(dbName), 'stress-completion-score');
  const ev = (
    await h.db.execute<Omit<EvRow, 'ref'> & { src: string; ext: string; dk: string }>(sql`
      select w.id as wid, w.title, w.status::text as status, s.source::text as src, s.external_id as ext, s.dedupe_key as dk, s.id as sid,
             e.role::text as role, e.rationale, e.confidence::float8 as confidence, s.occurred_at::text as at, e.created_at::text as linked,
             s.from_me, left(coalesce(s.body, s.title, ''), 200) as excerpt
        from work_items w join work_item_evidence e on e.work_item_id = w.id join source_items s on s.id = e.source_item_id
       where w.title not like 'Where does this belong?%'`)
  ).rows.map((r) => ({ ...r, ref: dbRef(r.src, r.ext, r.dk) }));
  const times = new Map<string, number>();
  const refOfId = new Map<string, string>();
  const srcRows = await h.db.execute<{ id: string; src: string; ext: string; dk: string; at: string }>(sql`
    select id, source::text as src, external_id as ext, dedupe_key as dk, occurred_at::text as at from source_items`);
  for (const r of srcRows.rows) {
    const ref = dbRef(r.src, r.ext, r.dk);
    times.set(ref, Date.parse(r.at));
    refOfId.set(r.id, ref);
  }
  const isPass = (r: { rationale: string | null }) => (r.rationale ?? '').startsWith('done_check:');
  const byWi = new Map<string, EvRow[]>();
  for (const r of ev) byWi.set(r.wid, [...(byWi.get(r.wid) ?? []), r]);
  const keysOf = new Map<string, string[]>();
  for (const [wid, rows] of byWi) {
    const own = rows.filter((r) => !isPass(r) && r.role !== 'context');
    keysOf.set(wid, items.filter((k) => k.refs.some((kr) => own.some((r) => r.ref === kr.ref))).map((k) => k.key));
  }
  const keyByKey = new Map(items.map((k) => [k.key, k]));
  const completionRefs = (k: (typeof items)[number]) => k.refs.filter((r) => r.role === 'completion').map((r) => r.ref);
  const firstDone = (k: (typeof items)[number]) => Math.min(...completionRefs(k).map((r) => refTime(r, times) ?? Number.POSITIVE_INFINITY));
  /** `matched`: the key items this signal really finishes (a work item can stand for several). */
  const judge = (wid: string, ref: string, at: number): { v: LinkVerdict; keys: string[]; matched: string[] } => {
    const ks = keysOf.get(wid) ?? [];
    // Right: one of the key's completion refs, or another message of the same delivery (same Slack conversation as a
    // completion ref, at or after the key's first completion).
    const conv = (r: string) => (/^S:([A-Z0-9]+):/.exec(r)?.[1] ?? r);
    const matched = ks.filter((kk) => {
      const k = keyByKey.get(kk)!;
      const done = completionRefs(k);
      return done.length > 0 && (done.includes(ref) || (done.some((d) => conv(d) === conv(ref)) && at >= firstDone(k) - TOL_MS));
    });
    const adjV = cAdj[`${wid}|${ref}`];
    // A hand adjudication wins: e.g. a work item that merged two asks, one of which this message finished.
    //   right          the key item is finished by this (earlier than the key placed it): recall credit
    //   right_subtask  right for the work item as titled (a sub-task of a bigger key item): no recall credit
    if (adjV === 'right') return { v: 'right', keys: ks, matched: ks.filter((kk) => completionRefs(keyByKey.get(kk)!).length > 0) };
    if (adjV === 'right_subtask') return { v: 'right', keys: ks, matched: [] };
    if (adjV) return { v: adjV, keys: ks, matched: [] };
    if (!ks.length) return { v: 'unkeyed', keys: [], matched: [] };
    if (matched.length) return { v: 'right', keys: ks, matched };
    const premature = ks.some((kk) => completionRefs(keyByKey.get(kk)!).length > 0);
    return { v: premature ? 'premature' : 'wrong', keys: ks, matched: [] };
  };
  const doneKeys = items.filter((k) => completionRefs(k).some((r) => digestRefs.has(r)));
  const capturedBy = (k: (typeof items)[number]) => [...keysOf.entries()].filter(([, ks]) => ks.includes(k.key)).map(([w]) => w);
  const captured = doneKeys.filter((k) => capturedBy(k).length > 0);
  return { h, key, ev, isPass, byWi, keysOf, times, refOfId, judge, doneKeys, captured, capturedBy, completionRefs, blockStart, blockEnd };
}

export type Judge = Awaited<ReturnType<typeof loadJudge>>;

/** Precision / recall of a set of completion signals (`at` = the cited message's time). Sure = confidence ≥ 0.9. */
export function scoreSignals(j: Judge, signals: Array<{ wid: string; ref: string; role: string; confidence: number; at: number }>) {
  const judged = signals.map((s) => ({ ...s, ...j.judge(s.wid, s.ref, s.at) }));
  const comp = judged.filter((l) => l.role === 'completion' && l.at >= j.blockStart && l.at < j.blockEnd);
  const sure = comp.filter((l) => l.confidence >= 0.9);
  const keyed = (xs: typeof comp) => xs.filter((x) => x.v !== 'unkeyed');
  const found = j.doneKeys.filter((k) => comp.some((l) => l.v === 'right' && l.matched.includes(k.key)));
  const exact = j.doneKeys.filter((k) => comp.some((l) => l.keys.includes(k.key) && j.completionRefs(k).includes(l.ref)));
  return {
    judged,
    found,
    summary: {
      links: comp.length,
      right: comp.filter((l) => l.v === 'right').length,
      premature: comp.filter((l) => l.v === 'premature').length,
      wrong: comp.filter((l) => l.v === 'wrong').length,
      unkeyed: comp.filter((l) => l.v === 'unkeyed').length,
      precision: pct(keyed(comp).filter((l) => l.v === 'right').length, keyed(comp).length),
      sure: {
        links: sure.length,
        right: sure.filter((l) => l.v === 'right').length,
        wrong: sure.filter((l) => l.v === 'wrong' || l.v === 'premature').length,
        unkeyed: sure.filter((l) => l.v === 'unkeyed').length,
        precision: pct(keyed(sure).filter((l) => l.v === 'right').length, keyed(sure).length),
      },
      recall: pct(found.length, j.doneKeys.length),
      recallExactRef: pct(exact.length, j.doneKeys.length),
      recallOfCaptured: pct(found.filter((k) => j.captured.includes(k)).length, j.captured.length),
    },
  };
}

export async function scoreCompletion(block: string, dbName: string, label = dbName) {
  const j = await loadJudge(block, dbName);
  const h = j.h;
  try {
    const links = j.ev.filter(j.isPass);
    const scored = scoreSignals(j, links.map((l) => ({ wid: l.wid, ref: l.ref, role: l.role, confidence: l.confidence, at: Date.parse(l.at) })));
    const tally = scored.judged.reduce<Record<string, number>>((a, x) => ((a[`${x.role}:${x.v}`] = (a[`${x.role}:${x.v}`] ?? 0) + 1), a), {});

    // ---- closure on the real path (engine transitions, not undone)
    const tr = await h.db.execute<{ wid: string; to: string; at: string; rationale: string | null; ref_src: string | null; ext: string | null; dk: string | null }>(sql`
      select t.work_item_id as wid, t.to_status::text as to, t.occurred_at::text as at, e.rationale, s.source::text as ref_src, s.external_id as ext, s.dedupe_key as dk
        from work_item_transitions t
        left join work_item_evidence e on e.id = t.evidence_id
        left join source_items s on s.id = e.source_item_id
       where t.actor_kind = 'engine' and t.undone_at is null and t.to_status in ('done', 'likely_done')`);
    const closures = tr.rows.map((r) => {
      const ref = r.ref_src ? dbRef(r.ref_src, r.ext!, r.dk!) : '';
      const at = r.ref_src ? (j.times.get(ref) ?? Date.parse(r.at)) : Date.parse(r.at);
      return { wid: r.wid, to: r.to, byPass: (r.rationale ?? '').startsWith('done_check:'), ref, ...j.judge(r.wid, ref, at) };
    });
    const closeTally = closures.reduce<Record<string, number>>((a, c) => {
      const k = `${c.to}:${c.byPass ? 'pass' : 'scanner'}:${c.v}`;
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {});

    // ---- cost
    const jobs = await h.db.execute<{ cost: string | null; calls: string | null; fin: string }>(sql`
      select result->>'costUsd' as cost, result->>'calls' as calls, finished_at::text as fin
        from jobs where kind = 'completion.check' and status = 'succeeded' order by finished_at`);
    const scans = await h.db.execute<{ n: string; stored: string }>(sql`
      select count(*)::text as n, count(*) filter (where items_new + items_updated > 0)::text as stored
        from scan_runs where status = 'succeeded' and scope not like '%:completion:%' and scope not like '%:reconcile:%'`);
    const totalUsd = jobs.rows.reduce((a, x) => a + Number(x.cost ?? 0), 0);
    const perDay: Record<string, { usd: number; jobs: number; calls: number }> = {};
    for (const x of jobs.rows) {
      const d = localDay(x.fin);
      const y = (perDay[d] ??= { usd: 0, jobs: 0, calls: 0 });
      y.usd += Number(x.cost ?? 0);
      y.jobs += 1;
      y.calls += Number(x.calls ?? 0);
    }
    const scanRuns = Number(scans.rows[0]!.n);
    const storing = Number(scans.rows[0]!.stored);
    const report = {
      label,
      block,
      keyItemsFinishedInBlock: j.doneKeys.length,
      keyItemsFinishedCaptured: j.captured.length,
      links: tally,
      completion: scored.summary,
      closure: closeTally,
      autoClosedRight: closures.filter((c) => c.to === 'done' && c.v === 'right').length,
      autoClosedWrong: closures.filter((c) => c.to === 'done' && (c.v === 'wrong' || c.v === 'premature')).length,
      autoClosedUnkeyed: closures.filter((c) => c.to === 'done' && c.v === 'unkeyed').length,
      likelyDoneRight: closures.filter((c) => c.to === 'likely_done' && c.v === 'right').length,
      likelyDoneWrong: closures.filter((c) => c.to === 'likely_done' && (c.v === 'wrong' || c.v === 'premature')).length,
      likelyDoneUnkeyed: closures.filter((c) => c.to === 'likely_done' && c.v === 'unkeyed').length,
      cost: {
        totalUsd: Number(totalUsd.toFixed(4)),
        jobs: jobs.rows.length,
        calls: jobs.rows.reduce((a, x) => a + Number(x.calls ?? 0), 0),
        scanRuns,
        scanRunsThatStoredItems: storing,
        perScanRunUsd: scanRuns ? Number((totalUsd / scanRuns).toFixed(5)) : null,
        perStoringScanRunUsd: storing ? Number((totalUsd / storing).toFixed(5)) : null,
        perDay: Object.fromEntries(Object.entries(perDay).map(([d, x]) => [d, { ...x, usd: Number(x.usd.toFixed(4)) }])),
      },
    };
    // Private details for adjudication (titles, excerpts): never printed, never committed.
    writePriv(
      path.join(privDir('reports'), `completion-${label}.json`),
      JSON.stringify(
        {
          ...report,
          linkDetails: scored.judged.map((l, i) => ({ ...l, title: links[i]!.title, status: links[i]!.status, reason: links[i]!.rationale, excerpt: links[i]!.excerpt })),
          closureDetails: closures,
          missed: j.doneKeys.filter((k) => !scored.found.includes(k)).map((k) => ({ key: k.key, title: k.title, captured: j.capturedBy(k), completionRefs: j.completionRefs(k) })),
        },
        null,
        1,
      ),
    );
    return report;
  } finally {
    await h.close();
  }
}

const invoked = /completion-score\.ts$/.test(process.argv[1] ?? '');
if (invoked) {
  const [block, db, label] = process.argv.slice(2);
  scoreCompletion(block!, db!, label)
    .then((r) => console.log(JSON.stringify(r, null, 1)))
    .catch((e) => {
      console.error((e as Error).message);
      process.exit(1);
    });
}
