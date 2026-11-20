/**
 * The LLM ledger's write side (D0, audit 2026-11-13): one place that books a model call, records a decision not to
 * call (or to escalate), and holds a call's maximum cost against the daily hard cap while it runs.
 *
 *   insertLlmCall(db, row)                     one llm_calls row with every audit field (trigger, why this model,
 *                                              cache tokens, content hash, outcome) + the daily roll-up
 *   recordDecision(db, userId, d)              one llm_decisions row per (day, skill, kind, reason, trigger, subject),
 *                                              counted; never throws (a decision row never fails the work)
 *   reserveBudget(db, userId, {day, usd, hard}) D6: hold `usd` in llm_budget_days.reserved_usd when spent + held + usd
 *                                              stays under the hard cap (one conditional UPDATE, so parallel jobs
 *                                              can't both pass a check-then-spend); release() after the spend is booked
 *
 * Privacy (tenet: Local data, privacy-safe logs): ids, codes, counts and hashes only. `contentHash` hashes the prompt
 * and its input; the prompt itself is never stored.
 */
import { createHash, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { DbOrTx } from './client';

export type ModelTier = 'none' | 'haiku' | 'sonnet' | 'opus';

export function tierOf(model: string | null | undefined): ModelTier {
  const m = (model ?? '').toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  return 'none';
}

/** sha256 of the parts (first 32 hex chars): what makes two calls "the same call". */
export function ledgerHash(...parts: Array<string | number | boolean | null | undefined>): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(`${p ?? ''}\u0000`);
  return h.digest('hex').slice(0, 32);
}

/** The audit fields every booked call carries (D0). */
export interface CallAudit {
  /** What started it: `schedule`, `file_watch`, `manual`, `direct_ask`, `interval`, `user_action` … */
  trigger?: string | null;
  /** Why this model: `default`, `user_asked`, `policy:<trigger>`, `escalation:<why>`, `override`. */
  modelReason?: string | null;
  /** ledgerHash of model + prompt version + prompt + input. */
  contentHash?: string | null;
  /** A short code for what came of it (`items:2`, `verdict:done`, `ready`). */
  outcome?: string | null;
}

/**
 * Every booked call carries all four audit fields (D0). Required by type, so a writer that leaves one out does not
 * compile; `ledgerGaps` catches what types can't (an empty string, a cost booked with no tokens).
 */
export interface RequiredAudit {
  trigger: string;
  modelReason: string;
  outcome: string;
  contentHash: string;
}

export interface LlmCallRow extends RequiredAudit {
  ownerUserId: string;
  purpose: string;
  model: string;
  skillKey: string | null;
  promptVersion?: string | null;
  /** Unique per call by default (`<skill>:<job|run>:<uuid>`); a caller that books idempotently passes its own. */
  requestHash?: string;
  jobId?: number | null;
  scanRunId?: string | null;
  /** The chat message the call was for (kept only when that message exists). */
  chatMessageId?: string | null;
  status: 'ok' | 'error' | 'refused' | 'timeout' | 'budget_blocked';
  errorCode?: string | null;
  /** Uncached input tokens only; cache reads and writes go in their own columns. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd: number;
  costEstimated?: boolean;
  latencyMs?: number | null;
  budgetDay: string;
  budget?: 'daily' | 'first_scan';
  startedAt?: Date;
  finishedAt?: Date;
  /** Add the cost to the daily roll-up (llm_budget_days) when the budget is daily. Default true. */
  rollup?: boolean;
}

const int = (n: number | undefined | null) => Math.max(0, Math.round(Number.isFinite(n as number) ? (n as number) : 0));
const money = (n: number) => Math.max(0, Number.isFinite(n) ? n : 0);

