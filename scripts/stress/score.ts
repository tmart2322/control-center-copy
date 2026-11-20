/**
 * Score a scenario DB against the answer key: precision / recall per scanner and per signal type,
 * cross-source linking accuracy and misassigned evidence roles. Disagreements are written for adjudication
 * (`<stress>/answer-key/<block>.adjudication.json`: {"fp": {"<origin ref>": "scanner_right" | "key_right"},
 * "fn": {"<item key>": "key_right" | "key_wrong"}}), and adjudicated numbers are reported next to raw ones.
 *   npx tsx scripts/stress/score.ts <block> <scenarioDb> [label]
 */
import fs from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { openStressDb, urlOf } from './lib/db';
import { privDir, readJson, writePriv } from './lib/paths';
import { parseDriveSearch } from '../../src/connectors/google/parse';

import type { AnswerKey, KeyItem } from './answer-key';
import { dayBounds } from './lib/time';
import type { GoogleRecording } from './record/google';
import type { SoqlTable } from './replay/soql';

type Role = KeyItem['refs'][number]['role'];

export interface ScannerEvidence {
  workItemId: string;
  title: string;
  kind: string;
  status: string;
  createdBy: string;
  ref: string; // normalized
  role: Role;
  connector: string;
  excerpt: string;
}

/** Ref normalization shared by key and DB: "<sys>:<id>" with modstamps/revision suffixes removed. */
export function normRef(ref: string): string {
  const [sys, ...rest] = ref.split(':');
  const id = rest.join(':').replace(/@.*$/, '');
  return `${sys}:${id}`;
}

const SYS: Record<string, string> = { slack: 'S', gmail: 'G', calendar: 'C', gemini_notes: 'N', drive: 'D', claude: 'CS', org62: 'O' };

export function dbRef(source: string, externalId: string, dedupe: string): string {
  if (dedupe.startsWith('training:gmail:')) return `G:${externalId}`;
  const s = SYS[source] ?? source;
  return normRef(`${s}:${externalId}`);
}

const refSource = (r: string) => ({ S: 'slack', G: 'gmail', C: 'calendar', N: 'gemini_notes', D: 'drive', CS: 'claude_sessions', O: 'org62' })[r.split(':')[0]!] ?? 'other';

/** Refs whose current state is newer than `t` (Drive edits, Org62 modstamps): replay hides them at `t`. */
export function observability(t: number): Set<string> {
  const out = new Set<string>();
  const root = privDir('recordings');
  const g = readJson<GoogleRecording>(path.join(root, 'google', 'recording.json'));
  for (const line of g.drive.rows) {
    const f = parseDriveSearch(line).files[0];
    if (!f) continue;
    const notes = /notes by gemini/i.test(f.name);
    const visibleAt = notes ? Date.parse(f.created ?? f.modified) : Date.parse(f.modified);
    if (visibleAt > t) out.add(`${notes ? 'N' : 'D'}:${f.id}`);
  }
  const tables = readJson<Record<string, SoqlTable>>(path.join(root, 'org62', 'tables.json'), {});
  for (const tab of Object.values(tables)) {
    for (const r of tab.rows) {
      const at = Date.parse(String(r.SystemModstamp ?? '').replace(/\+0000$/, 'Z'));
      if (Number.isFinite(at) && at > t) out.add(`O:${tab.object}:${String(r.Id)}`);
      const opp = r.Opportunity as Record<string, unknown> | undefined;
      const oat = Date.parse(String(opp?.SystemModstamp ?? '').replace(/\+0000$/, 'Z'));
      if (Number.isFinite(oat) && oat > t && r.OpportunityId) out.add(`O:Opportunity:${String(r.OpportunityId)}`);
    }
  }
  return out;
}

async function loadScanner(dbName: string): Promise<ScannerEvidence[]> {
  const h = openStressDb(urlOf(dbName), 'stress-score');
  try {
    const r = await h.db.execute<{ wid: string; title: string; kind: string; status: string; src: string; ext: string; dk: string; role: Role; actor: string | null; excerpt: string | null }>(sql`
      select w.id as wid, w.title, w.kind::text as kind, w.status::text as status, s.source::text as src, s.external_id as ext, s.dedupe_key as dk,
             ev.role::text as role, ev.created_by as actor, left(coalesce(s.body, s.title, ''), 220) as excerpt
        from work_items w join work_item_evidence ev on ev.work_item_id = w.id join source_items s on s.id = ev.source_item_id`);
    return r.rows.map((x) => ({ workItemId: x.wid, title: x.title, kind: x.kind, status: x.status, createdBy: x.actor ?? '', ref: dbRef(x.src, x.ext, x.dk), role: x.role, connector: x.src, excerpt: x.excerpt ?? '' }));
  } finally {
    await h.close();
  }
}

