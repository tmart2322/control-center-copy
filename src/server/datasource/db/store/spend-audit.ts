/**
 * Spend & decisions on Postgres (D0): reads `llm_calls` and `llm_decisions` (SELECT only) for Health ▸ Spend ▸ Spend &
 * decisions, its CSV export and `npm run scan:report`. Ids, codes, counts and hashes only; no prompt or message text.
 */
import { sql } from 'drizzle-orm';

import type { SpendAuditDetail, SpendAuditPayload } from '@/contract/spend-audit';
import type { DbOrTx } from '@/db/client';
import { auditPeriod, buildSpendAudit, type DecisionGroup } from '@/engines/spend-audit/aggregate';

/** Chat rows (lane A) carry no trigger: a chat call is always the user's own message. */
const TRIGGER = sql`coalesce(c.trigger, case when c.purpose::text = 'chat' then 'user_action' end)`;
const SKILL = sql`coalesce(c.skill_key, c.purpose::text)`;

export async function loadSpendAudit(db: DbOrTx, userId: string, q: { from?: string; to?: string }, o: { now: Date; timezone: string }): Promise<SpendAuditPayload> {
  const { from, to } = auditPeriod(q, o.now, o.timezone);
  const rows = await db.execute<{
    day: string; skill: string; model: string; trigger: string | null; model_reason: string | null; budget: string;
    calls: number; usd: number; inp: number; outp: number; cr: number; cw: number; untok: number;
  }>(sql`
    select c.budget_day::text as day, ${SKILL} as skill, c.model, ${TRIGGER} as trigger, c.model_reason, c.budget,
           count(*)::int as calls, coalesce(sum(c.cost_usd), 0)::float8 as usd,
           coalesce(sum(c.input_tokens), 0)::float8 as inp, coalesce(sum(c.output_tokens), 0)::float8 as outp,
           coalesce(sum(c.cache_read_tokens), 0)::float8 as cr, coalesce(sum(c.cache_write_tokens), 0)::float8 as cw,
           coalesce(sum(c.cost_usd) filter (where c.input_tokens + c.output_tokens + c.cache_read_tokens + c.cache_write_tokens = 0), 0)::float8 as untok
      from llm_calls c
     where c.owner_user_id = ${userId} and c.budget_day between ${from}::date and ${to}::date
     group by 1, 2, 3, 4, 5, 6`);
  const dec = await db.execute<{ day: string; skill: string; kind: DecisionGroup['kind']; reason: string; trigger: string; count: number; usd: number }>(sql`
    select d.day::text as day, d.skill_key as skill, d.kind, d.reason, d.trigger, sum(d.count)::int as count, coalesce(sum(d.usd), 0)::float8 as usd
      from llm_decisions d
     where d.owner_user_id = ${userId} and d.day between ${from}::date and ${to}::date
     group by 1, 2, 3, 4, 5`);
  // Identical repeats: every call after the first with the same content hash in the period.
  const rep = await db.execute<{ calls: number; usd: number }>(sql`
    select count(*)::int as calls, coalesce(sum(cost_usd), 0)::float8 as usd from (
      select c.cost_usd, row_number() over (partition by c.content_hash order by c.started_at, c.id) as n
        from llm_calls c
       where c.owner_user_id = ${userId} and c.budget_day between ${from}::date and ${to}::date and c.content_hash is not null) x
     where n > 1`);
  return buildSpendAudit({
    from,
    to,
    timezone: o.timezone,
    rows: rows.rows.map((r) => ({
      day: r.day,
      skill: r.skill,
      model: r.model,
      trigger: r.trigger,
      modelReason: r.model_reason,
      budget: r.budget === 'first_scan' ? 'first_scan' : 'daily',
      usd: Number(r.usd),
      calls: Number(r.calls),
      inputTokens: Number(r.inp),
      outputTokens: Number(r.outp),
      cacheReadTokens: Number(r.cr),
      cacheWriteTokens: Number(r.cw),
      untokenizedUsd: Number(r.untok),
    })),
    decisions: dec.rows.map((d) => ({ ...d, count: Number(d.count), usd: Number(d.usd) })),
    repeats: { calls: Number(rep.rows[0]?.calls ?? 0), usd: Number(rep.rows[0]?.usd ?? 0) },
  });
}