/** Book one call. Returns its id (null when the row could not be written: the caller's work never fails on it). */
export async function insertLlmCall(db: DbOrTx, r: LlmCallRow): Promise<number | null> {
  noteLedgerGaps(`insertLlmCall:${r.skillKey ?? r.purpose}`, r);
  const started = r.startedAt ?? new Date();
  const finished = r.finishedAt ?? new Date();
  const budget = r.budget ?? 'daily';
  const cost = money(r.costUsd);
  const res = await db.execute<{ id: string }>(sql`
    insert into llm_calls (owner_user_id, purpose, model, model_tier, skill_key, prompt_version, request_hash, job_id, scan_run_id, chat_message_id, status, error_code,
                           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cost_estimated, latency_ms,
                           budget_day, budget, started_at, finished_at, trigger, model_reason, content_hash, outcome)
    values (${r.ownerUserId}, ${r.purpose}, ${r.model}, ${tierOf(r.model)}, ${r.skillKey}, ${r.promptVersion ?? null},
            ${r.requestHash ?? `${r.skillKey ?? r.purpose}:${r.jobId ?? r.scanRunId ?? 'none'}:${randomUUID()}`},
            ${r.jobId ?? null}, ${r.scanRunId ?? null}::uuid, (select m.id from chat_messages m where m.id = ${r.chatMessageId ?? null}::uuid), ${r.status}, ${r.errorCode ?? null},
            ${int(r.inputTokens)}, ${int(r.outputTokens)}, ${int(r.cacheReadTokens)}, ${int(r.cacheWriteTokens)}, ${cost}, ${!!r.costEstimated},
            ${r.latencyMs ?? Math.max(0, finished.getTime() - started.getTime())}, ${r.budgetDay}::date, ${budget},
            ${started.toISOString()}::timestamptz, ${finished.toISOString()}::timestamptz,
            ${clip(r.trigger)}, ${clip(r.modelReason)}, ${r.contentHash ?? null}, ${clip(r.outcome)})
    returning id`);
  if (budget === 'daily' && cost > 0 && r.rollup !== false) {
    await db.execute(sql`
      insert into llm_budget_days (budget_id, day, spent_usd, call_count)
      select b.id, ${r.budgetDay}::date, ${cost}, 1 from llm_budgets b where b.owner_user_id = ${r.ownerUserId} and b.scope = 'total'
      on conflict (budget_id, day) do update set spent_usd = llm_budget_days.spent_usd + excluded.spent_usd,
                                                 call_count = llm_budget_days.call_count + 1, updated_at = now()`);
  }
  const id = res.rows[0]?.id;
  return id == null ? null : Number(id);
}

const clip = (s: string | null | undefined, n = 80) => (s == null ? null : String(s).slice(0, n));

// ---------------------------------------------------------------------------------------------
// Gaps (D0 guard)
// ---------------------------------------------------------------------------------------------

/**
 * What a booked call is missing: an audit field (trigger, model reason, outcome, content hash), or tokens on a call
 * that cost money. Empty when the row is complete.
 */
export function ledgerGaps(r: Partial<CallAudit> & { costUsd: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }): string[] {
  const out: string[] = [];
  for (const k of ['trigger', 'modelReason', 'outcome', 'contentHash'] as const) if (!r[k]) out.push(`no ${k}`);
  const tokens = (r.inputTokens ?? 0) + (r.outputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0);
  if (r.costUsd > 0 && !(tokens > 0)) out.push('cost without tokens');
  return out;
}

const GAPS: string[] = [];

/** Record a booked row's gaps (the row is still written: a gap must never lose a dollar). */
export function noteLedgerGaps(where: string, r: Parameters<typeof ledgerGaps>[0]): void {
  const g = ledgerGaps(r);
  if (!g.length) return;
  GAPS.push(`${where}: ${g.join(', ')}`);
  if (GAPS.length > 200) GAPS.splice(0, GAPS.length - 200);
}

/** The gaps noted since the last call (tests fail on any: tests/setup/ledger-gaps.ts). */
export function takeLedgerGaps(): string[] {
  return GAPS.splice(0, GAPS.length);
}

// ---------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------

export type DecisionKind = 'skip' | 'escalate' | 'block';

export interface Decision {
  /** The skill that would have run (`readin-ask`, `scan-claude-sessions`, `settle-item`, `scan-slack`, `triage-slack` …). */
  skill: string;
  kind: DecisionKind;
  /** A code from DECISION_REASONS (src/contract/spend-audit.ts) for the UI's plain words. */
  reason: string;
  trigger?: string | null;
  /** An id: a work item, a Claude session, a scan scope. Never content. */
  subject?: string | null;
  /** skip / block: the estimated cost not spent; escalate: what the extra call cost. */
  usd?: number;
  llmCallId?: number | null;
  /** ids, counts and codes only. */
  detail?: Record<string, unknown>;
  day: string;
  at?: Date;
  /** How many decisions this row stands for (default 1). */
  count?: number;
  /**
   * A state, not an event: a repeat of the same decision on the same day (the read-in planner asking every minute
   * while the cap is reached) only moves `last_at`, it does not count again.
   */
  once?: boolean;
}