interface Adjudication {
  fp: Record<string, 'scanner_right' | 'key_right'>;
  fn: Record<string, 'key_right' | 'key_wrong'>;
}

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

export async function score(block: string, dbName: string, label = dbName) {
  const dir = privDir('answer-key');
  const key = readJson<AnswerKey>(path.join(dir, `${block}.json`));
  const adj = readJson<Adjudication>(path.join(dir, `${block}.adjudication.json`), { fp: {}, fn: {} });
  const ev = await loadScanner(dbName);
  // Key restricted to what replay could show at the block's end: a Drive file edited after it, or an Org62 row modified
  // after it, cannot be time-travelled (their earlier state is unknown) and is not served.
  const blockEnd = Date.parse(dayBounds(key.to).to);
  const unobservable = observability(blockEnd);
  const items = key.items
    .map((it) => ({ ...it, refs: it.refs.map((r) => ({ ...r, ref: normRef(r.ref) })).filter((r) => !unobservable.has(r.ref)) }))
    .filter((it) => it.refs.length > 0);
  const droppedUnobservable = key.items.length - items.length;
  const byWi = new Map<string, ScannerEvidence[]>();
  for (const e of ev) byWi.set(e.workItemId, [...(byWi.get(e.workItemId) ?? []), e]);
  const triage = (t: string) => /^Where does this belong\?/.test(t);
  // Only scanner items whose evidence lies in the block's data (the digest the key saw) are scored.
  const digestRefs = new Set(
    fs
      .readFileSync(path.join(dir, `${block}.digest.txt`), 'utf8')
      .split('\n')
      .map((l) => l.match(/^\[([^\]]+)\]/)?.[1])
      .filter((x): x is string => !!x)
      .map(normRef),
  );
  const scannerItems = [...byWi.entries()].filter(([, es]) => !triage(es[0]!.title) && es.some((e) => digestRefs.has(e.ref)));

  // ---- item recall (by origin connector and kind)
  const refToKey = new Map<string, string>();
  for (const it of items) for (const r of it.refs) refToKey.set(r.ref, it.key);
  const actionable = items.filter((it) => !it.handedOff);
  const rows: Array<{ key: string; kind: string; source: string; title: string; matched: boolean; wi?: string; crossSources: string[]; crossLinked?: boolean }> = [];
  for (const it of actionable) {
    const origin = it.refs.find((r) => r.role === 'origin') ?? it.refs[0];
    const source = origin ? refSource(origin.ref) : 'other';
    const refs = new Set(it.refs.map((r) => r.ref));
    const hits = scannerItems.filter(([, es]) => es.some((e) => refs.has(e.ref) && e.role !== 'context'));
    const sources = [...new Set(it.refs.map((r) => refSource(r.ref)))];
    let crossLinked: boolean | undefined;
    if (sources.length > 1) crossLinked = hits.some(([, es]) => new Set(es.filter((e) => refs.has(e.ref)).map((e) => refSource(e.ref))).size > 1);
    rows.push({ key: it.key, kind: it.kind, source, title: it.title, matched: hits.length > 0, wi: hits[0]?.[0], crossSources: sources, crossLinked });
  }

  // ---- precision: scanner items with a non-context origin/evidence ref in the key
  const fps: Array<{ originRef: string; title: string; kind: string; connector: string; excerpt: string }> = [];
  const tps: string[] = [];
  const precRows: Array<{ connector: string; kind: string; tp: boolean }> = [];
  for (const [wi, es] of scannerItems) {
    const o = es.find((e) => e.role === 'origin') ?? es[0]!;
    const inKey = es.some((e) => refToKey.has(e.ref));
    precRows.push({ connector: o.connector, kind: o.kind, tp: inKey });
    if (inKey) tps.push(wi);
    else fps.push({ originRef: o.ref, title: o.title, kind: o.kind, connector: o.connector, excerpt: o.excerpt.slice(0, 160) });
  }

  // ---- roles: for each key ref the scanner linked to the matched item, compare roles
  const roleStats: Record<string, { correct: number; misassigned: number; missed: number }> = {};
  const misassigned: Array<{ ref: string; key: Role; scanner: Role }> = [];
  for (const r of rows) {
    const it = items.find((x) => x.key === r.key)!;
    for (const kr of it.refs) {
      const s = (roleStats[kr.role] ??= { correct: 0, misassigned: 0, missed: 0 });
      const se = ev.filter((e) => e.ref === kr.ref && (!r.wi || e.workItemId === r.wi));
      if (!se.length) s.missed += 1;
      else if (se.some((e) => e.role === kr.role)) s.correct += 1;
      else {
        s.misassigned += 1;
        misassigned.push({ ref: kr.ref, key: kr.role, scanner: se[0]!.role });
      }
    }
  }

  const group = <T>(xs: T[], k: (x: T) => string) => xs.reduce<Record<string, T[]>>((a, x) => ((a[k(x)] ??= []).push(x), a), {});
  const recallBy = (k: (x: (typeof rows)[number]) => string) => Object.fromEntries(Object.entries(group(rows, k)).map(([g, xs]) => [g, { n: xs.length, recall: pct(xs.filter((x) => x.matched).length, xs.length) }]));
  const precBy = (k: (x: (typeof precRows)[number]) => string) => Object.fromEntries(Object.entries(group(precRows, k)).map(([g, xs]) => [g, { n: xs.length, precision: pct(xs.filter((x) => x.tp).length, xs.length) }]));
  const cross = rows.filter((r) => r.crossLinked !== undefined);

  // ---- adjudicated
  const fpScannerRight = fps.filter((f) => adj.fp[f.originRef] === 'scanner_right').length;
  const fnKeyWrong = rows.filter((r) => !r.matched && adj.fn[r.key] === 'key_wrong').length;
  const adjTp = tps.length + fpScannerRight;
  const adjPrecision = pct(adjTp, scannerItems.length);
  const adjRecallDen = rows.length - fnKeyWrong + fpScannerRight;
  const adjRecall = pct(rows.filter((r) => r.matched).length + fpScannerRight, adjRecallDen);

  const report = {
    label,
    block,
    keyItems: items.length,
    keyItemsUnobservableInReplay: droppedUnobservable,
    keyActionable: rows.length,
    scannerItems: scannerItems.length,
    triageQuestions: byWi.size - scannerItems.length,
    recall: pct(rows.filter((r) => r.matched).length, rows.length),
    precision: pct(tps.length, scannerItems.length),
    adjudicated: { recall: adjRecall, precision: adjPrecision, fpScannerRight, fnKeyWrong, pendingFp: fps.filter((f) => !adj.fp[f.originRef]).length, pendingFn: rows.filter((r) => !r.matched && !adj.fn[r.key]).length },
    // Slack-origin items only, adjudicated the same way (key_wrong misses out, scanner-right extras in).
    // Slack-origin items only, adjudicated strictly: key_wrong items leave the denominator AND count as false
    // positives when the scanner proposed them (a guess the key wrongly listed is not work); scanner-right extras count.
    slackAdjudicated: (() => {
      const wrongKeys = new Set(items.filter((it) => adj.fn[it.key] === 'key_wrong').map((it) => it.key));
      const sr = rows.filter((r) => r.source === 'slack' && !wrongKeys.has(r.key));
      const right = fps.filter((f) => f.connector === 'slack' && adj.fp[f.originRef] === 'scanner_right').length;
      const slackItems = scannerItems.filter(([, es]) => (es.find((e) => e.role === 'origin') ?? es[0]!).connector === 'slack');
      const realRefs = new Set(items.filter((it) => !wrongKeys.has(it.key)).flatMap((it) => it.refs.map((r) => r.ref)));
      const onlyWrong = slackItems.filter(([, es]) => es.some((e) => refToKey.has(e.ref) && wrongKeys.has(refToKey.get(e.ref)!)) && !es.some((e) => realRefs.has(e.ref) && e.role !== 'context')).length;
      const slackFps = fps.filter((f) => f.connector === 'slack');
      const realFp = slackFps.filter((f) => adj.fp[f.originRef] !== 'scanner_right').length + onlyWrong;
      return {
        n: sr.length + right,
        recall: pct(sr.filter((r) => r.matched).length + right, sr.length + right),
        items: slackItems.length,
        precision: pct(slackItems.length - realFp, slackItems.length),
        guessesProposed: onlyWrong,
        pendingFp: slackFps.filter((f) => !adj.fp[f.originRef]).length,
      };
    })(),
    recallBySource: recallBy((r) => r.source),
    recallByKind: recallBy((r) => r.kind),
    precisionByConnector: precBy((r) => r.connector),
    precisionByKind: precBy((r) => r.kind),
    crossSource: { n: cross.length, linked: cross.filter((r) => r.crossLinked).length, accuracy: pct(cross.filter((r) => r.crossLinked).length, cross.length) },
    roles: roleStats,
    misassignedSample: misassigned.slice(0, 20),
  };
  const out = privDir('reports');
  writePriv(path.join(out, `score-${label}.json`), JSON.stringify({ ...report, falseNegatives: rows.filter((r) => !r.matched), falsePositives: fps }, null, 1));
  return report;
}

async function main() {
  const [block, db, label] = process.argv.slice(2);
  const r = await score(block!, db!, label);
  console.log(JSON.stringify(r, null, 1));
}

const invoked = /(^|[\\/])score\.ts$/.test(process.argv[1] ?? '');
if (invoked) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