export async function loadSpendAuditDetail(db: DbOrTx, userId: string, q: { day: string; skill?: string; offset: number; limit: number }): Promise<SpendAuditDetail> {
  const skill = q.skill ?? null;
  const calls = await db.execute<{
    id: string; at: string; skill: string; purpose: string; model: string; trigger: string | null; model_reason: string | null; status: string; outcome: string | null;
    budget: string; usd: number; inp: number; outp: number; cr: number; cw: number; content_hash: string | null; repeat_of: string | null; job_id: string | null; scan_run_id: string | null;
  }>(sql`
    select c.id::text as id, c.started_at as at, ${SKILL} as skill, c.purpose::text as purpose, c.model, ${TRIGGER} as trigger, c.model_reason,
           c.status::text as status, c.outcome, c.budget, c.cost_usd::float8 as usd, c.input_tokens as inp, c.output_tokens as outp,
           c.cache_read_tokens as cr, c.cache_write_tokens as cw, c.content_hash, c.job_id::text as job_id, c.scan_run_id::text as scan_run_id,
           (select min(p.id)::text from llm_calls p where p.owner_user_id = c.owner_user_id and p.content_hash = c.content_hash
               and (p.started_at, p.id) < (c.started_at, c.id)) as repeat_of
      from llm_calls c
     where c.owner_user_id = ${userId} and c.budget_day = ${q.day}::date and (${skill}::text is null or ${SKILL} = ${skill}::text)
     order by c.started_at desc, c.id desc
     offset ${q.offset} limit ${q.limit}`);
  const total = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from llm_calls c
     where c.owner_user_id = ${userId} and c.budget_day = ${q.day}::date and (${skill}::text is null or ${SKILL} = ${skill}::text)`);
  // Decision rows are already one per (skill, kind, reason, trigger, subject) and day: all of them, no page needed.
  const dec = await db.execute<{ id: string; first_at: string; last_at: string; skill: string; kind: SpendAuditDetail['decisions'][number]['kind']; reason: string; trigger: string; subject: string; count: number; usd: number; detail: Record<string, unknown> }>(sql`
    select d.id::text as id, d.first_at, d.last_at, d.skill_key as skill, d.kind, d.reason, d.trigger, d.subject, d.count, d.usd::float8 as usd, d.detail
      from llm_decisions d
     where d.owner_user_id = ${userId} and d.day = ${q.day}::date and (${skill}::text is null or d.skill_key = ${skill}::text
            or (${skill}::text like 'scan-%' and d.skill_key = replace(${skill}::text, 'scan-', 'triage-')))
     order by d.last_at desc, d.id desc`);
  const iso = (v: string | Date) => new Date(v).toISOString();
  return {
    day: q.day,
    skill,
    calls: calls.rows.map((c) => ({
      id: c.id,
      at: iso(c.at),
      skill: c.skill,
      purpose: c.purpose,
      model: c.model,
      trigger: c.trigger,
      modelReason: c.model_reason,
      status: c.status,
      outcome: c.outcome,
      budget: c.budget === 'first_scan' ? 'first_scan' : 'daily',
      usd: Number(c.usd),
      inputTokens: Number(c.inp),
      outputTokens: Number(c.outp),
      cacheReadTokens: Number(c.cr),
      cacheWriteTokens: Number(c.cw),
      contentHash: c.content_hash,
      repeatOf: c.repeat_of,
      jobId: c.job_id,
      scanRunId: c.scan_run_id,
    })),
    totalCalls: Number(total.rows[0]?.n ?? 0),
    offset: q.offset,
    limit: q.limit,
    decisions: dec.rows.map((d) => ({ id: d.id, firstAt: iso(d.first_at), lastAt: iso(d.last_at), skill: d.skill, kind: d.kind, reason: d.reason, trigger: d.trigger, subject: d.subject, count: Number(d.count), usd: Number(d.usd), detail: d.detail ?? {} })),
    simulated: false,
  };
}