/** Record one decision (upsert + count). Never throws. */
export async function recordDecision(db: DbOrTx, userId: string, d: Decision): Promise<boolean> {
  try {
    const at = (d.at ?? new Date()).toISOString();
    await db.execute(sql`
      insert into llm_decisions (owner_user_id, day, skill_key, kind, reason, trigger, subject, count, usd, llm_call_id, detail, first_at, last_at)
      values (${userId}, ${d.day}::date, ${d.skill.slice(0, 80)}, ${d.kind}, ${d.reason.slice(0, 80)}, ${(d.trigger ?? '').slice(0, 80)}, ${(d.subject ?? '').slice(0, 200)},
              ${Math.max(1, Math.round(d.count ?? 1))}, ${money(d.usd ?? 0)}, ${d.llmCallId ?? null}, ${JSON.stringify(d.detail ?? {})}::jsonb, ${at}::timestamptz, ${at}::timestamptz)
      on conflict (owner_user_id, day, skill_key, kind, reason, trigger, subject) do update
        set count = llm_decisions.count + case when ${!!d.once}::boolean then 0 else excluded.count end,
            usd = llm_decisions.usd + case when ${!!d.once}::boolean then 0 else excluded.usd end,
            llm_call_id = coalesce(excluded.llm_call_id, llm_decisions.llm_call_id), detail = excluded.detail,
            last_at = greatest(llm_decisions.last_at, excluded.last_at)`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Reservations (D6)
// ---------------------------------------------------------------------------------------------

export interface Reservation {
  ok: boolean;
  /** What this reservation holds (0 when refused or when the user has no budget row). */
  heldUsd: number;
  /** Booked daily spend and what other calls in flight hold, when it was taken. */
  spentUsd: number;
  reservedUsd: number;
  hardCapUsd: number;
  /** Give the hold back (after the call's spend is booked). Idempotent, never throws. */
  release(): Promise<void>;
}

/**
 * Hold `usd` (the call's own cost cap) against the daily hard cap while the call runs. Refused when the day's booked
 * spend + what calls in flight hold + `usd` would pass `hardCapUsd`. The check and the hold are one UPDATE on the
 * day's llm_budget_days row, so two parallel jobs can't both pass with the last dollar. A hold a crash leaves behind
 * only lasts its own day (the row is per day).
 */
export async function reserveBudget(db: DbOrTx, userId: string, o: { day: string; usd: number; hardCapUsd: number }): Promise<Reservation> {
  const usd = money(o.usd);
  const spentRow = await db.execute<{ spent: string | null; reserved: string | null; budget_id: string | null }>(sql`
    select (select coalesce(sum(cost_usd), 0) from llm_calls where owner_user_id = ${userId} and budget_day = ${o.day}::date and budget = 'daily') as spent,
           (select d.reserved_usd from llm_budget_days d join llm_budgets b on b.id = d.budget_id where b.owner_user_id = ${userId} and b.scope = 'total' and d.day = ${o.day}::date) as reserved,
           (select b.id from llm_budgets b where b.owner_user_id = ${userId} and b.scope = 'total' limit 1) as budget_id`);
  const row = spentRow.rows[0];
  const spent = Number(row?.spent ?? 0);
  const budgetId = row?.budget_id ?? null;
  const none: Omit<Reservation, 'ok'> = { heldUsd: 0, spentUsd: spent, reservedUsd: Number(row?.reserved ?? 0), hardCapUsd: o.hardCapUsd, release: async () => undefined };
  if (!budgetId) return { ...none, ok: spent + usd <= o.hardCapUsd + 1e-9 };
  if (!(usd > 0)) return { ...none, ok: spent < o.hardCapUsd };
  await db.execute(sql`insert into llm_budget_days (budget_id, day) values (${budgetId}::uuid, ${o.day}::date) on conflict (budget_id, day) do nothing`);
  const upd = await db.execute<{ reserved: string }>(sql`
    update llm_budget_days d set reserved_usd = d.reserved_usd + ${usd}, updated_at = now()
     where d.budget_id = ${budgetId}::uuid and d.day = ${o.day}::date
       and (select coalesce(sum(cost_usd), 0) from llm_calls where owner_user_id = ${userId} and budget_day = ${o.day}::date and budget = 'daily') + d.reserved_usd + ${usd} <= ${o.hardCapUsd} + 0.000001
    returning d.reserved_usd as reserved`);
  if (!upd.rows.length) return { ...none, ok: false };
  let released = false;
  return {
    ok: true,
    heldUsd: usd,
    spentUsd: spent,
    reservedUsd: Number(upd.rows[0]!.reserved) - usd,
    hardCapUsd: o.hardCapUsd,
    release: async () => {
      if (released) return;
      released = true;
      await db
        .execute(sql`update llm_budget_days set reserved_usd = greatest(0, reserved_usd - ${usd}), updated_at = now() where budget_id = ${budgetId}::uuid and day = ${o.day}::date`)
        .catch(() => undefined);
    },
  };
}
