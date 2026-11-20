/**
 * Scanner report per scope: run counts, failures by code, coverage holes up to each cursor, spend (by budget, purpose,
 * model and skill, with tokens and unattributed calls), triage verdicts and how much of it the trace covers. Then the
 * ledger's Spend & decisions (D0) for the same days: by model, skill, trigger and why-that-model, with cache tokens,
 * hit rate, identical repeats and untokenized dollars, and every decision not to call (or to escalate) by reason. Runs booked
 * whole on one model before SPEND-1 are split by their pass trace rows (the line says how many and how much).
 *
 *   npm run scan:report -- [--since 24h | 90m | 7d | <ISO>] [--json]
 */
import { sql } from 'drizzle-orm';

import { decisionLabel, type SpendAuditPayload, type SpendSlice as AuditSlice } from '../../src/contract/spend-audit';
import { scanReport, type SpendSlice } from '../../src/scanner/trace/queries';
import { loadSpendAudit } from '../../src/server/datasource/db/store/spend-audit';

import { arg, has, main, open, sinceOf, usd } from './lib';

const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** One breakdown line: largest first, `name $x (n calls, in/out tokens)`. */
function slices(m: Record<string, SpendSlice>): string {
  const xs = Object.entries(m).sort((a, b) => b[1].usd - a[1].usd);
  if (!xs.length) return '-';
  return xs.map(([k, v]) => `${k} ${usd(v.usd)} (${v.calls} call${v.calls === 1 ? '' : 's'}${v.inputTokens || v.outputTokens ? `, ${tok(v.inputTokens)} in / ${tok(v.outputTokens)} out` : ''})`).join(' · ');
}

/** D0: one Spend & decisions breakdown line, largest first: `name $x (n calls, in/out, cache r/w, hit %)`. */
function auditLine(xs: AuditSlice[]): string {
  if (!xs.length) return '-';
  return xs.map((v) => `${v.key} ${usd(v.usd)} (${v.calls} call${v.calls === 1 ? '' : 's'}, ${tok(v.inputTokens)} in / ${tok(v.outputTokens)} out, cache ${tok(v.cacheReadTokens)} r / ${tok(v.cacheWriteTokens)} w${v.cacheHitPct == null ? '' : `, hit ${Math.round(v.cacheHitPct)}%`})`).join(' · ');
}

