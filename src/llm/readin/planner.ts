/**
 * Automatic read-in triggers (deterministic SQL, no LLM), run by the worker every minute:
 *
 *   direct_ask    a new live work item whose origin is a direct ask of me: a DM / @mention / email to me
 *                 (source_items.addressed_to_me and not from me), a loop-back, or an explicit question (kind ask)
 *   top_rank      an item in the top N of the ranking (default 5; trainings and travel are skipped)
 *   meeting_prep  a meeting in the next 24 h whose linked items still show prep open
 *   new_evidence  a queued or running read-in whose item moved to a newer generation (it is superseded)
 *
 * Everything goes through `enqueueReadIn`, which dedupes per entity. Claim priority follows the rank, so the
 * queue is processed in rank order, and nothing automatic is enqueued once today's read-in budget is spent.
 */
import { sql } from 'drizzle-orm';

import type { ReadInEntity, ReadInTrigger } from '@/contract';
import { READIN_DEFAULTS } from '@/contract';
import type { Db } from '@/db/client';
import { recordDecision } from '@/db/ledger';
import { enqueueReadIn, readInBudget, type EnqueueAction } from '@/server/datasource/db/readin';

import { READIN_KIND } from './state';

export interface PlanOptions {
  topN?: number;
  horizonHours?: number;
  /** How far back a direct ask still counts as new. */
  directAskWindowHours?: number;
  now?: Date;
}

export interface PlanResult {
  skipped: 'budget' | 'hard_cap' | null;
  enqueued: Array<{ entity: ReadInEntity; trigger: ReadInTrigger; action: EnqueueAction; jobId: number | null }>;
}

interface Candidate {
  entity: ReadInEntity;
  trigger: ReadInTrigger;
  priority: number;
}

const LIVE = sql`('open', 'in_progress', 'waiting_on_me', 'likely_done')`;
const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

export async function readInCandidates(db: Db, userId: string, o: PlanOptions = {}): Promise<Candidate[]> {
  const now = o.now ?? new Date();
  const topN = o.topN ?? READIN_DEFAULTS.topN;
  const horizon = o.horizonHours ?? READIN_DEFAULTS.meetingHorizonHours;
  const window = o.directAskWindowHours ?? 48;
  const out: Candidate[] = [];

  const asks = rows<{ id: string; rank: number | null }>(
    await db.execute(sql`
      select w.id, w.priority_rank as rank from work_items w
       where w.owner_user_id = ${userId} and w.status in ${LIVE}
         and w.created_at > ${now.toISOString()}::timestamptz - make_interval(hours => ${window})
         and exists (
           select 1 from work_item_evidence e join source_items s on s.id = e.source_item_id
            where e.work_item_id = w.id and e.role = 'origin' and not s.from_me
              -- MIN-8: the ask itself is recent, not only the item: a first-scan backfill creates every item now, and
              -- weeks-old asks each got an automatic Sonnet read-in (up to the daily cap on every fresh database).
              and s.occurred_at > ${now.toISOString()}::timestamptz - make_interval(hours => ${window})
              and (s.addressed_to_me or e.rationale like 'loop_back:%' or w.kind = 'ask'))`),
  );
  for (const a of asks) out.push({ entity: { type: 'work_item', id: a.id }, trigger: 'direct_ask', priority: 75 - Math.min(a.rank ?? 20, 20) });

  const top = rows<{ id: string; rank: number }>(
    await db.execute(sql`
      select w.id, w.priority_rank as rank from work_items w
       where w.owner_user_id = ${userId} and w.status in ${LIVE} and w.priority_rank is not null and w.priority_rank <= ${topN}
         and w.kind not in ('training', 'travel')
       order by w.priority_rank`),
  );
  for (const t of top) out.push({ entity: { type: 'work_item', id: t.id }, trigger: 'top_rank', priority: 60 - t.rank });

  const meetings = rows<{ id: string; hours: number }>(
    await db.execute(sql`
      select ev.id, extract(epoch from (ev.starts_at - ${now.toISOString()}::timestamptz)) / 3600 as hours from calendar_events ev
       where ev.owner_user_id = ${userId} and ev.status <> 'cancelled' and ev.my_response <> 'declined' and not ev.is_all_day
         and ev.starts_at > ${now.toISOString()}::timestamptz
         and ev.starts_at <= ${now.toISOString()}::timestamptz + make_interval(hours => ${horizon})
         and exists (
           select 1 from work_items w
            where w.owner_user_id = ${userId} and w.status in ('open', 'waiting_on_me', 'suggested')
              and (w.deadline_event_id = ev.id or exists (select 1 from work_item_links l where l.work_item_id = w.id and l.calendar_event_id = ev.id and l.role = 'prep_for')))
       order by ev.starts_at`),
  );
  for (const m of meetings) out.push({ entity: { type: 'calendar_event', id: m.id }, trigger: 'meeting_prep', priority: 70 - Math.min(20, Math.floor(Number(m.hours))) });

  // One candidate per entity: the highest priority wins (a direct ask in the top 3 keeps direct_ask).
  const best = new Map<string, Candidate>();
  for (const c of out) {
    const k = `${c.entity.type}:${c.entity.id}`;
    const cur = best.get(k);
    if (!cur || c.priority > cur.priority) best.set(k, c);
  }
  return [...best.values()].sort((a, b) => b.priority - a.priority);
}

