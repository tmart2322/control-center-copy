/**
 * Spend & decisions in mock mode (D0 parity): placeholder call groups and decisions made from the seed's spend summary
 * (its 7 days, split by its "by scanner" shares). Deterministic, no names, nothing called; `simulated: true`.
 */
import type { SpendAuditDetail, SpendAuditPayload, SpendAuditRow, SpendSummary } from '@/contract';
import { auditPeriod, buildSpendAudit, daysBetween, type DecisionGroup } from '@/engines/spend-audit/aggregate';

/** Health's spend line → the skill, model, trigger and model reason the mock books it as. */
const LINE: Record<string, { skill: string; model: string; trigger: string; modelReason: string; perCallUsd: number }> = {
  slack: { skill: 'scan-slack', model: 'claude-haiku-5-5', trigger: 'schedule', modelReason: 'default', perCallUsd: 0.009 },
  org62: { skill: 'scan-org62', model: 'claude-haiku-5-5', trigger: 'schedule', modelReason: 'default', perCallUsd: 0.01 },
  briefs: { skill: 'brief-channel', model: 'claude-haiku-5-5', trigger: 'schedule', modelReason: 'default', perCallUsd: 0.02 },
  nba: { skill: 'nba-reply', model: 'claude-sonnet-5-5', trigger: 'new_evidence', modelReason: 'default', perCallUsd: 0.04 },
  chat: { skill: 'chat-assistant', model: 'claude-sonnet-5-5', trigger: 'user_action', modelReason: 'default', perCallUsd: 0.09 },
};
const FALLBACK = { model: 'claude-haiku-5-5', trigger: 'schedule', modelReason: 'default', perCallUsd: 0.01 };
/** Lines the seed's Health spend has no row for, carved out of each day (the day's total stays the seed's). */
const EXTRA: Array<{ share: number; skill: string; model: string; trigger: string; modelReason: string; perCallUsd: number }> = [
  { share: 0.1, skill: 'scan-claude-sessions', model: 'claude-haiku-5-5', trigger: 'file_watch', modelReason: 'default', perCallUsd: 0.009 },
  { share: 0.08, skill: 'readin-ask', model: 'claude-haiku-5-5', trigger: 'direct_ask', modelReason: 'policy:direct_ask', perCallUsd: 0.004 },
];
/** List prices per million tokens (src/llm/models.ts) for turning a placeholder dollar figure into tokens. */
const PRICE: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

/** Tokens that cost about `usd` with a 70% cache hit rate and 1 output token per 12 prompt tokens. */
function tokensFor(model: string, usd: number) {
  const p = PRICE[model] ?? PRICE['claude-haiku-5-5']!;
  // per prompt token: 0.25 uncached + 0.7 cache read + 0.05 cache write, plus 1/12 output
  const perPrompt = (0.25 * p.input + 0.7 * p.cacheRead + 0.05 * p.cacheWrite + p.output / 12) / 1e6;
  const prompt = Math.round(usd / perPrompt);
  return { inputTokens: Math.round(prompt * 0.25), cacheReadTokens: Math.round(prompt * 0.7), cacheWriteTokens: Math.round(prompt * 0.05), outputTokens: Math.round(prompt / 12) };
}

function rowsFor(spend: SpendSummary, days: Set<string>): SpendAuditRow[] {
  const lines = spend.byScanner.filter((l) => l.usd > 0);
  const total = lines.reduce((a, l) => a + l.usd, 0);
  const out: SpendAuditRow[] = [];
  const rest = 1 - EXTRA.reduce((a, e) => a + e.share, 0);
  for (const d of spend.last7d) {
    if (!days.has(d.day) || !(d.usd > 0) || !(total > 0)) continue;
    for (const e of EXTRA) {
      const usd = Math.round(d.usd * e.share * 1e6) / 1e6;
      out.push({ day: d.day, skill: e.skill, model: e.model, trigger: e.trigger, modelReason: e.modelReason, budget: 'daily', usd, calls: Math.max(1, Math.round(usd / e.perCallUsd)), ...tokensFor(e.model, usd), untokenizedUsd: 0 });
    }
    for (const l of lines) {
      const m = LINE[l.name] ?? { skill: `scan-${l.name}`, ...FALLBACK };
      const usd = Math.round(((d.usd * rest * l.usd) / total) * 1e6) / 1e6;
      if (!(usd > 0)) continue;
      out.push({ day: d.day, skill: m.skill, model: m.model, trigger: m.trigger, modelReason: m.modelReason, budget: 'daily', usd, calls: Math.max(1, Math.round(usd / m.perCallUsd)), ...tokensFor(m.model, usd), untokenizedUsd: 0 });
    }
  }
  return out;
}