function printAudit(a: SpendAuditPayload) {
  const t = a.totals;
  console.log(`  ledger ${a.from} → ${a.to} (${a.timezone}): ${usd(t.usd)} in ${t.calls} call(s) · cache hit ${t.cacheHitPct == null ? '-' : `${Math.round(t.cacheHitPct)}%`} · identical repeats ${t.repeatCalls} (${usd(t.repeatUsd)}) · without tokens ${t.untokenizedCalls} (${usd(t.untokenizedUsd)}) · before D0 fields ${t.unattributedCalls}`);
  console.log(`    by model    ${auditLine(a.byModel)}`);
  console.log(`    by skill    ${auditLine(a.bySkill)}`);
  console.log(`    by trigger  ${auditLine(a.byTrigger)}`);
  const why = new Map<string, number>();
  for (const r of a.rows) why.set(`${r.skill}:${r.modelReason ?? 'unrecorded'}`, (why.get(`${r.skill}:${r.modelReason ?? 'unrecorded'}`) ?? 0) + r.usd);
  console.log(`    why model   ${[...why].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${k} ${usd(v)}`).join(' · ') || '-'}`);
  const dt = a.decisionTotals;
  console.log(`  decisions: ${dt.skips} skipped, ${dt.blocks} held by a budget, ${dt.escalations} escalated · about ${usd(dt.estSavedUsd)} not spent`);
  const g = new Map<string, { n: number; saved: number; usd: number }>();
  for (const d of a.decisions) {
    const k = `${d.skill} · ${d.kind} · ${d.reason}`;
    const x = g.get(k) ?? { n: 0, saved: 0, usd: 0 };
    x.n += d.count;
    x.saved += d.estSavedUsd;
    x.usd += d.usd;
    g.set(k, x);
  }
  for (const [k, x] of [...g].sort((p, q) => q[1].n - p[1].n)) console.log(`    ${k} ×${x.n}${x.saved ? ` (≈${usd(x.saved)} saved)` : ''}${x.usd ? ` (${usd(x.usd)} extra)` : ''}  ${decisionLabel(k.split(' · ')[2]!)}`);
  const se = a.settleEscalation;
  if (se.escalated) console.log(`  settle escalation: changed ${se.changed} of ${se.escalated} verdicts (${se.changedPct ?? 0}%), same ${se.same}, no usable answer ${se.invalid}, ${usd(se.extraUsd)} extra`);
}

void main(async (argv) => {
  const since = sinceOf(arg(argv, '--since'));
  const { handle, db, userId, dbName } = await open();
  try {
    const r = await scanReport(db, userId, since);
    // D0: the ledger's Spend & decisions for the same days (whole local days from --since to today).
    const tz = (await db.execute<{ tz: string | null }>(sql`select timezone as tz from users where id = ${userId}`)).rows[0]?.tz ?? 'UTC';
    const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const audit = await loadSpendAudit(db, userId, { from: day(new Date(r.since)), to: day(new Date()) }, { now: new Date(), timezone: tz });
    if (has(argv, '--json')) {
      console.log(JSON.stringify({ ...r, audit }, null, 2));
      return 0;
    }
    console.log(`scan report · ${dbName} · ${r.since} → ${r.until}`);
    console.log(`  ${'scope'.padEnd(34)} ${'runs'.padStart(4)} ${'ok'.padStart(4)} ${'fail'.padStart(4)} ${'canc'.padStart(4)} ${'cost'.padStart(9)}  holes · failures`);
    for (const s of r.scopes) {
      const holeMin = s.holes.reduce((a, h) => a + h.minutes, 0);
      const holes = s.holes.length ? `${s.holes.length} hole(s) ${holeMin} min` : 'no holes';
      const fails = Object.entries(s.failures).map(([k, n]) => `${k}×${n}`).join(' ');
      console.log(`  ${s.scope.padEnd(34).slice(0, 34)} ${String(s.runs).padStart(4)} ${String(s.ok).padStart(4)} ${String(s.failed).padStart(4)} ${String(s.cancelled).padStart(4)} ${usd(s.costUsd).padStart(9)}  ${holes}${fails ? ` · ${fails}` : ''}${s.cursorAt ? ` · cursor ${s.cursorAt.slice(0, 16)}` : ''}`);
      for (const h of s.holes.slice(0, 3)) console.log(`      hole ${h.from} → ${h.to} (${h.minutes} min)`);
    }
    const sp = r.spend;
    console.log(`  spend ${usd(sp.totalUsd)} in ${sp.calls} call(s) · by budget ${Object.entries(sp.byBudget).map(([k, v]) => `${k} ${usd(v)}`).join(', ') || '-'} · by purpose ${Object.entries(sp.byPurpose).map(([k, v]) => `${k} ${usd(v)}`).join(', ') || '-'} · unattributed ${sp.unattributed}`);
    console.log(`  by model  ${slices(sp.byModel)}`);
    console.log(`  by skill  ${slices(sp.bySkill)}`);
    if (sp.fromTrace.runs) console.log(`  (${sp.fromTrace.runs} run(s) booked whole on one model before SPEND-1, ${usd(sp.fromTrace.usd)}, split by their pass trace rows)`);
    const t = r.triage;
    console.log(`  triage ${t.messages} verdict(s): act ${t.act} · noise ${t.noise} · unsure ${t.unsure} · missing ${t.missing} · escalated ${t.escalated}`);
    console.log(`  trace ${r.trace.events} event(s) over ${r.trace.runs} run(s)`);
    printAudit(audit);
    return 0;
  } finally {
    await handle.close();
  }
});
