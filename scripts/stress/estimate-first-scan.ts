/**
 * B-080 estimate: cost and wall time of an N-day first scan, from measured per-day numbers (private inputs, prints
 * aggregates only).
 *   npx tsx scripts/stress/estimate-first-scan.ts <days[,days…]> <slackScenario…>     e.g. 7,14,30,90
 * Inputs:
 *  - Slack: the given Slack-only accuracy scenarios (ledger cost by pass, pass-log run times and escalations), per
 *    Slack day scanned (block A: 3 days incl. the lookback day; B2: 4), scaled by message volume to the recorded
 *    average day, with the first scan's 24 h channel chunks instead of 6 h;
 *  - other first-scan connectors (Gmail, Gemini notes, Org62, Drive): per-day cost of the STRESS-1 all-source
 *    runs acc-A-after (3 days) and acc-B2-after (4 days), THR-1 loops excluded, reconcile included.
 */
import path from 'node:path';

import { spendEntries } from './lib/ledger';
import { privDir, readJson } from './lib/paths';
import { tsMs, type SlackIndex } from './replay/slack';
import { localDay } from './lib/time';

const DAYS_SCANNED: Record<string, number> = { A: 3, B2: 4 };
const BLOCK_DAYS: Record<string, string[]> = { A: ['2026-10-20', '2026-10-21', '2026-10-22'], B2: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'] };

function main() {
  const [daysArg, ...scenarios] = process.argv.slice(2);
  const choices = String(daysArg ?? '7,14,30,90').split(',').map(Number).filter((n) => n > 0);
  const es = spendEntries();
  const ix = readJson<SlackIndex>(path.join(privDir('recordings'), 'slack', 'index.json'));
  // Inbox-class message volume per local day (Oct 8 – Nov 5 fully recorded).
  const vol: Record<string, number> = {};
  for (const m of Object.values(ix.messages)) {
    if (!m.classes.some((c) => c === 'dm' || c === 'mentions' || c === 'mine')) continue;
    const d = localDay(tsMs(m.ts));
    vol[d] = (vol[d] ?? 0) + 1;
  }
  const recDays = Object.keys(vol).filter((d) => d >= '2026-10-08' && d <= '2026-11-05');
  const avgVol = recDays.reduce((a, d) => a + vol[d]!, 0) / recDays.length;

  const slack = scenarios.map((sc) => {
    const block = /acc-(A|B2)-/.exec(sc)?.[1] ?? 'A';
    const rows = es.filter((e) => e.scenario === sc);
    const by = (k: string) => rows.filter((e) => e.kind === k).reduce((a, e) => a + e.costUsd, 0);
    const channel = rows.filter((e) => e.kind === 'scanner' && /^slack:channel:/.test(e.note ?? '')).reduce((a, e) => a + e.costUsd, 0);
    const passLog = readJson<Array<{ ms?: number; scope: string; passes: Array<{ pass: string; messages?: number; runs: number }> }>>(path.join(privDir('runs', sc.replace(/[^a-z0-9_-]/gi, '_')), 'pass-log.json'), []);
    const ms = passLog.map((p) => p.ms ?? 0).filter((x) => x > 0);
    const escalated = passLog.reduce((a, p) => a + p.passes.filter((x) => x.pass === 'escalate').reduce((b, x) => b + (x.messages ?? 0), 0), 0);
    const triaged = passLog.reduce((a, p) => a + p.passes.filter((x) => x.pass === 'triage').reduce((b, x) => b + (x.messages ?? 0), 0), 0);
    const days = DAYS_SCANNED[block]!;
    const blockVol = BLOCK_DAYS[block]!.reduce((a, d) => a + (vol[d] ?? 0), 0) / days;
    return {
      scenario: sc,
      block,
      days,
      totalUsd: by('scanner') + by('triage') + by('escalation'),
      perDay: { traversal: by('scanner') / days, channelTraversal: channel / days, triage: by('triage') / days, escalation: by('escalation') / days },
      runs: passLog.length,
      avgRunSec: ms.length ? ms.reduce((a, x) => a + x, 0) / ms.length / 1000 : null,
      p90RunSec: ms.length ? [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.9)]! / 1000 : null,
      escalatedPerDay: escalated / days,
      triagedPerDay: triaged / days,
      volumeFactor: blockVol / avgVol,
    };
  });

  // Other connectors (STRESS-1 all-source runs), per day, THR-1 thread loops excluded.
  const other: Record<string, number[]> = {};
  for (const [sc, days] of [['acc-A-after', 3], ['acc-B2-after', 4]] as const) {
    const rows = es.filter((e) => e.scenario === sc);
    for (const c of ['gmail', 'gemini_notes', 'org62', 'drive']) {
      const usd = rows.filter((e) => (e.note ?? '').startsWith(`${c}:`)).reduce((a, e) => a + e.costUsd, 0);
      (other[c] ??= []).push(usd / days);
    }
  }

  // Slack per average day: volume-scaled traversal-on-inbox + triage + escalation; channels at 24 h chunks cost about
  // 1/4 of the runs (6 h chunks) at about 1.5× the per-run cost.
  const perSlackDay = slack.map((s) => {
    const inbox = (s.perDay.traversal - s.perDay.channelTraversal) / s.volumeFactor;
    const ch = s.perDay.channelTraversal * (1.5 / 4);
    return inbox + ch + (s.perDay.triage + s.perDay.escalation) / s.volumeFactor;
  });
  const lo = Math.min(...perSlackDay);
  const hi = Math.max(...perSlackDay);
  const otherLo = Object.values(other).reduce((a, xs) => a + Math.min(...xs), 0);
  const otherHi = Object.values(other).reduce((a, xs) => a + Math.max(...xs), 0);
  // Org62's per-day number includes its 30-day cold-start lookback in those runs: an upper bound per history day.
  const runsPerDay = 12 + 8; // inbox 2 h chunks + 8 channels at 24 h
  const avgSec = slack.map((s) => s.avgRunSec ?? 0).filter((x) => x > 0);
  const sec = avgSec.length ? avgSec.reduce((a, x) => a + x, 0) / avgSec.length : 60;
  const org62PerDay = other.org62 ?? [0];
  const nonOrg = (f: (xs: number[]) => number) => Object.entries(other).filter(([c]) => c !== 'org62').reduce((a, [, xs]) => a + f(xs), 0);
  const perChoice = choices.map((N) => {
    // Org62 never plans less than its own 30-day lookback.
    // Those runs' Org62 spend covered its 30 d cold-start lookback plus the run days: per history day ≈ perDay × 4 / 34.
    const org = (f: (xs: number[]) => number) => f(org62PerDay) * (4 / 34) * Math.max(N, 30);
    const lowUsd = N * (lo + nonOrg((xs) => Math.min(...xs))) + org((xs) => Math.min(...xs));
    const highUsd = N * (hi + nonOrg((xs) => Math.max(...xs))) + org((xs) => Math.max(...xs));
    return { days: N, usd: { lo: Math.round(lowUsd * 100) / 100, hi: Math.round(highUsd * 100) / 100 }, slackRuns: N * runsPerDay, slackWallHours: Math.round(((N * runsPerDay * sec) / 3600) * 10) / 10 };
  });
  const out = {
    avgInboxMessagesPerDay: Math.round(avgVol),
    slack,
    perSlackDayUsd: { lo, hi },
    otherPerDayUsd: { lo: otherLo, hi: otherHi, byConnector: other },
    avgSlackRunSec: sec,
    choices: perChoice,
  };
  console.log(JSON.stringify(out, null, 1));
}

main();