/** Read-ins whose item moved past the generation they were queued for (new evidence supersedes them). */
export async function supersededReadIns(db: Db, userId: string): Promise<Array<{ entity: ReadInEntity; priority: number; trigger: ReadInTrigger }>> {
  return rows<{ id: string; priority: number; trigger: string | null }>(
    await db.execute(sql`
      select w.id, j.priority, j.payload->>'trigger' as trigger from jobs j
        join work_items w on w.id = (j.payload->>'work_item_id')::uuid
       where j.owner_user_id = ${userId} and j.kind = ${READIN_KIND} and j.status in ('queued', 'running') and j.cancel_requested_at is null
         and w.reeval_generation > coalesce(j.generation, 0)`),
  ).map((r) => ({ entity: { type: 'work_item' as const, id: r.id }, priority: r.priority, trigger: (r.trigger === 'on_demand' ? 'on_demand' : 'new_evidence') as ReadInTrigger }));
}

export async function planReadIns(db: Db, userId: string, o: PlanOptions = {}): Promise<PlanResult> {
  const enqueued: PlanResult['enqueued'] = [];
  // New evidence first: it supersedes running read-ins even when the budget is spent (the restart is what was asked for).
  for (const s of await supersededReadIns(db, userId)) {
    const r = await enqueueReadIn(db, userId, s.entity, { trigger: s.trigger, priority: s.priority });
    enqueued.push({ entity: s.entity, trigger: s.trigger, action: r.action, jobId: r.jobId });
  }
  const b = await readInBudget(db, userId, o.now);
  const blocked = b.totalUsd >= b.hardUsd ? 'hard_cap' : b.readinUsd >= b.readinCapUsd ? 'readin_cap' : null;
  if (blocked) {
    // D0: each automatic read-in the cap held back today, once per item (the planner asks every minute).
    for (const c of await readInCandidates(db, userId, o)) {
      await recordDecision(db, userId, { skill: c.entity.type === 'calendar_event' ? 'readin-meeting' : 'readin-ask', kind: 'block', reason: blocked, trigger: c.trigger, subject: `${c.entity.type}:${c.entity.id}`, day: b.day, ...(o.now ? { at: o.now } : {}), once: true, detail: { readinUsd: b.readinUsd, readinCapUsd: b.readinCapUsd, totalUsd: b.totalUsd, hardUsd: b.hardUsd } });
    }
    return { skipped: blocked === 'hard_cap' ? 'hard_cap' : 'budget', enqueued };
  }
  for (const c of await readInCandidates(db, userId, o)) {
    const r = await enqueueReadIn(db, userId, c.entity, { trigger: c.trigger, priority: c.priority });
    if (r.action !== 'fresh' && r.action !== 'running' && r.action !== 'failed_recently') enqueued.push({ entity: c.entity, trigger: c.trigger, action: r.action, jobId: r.jobId });
  }
  return { skipped: null, enqueued };
}

/** Automatic read-ins are on when CC_READIN=1, or by default whenever the scanner's LLM linking is on. */
export function readInsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.CC_READIN ?? env.CC_SCAN_LLM ?? (env.NODE_ENV === 'production' ? '1' : '0');
  return v === '1' || v === 'true';
}

/** The worker hook (src/worker/index.ts): plan every minute while read-ins are enabled. */
export function readInPlanHook(db: Db, userId: string, log?: (msg: string, detail?: Record<string, unknown>) => void) {
  return {
    name: 'readin',
    everyMs: 60_000,
    run: async (now: Date) => {
      if (!readInsEnabled()) return;
      const r = await planReadIns(db, userId, { now });
      if (r.enqueued.length) log?.('readin: planned', { n: r.enqueued.length, actions: r.enqueued.map((e) => `${e.trigger}:${e.action}`).join(',') });
    },
  };
}