function decisionsFor(rows: SpendAuditRow[]): DecisionGroup[] {
  const out: DecisionGroup[] = [];
  for (const day of [...new Set(rows.map((r) => r.day))]) {
    const calls = rows.filter((r) => r.day === day).reduce((a, r) => a + r.calls, 0);
    out.push(
      { day, skill: 'scan-claude-sessions', kind: 'skip', reason: 'status_only', trigger: 'file_watch', count: Math.max(1, Math.round(calls / 6)), usd: 0 },
      { day, skill: 'scan-slack', kind: 'skip', reason: 'precheck_empty', trigger: 'schedule', count: Math.max(1, Math.round(calls / 8)), usd: 0 },
      { day, skill: 'readin-ask', kind: 'skip', reason: 'evidence_unchanged', trigger: 'top_rank', count: 2, usd: 0 },
      { day, skill: 'settle-item', kind: 'escalate', reason: 'verdict_same', trigger: 'interval', count: 3, usd: 0.03 },
      { day, skill: 'settle-item', kind: 'escalate', reason: 'verdict_changed', trigger: 'interval', count: 1, usd: 0.01 },
    );
  }
  return out;
}

export function mockSpendAudit(spend: SpendSummary, q: { from?: string; to?: string }, o: { now: Date; timezone: string }): SpendAuditPayload {
  const { from, to } = auditPeriod(q, o.now, o.timezone);
  const rows = rowsFor(spend, new Set(daysBetween(from, to)));
  const repeatCalls = Math.round(rows.reduce((a, r) => a + r.calls, 0) * 0.02);
  return buildSpendAudit({ from, to, timezone: o.timezone, rows, decisions: decisionsFor(rows), repeats: { calls: repeatCalls, usd: Math.round(repeatCalls * 0.006 * 1e6) / 1e6 }, simulated: true });
}

export function mockSpendAuditDetail(spend: SpendSummary, q: { day: string; skill?: string; offset: number; limit: number }): SpendAuditDetail {
  const rows = rowsFor(spend, new Set([q.day])).filter((r) => !q.skill || r.skill === q.skill);
  const calls: SpendAuditDetail['calls'] = [];
  let n = 0;
  for (const r of rows) {
    for (let i = 0; i < r.calls; i++) {
      n += 1;
      const at = new Date(Date.parse(`${q.day}T15:00:00Z`) + n * 7 * 60_000).toISOString();
      const share = 1 / r.calls;
      calls.push({
        id: `mock-${q.day}-${n}`,
        at,
        skill: r.skill,
        purpose: r.skill.startsWith('scan-') ? 'scan_extract' : r.skill === 'chat-assistant' ? 'chat' : 'summarize',
        model: r.model,
        trigger: r.trigger,
        modelReason: r.modelReason,
        status: 'ok',
        outcome: r.skill.startsWith('scan-') ? (n % 3 ? 'nothing_new' : 'new:1,changed:0,linked:1,proposed:0') : 'ok',
        budget: 'daily',
        usd: Math.round(r.usd * share * 1e6) / 1e6,
        inputTokens: Math.round(r.inputTokens * share),
        outputTokens: Math.round(r.outputTokens * share),
        cacheReadTokens: Math.round(r.cacheReadTokens * share),
        cacheWriteTokens: Math.round(r.cacheWriteTokens * share),
        contentHash: `mockhash${String(n).padStart(4, '0')}`,
        repeatOf: n % 40 === 0 ? `mock-${q.day}-${n - 1}` : null,
        jobId: null,
        scanRunId: null,
      });
    }
  }
  calls.sort((a, b) => b.at.localeCompare(a.at));
  const decisions = decisionsFor(rows.length ? rows : [])
    .filter((d) => d.day === q.day && (!q.skill || d.skill === q.skill))
    .map((d, i) => ({ id: `mock-d-${q.day}-${i}`, firstAt: `${q.day}T15:00:00.000Z`, lastAt: `${q.day}T23:00:00.000Z`, skill: d.skill, kind: d.kind, reason: d.reason, trigger: d.trigger, subject: `placeholder:${i + 1}`, count: d.count, usd: d.usd, detail: {} }));
  return { day: q.day, skill: q.skill ?? null, calls: calls.slice(q.offset, q.offset + q.limit), totalCalls: calls.length, offset: q.offset, limit: q.limit, decisions, simulated: true };
}
