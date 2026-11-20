/**
 * Spend & decisions (D0): grouped ledger rows → the payload the view, the CSV export and `scan:report` show. Pure, so
 * the Postgres reader (./db.ts) and the mock (./mock.ts) agree to the cent.
 */
import { SPEND_AUDIT_MAX_DAYS, SPEND_AUDIT_RETENTION, type DecisionRow, type SpendAuditPayload, type SpendAuditRow, type SpendSlice } from '@/contract/spend-audit';

const DAY = 86_400_000;
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

function localDay(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The period a query asks for: `to` defaults to today (local), `from` to 6 days before it, at most SPEND_AUDIT_MAX_DAYS long. */
export function auditPeriod(q: { from?: string; to?: string }, now: Date, timezone: string): { from: string; to: string } {
  const to = q.to ?? localDay(now, timezone);
  let from = q.from ?? shift(to, -6);
  if (from > to) from = to;
  if (Date.parse(to) - Date.parse(from) > (SPEND_AUDIT_MAX_DAYS - 1) * DAY) from = shift(to, -(SPEND_AUDIT_MAX_DAYS - 1));
  return { from, to };
}

export interface DecisionGroup {
  day: string;
  skill: string;
  kind: DecisionRow['kind'];
  reason: string;
  trigger: string;
  count: number;
  usd: number;
}

export interface AuditInput {
  from: string;
  to: string;
  timezone: string;
  rows: SpendAuditRow[];
  decisions: DecisionGroup[];
  repeats: { calls: number; usd: number };
  simulated?: boolean;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Cache reads over every prompt token (uncached + cache read + cache write); null with no prompt tokens. */
export function cacheHitPct(t: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number | null {
  const prompt = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
  return prompt > 0 ? r1((t.cacheReadTokens / prompt) * 100) : null;
}

function slices(rows: SpendAuditRow[], key: (r: SpendAuditRow) => string, order: 'usd' | 'key' = 'usd'): SpendSlice[] {
  const m = new Map<string, SpendSlice>();
  for (const r of rows) {
    const k = key(r);
    const s = m.get(k) ?? { key: k, usd: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitPct: null };
    s.usd += r.usd;
    s.calls += r.calls;
    s.inputTokens += r.inputTokens;
    s.outputTokens += r.outputTokens;
    s.cacheReadTokens += r.cacheReadTokens;
    s.cacheWriteTokens += r.cacheWriteTokens;
    m.set(k, s);
  }
  const out = [...m.values()].map((s) => ({ ...s, usd: r6(s.usd), cacheHitPct: cacheHitPct(s) }));
  return order === 'key' ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key));
}

/** Every local day from `from` to `to`, inclusive (YYYY-MM-DD). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function buildSpendAudit(i: AuditInput): SpendAuditPayload {
  const rows = [...i.rows].sort((a, b) => a.day.localeCompare(b.day) || b.usd - a.usd || a.skill.localeCompare(b.skill));
  const total = slices(rows, () => 'all')[0];
  const byDayRaw = new Map(slices(rows, (r) => r.day, 'key').map((s) => [s.key, s]));
  const byDay = daysBetween(i.from, i.to).map((d) => byDayRaw.get(d) ?? { key: d, usd: 0, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitPct: null });
  const bySkill = slices(rows, (r) => r.skill);
  // A skill's average call cost in the period: what a skipped or held call of it would have cost (an estimate).
  const avg = new Map(bySkill.map((s) => [s.key, s.calls ? s.usd / s.calls : 0]));
  const avgFor = (skill: string) => avg.get(skill) ?? avg.get(skill.replace(/^triage-/, 'scan-')) ?? 0;
  const decisions: DecisionRow[] = i.decisions
    .map((d) => ({ ...d, usd: r6(d.usd), estSavedUsd: d.kind === 'escalate' ? 0 : r6(d.count * avgFor(d.skill)) }))
    .sort((a, b) => a.day.localeCompare(b.day) || b.count - a.count || a.skill.localeCompare(b.skill) || a.reason.localeCompare(b.reason));
  const sum = (kind: DecisionRow['kind']) => decisions.filter((d) => d.kind === kind).reduce((a, d) => a + d.count, 0);
  const settle = decisions.filter((d) => d.skill === 'settle-item' && d.kind === 'escalate');
  const n = (reason: string) => settle.filter((d) => d.reason === reason).reduce((a, d) => a + d.count, 0);
  const escalated = settle.reduce((a, d) => a + d.count, 0);
  const changed = n('verdict_changed');
  const untok = rows.reduce((a, r) => a + r.untokenizedUsd, 0);
  return {
    from: i.from,
    to: i.to,
    timezone: i.timezone,
    totals: {
      usd: r6(total?.usd ?? 0),
      calls: total?.calls ?? 0,
      inputTokens: total?.inputTokens ?? 0,
      outputTokens: total?.outputTokens ?? 0,
      cacheReadTokens: total?.cacheReadTokens ?? 0,
      cacheWriteTokens: total?.cacheWriteTokens ?? 0,
      cacheHitPct: total ? cacheHitPct(total) : null,
      untokenizedCalls: rows.filter((r) => r.untokenizedUsd > 0).reduce((a, r) => a + (r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens === 0 ? r.calls : 0), 0),
      untokenizedUsd: r6(untok),
      repeatCalls: i.repeats.calls,
      repeatUsd: r6(i.repeats.usd),
      unattributedCalls: rows.filter((r) => r.trigger == null || r.modelReason == null).reduce((a, r) => a + r.calls, 0),
    },
    byDay,
    bySkill,
    byModel: slices(rows, (r) => r.model),
    byTrigger: slices(rows, (r) => r.trigger ?? 'unrecorded'),
    rows,
    decisions,
    decisionTotals: { skips: sum('skip'), blocks: sum('block'), escalations: sum('escalate'), estSavedUsd: r6(decisions.reduce((a, d) => a + d.estSavedUsd, 0)) },
    settleEscalation: { escalated, changed, same: n('verdict_same'), invalid: n('stronger_invalid'), changedPct: escalated ? r1((changed / escalated) * 100) : null, extraUsd: r6(settle.reduce((a, d) => a + d.usd, 0)) },
    retention: { ...SPEND_AUDIT_RETENTION },
    simulated: !!i.simulated,
  };
}

/** The CSV of a period: one line per call group (`spend`) and per decision group (`decision`). */
export function spendAuditCsv(p: SpendAuditPayload): string {
  const head = ['record', 'day', 'skill', 'model', 'trigger', 'why_model', 'budget', 'kind', 'reason', 'calls_or_count', 'usd', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cache_hit_pct', 'est_saved_usd'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.join(',')];
  for (const r of p.rows) lines.push([ 'spend', r.day, r.skill, r.model, r.trigger ?? '', r.modelReason ?? '', r.budget, '', '', r.calls, r.usd.toFixed(6), r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens, cacheHitPct(r) ?? '', '' ].map(esc).join(','));
  for (const d of p.decisions) lines.push([ 'decision', d.day, d.skill, '', d.trigger, '', '', d.kind, d.reason, d.count, d.usd.toFixed(6), '', '', '', '', '', d.estSavedUsd.toFixed(6) ].map(esc).join(','));
  return lines.join('\n') + '\n';
}
