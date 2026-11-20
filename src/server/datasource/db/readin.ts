/**
 * Read-ins on Postgres (BE-READIN). No migration: everything lives in existing tables.
 *
 *  - The last finished read-in per entity: `user_settings` key `readin/<type>/<id>` (jsonb, audited through
 *    cc_audit_kv, so every write is inside an engine change set). The prefix is deliberately outside `cc.%`, so the
 *    per-request read model (loadKv) never loads read-in bodies.
 *  - queued / researching / progress: the `jobs` row of kind `readin.generate` (dedupe key `readin:<type>:<id>`,
 *    generation = work_items.reeval_generation). `jobs.result` carries step codes and counts only, never text.
 *  - The suggested reply: a `drafts` row (status ready, mode draft, created_by engine). Nothing here dispatches it.
 *  - Spend: `llm_calls` (purpose summarize, skill_key readin-*), counted against budgets.readinUsdPerDay and the
 *    global hard cap.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { Draft, ReadIn, ReadInEntity, ReadInPayload, ReadInProgress, ReadInState, ReadInTrigger } from '@/contract';
import { READIN_DEFAULTS } from '@/contract';
import { actors, withChangeSet } from '@/db/changeset';
import type { Db, DbOrTx, Tx } from '@/db/client';
import { enqueueJob } from '@/db/queue';
import { insertLlmCall, type RequiredAudit } from '@/db/ledger';
import { deriveReadIn, emptyReadIn, READIN_KIND, READIN_QUEUE, readinDedupeKey, readinKey, type EntityFreshness, type ReadInJobSnap, type StoredReadIn } from '@/llm/readin/state';
import type { LedgerHit, LedgerSearch } from '@/llm/readin/tools';
import { redactText } from '@/llm/redact';

import { renderAll, plainText as docPlainText } from '../mock/render';
import { insertDraft } from './store/nba';
import type { WriteCtx } from './store/common';

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

// ---------------------------------------------------------------------------
// Stored read-in (kv)
// ---------------------------------------------------------------------------

export async function loadStored(db: DbOrTx, userId: string, entity: ReadInEntity): Promise<StoredReadIn | null> {
  const r = rows<{ value: StoredReadIn }>(await db.execute(sql`select value from user_settings where owner_user_id = ${userId} and key = ${readinKey(entity)}`));
  return r[0]?.value ?? null;
}

async function putStored(tx: Tx, userId: string, entity: ReadInEntity, value: StoredReadIn): Promise<void> {
  await tx.execute(sql`
    insert into user_settings (owner_user_id, key, value) values (${userId}, ${readinKey(entity)}, ${JSON.stringify(value)}::jsonb)
    on conflict (owner_user_id, key) do update set value = excluded.value, updated_at = now()`);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

interface JobRowRaw {
  id: string;
  status: ReadInJobSnap['status'];
  generation: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  cancel_requested_at: string | null;
  last_error_code: string | null;
  updated_at: string;
}

function snapOf(j: JobRowRaw): ReadInJobSnap {
  const progress = (j.result?.progress ?? null) as ReadInProgress | null;
  return {
    id: Number(j.id),
    status: j.status,
    generation: j.generation === null ? null : Number(j.generation),
    trigger: ((j.payload.trigger as ReadInTrigger | undefined) ?? 'on_demand') as ReadInTrigger,
    progress: j.status === 'running' ? progress : null,
    cancelRequested: !!j.cancel_requested_at,
    skipped: typeof j.result?.skipped === 'string' ? (j.result.skipped as string) : null,
    lastErrorCode: j.last_error_code,
    updatedAt: new Date(j.updated_at).toISOString(),
  };
}

export async function latestJob(db: DbOrTx, userId: string, entity: ReadInEntity): Promise<ReadInJobSnap | null> {
  const r = rows<JobRowRaw>(
    await db.execute(sql`
      select id, status, generation, payload, result, cancel_requested_at, last_error_code, updated_at from jobs
       where owner_user_id = ${userId} and kind = ${READIN_KIND} and dedupe_key = ${readinDedupeKey(entity)}
       order by id desc limit 1`),
  );
  return r[0] ? snapOf(r[0]) : null;
}

/** Progress for the UI while researching: step codes and counts only (jobs.result never carries source text). */
export async function setJobProgress(db: DbOrTx, jobId: number, progress: ReadInProgress): Promise<void> {
  await db.execute(sql`update jobs set result = jsonb_build_object('progress', ${JSON.stringify(progress)}::jsonb), updated_at = now() where id = ${jobId} and status = 'running'`);
}

// ---------------------------------------------------------------------------
// Entity freshness (generation, newest evidence)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function freshnessOf(db: DbOrTx, userId: string, entity: ReadInEntity, since?: string | null): Promise<EntityFreshness | null> {
  if (!UUID_RE.test(entity.id)) return null;
  if (entity.type === 'work_item') {
    const r = rows<{ g: string; last: string | null; n: string }>(
      await db.execute(sql`
        select w.reeval_generation as g, w.last_new_info_at as last,
               (select count(*) from work_item_evidence e where e.work_item_id = w.id and ${since ?? null}::timestamptz is not null and e.created_at > ${since ?? null}::timestamptz) as n
          from work_items w where w.id = ${entity.id} and w.owner_user_id = ${userId}`),
    );
    const x = r[0];
    return x ? { generation: Number(x.g), lastNewInfoAt: x.last ? new Date(x.last).toISOString() : null, newSince: Number(x.n) } : null;
  }
  const r = rows<{ g: string | null; last: string | null; ok: boolean }>(
    await db.execute(sql`
      select true as ok,
             (select coalesce(sum(w.reeval_generation), 0) from work_items w
               where w.owner_user_id = ${userId} and (w.deadline_event_id = ev.id or exists (select 1 from work_item_links l where l.work_item_id = w.id and l.calendar_event_id = ev.id))) as g,
             (select max(w.last_new_info_at) from work_items w
               where w.owner_user_id = ${userId} and (w.deadline_event_id = ev.id or exists (select 1 from work_item_links l where l.work_item_id = w.id and l.calendar_event_id = ev.id))) as last
        from calendar_events ev where ev.id = ${entity.id} and ev.owner_user_id = ${userId}`),
  );
  const x = r[0];
  return x ? { generation: Number(x.g ?? 0), lastNewInfoAt: x.last ? new Date(x.last).toISOString() : null } : null;
}

async function timezoneOf(db: DbOrTx, userId: string): Promise<string> {
  const r = rows<{ tz: string | null }>(await db.execute(sql`select timezone as tz from users where id = ${userId}`));
  return r[0]?.tz || 'America/Denver';
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getReadInDb(db: DbOrTx, userId: string, entity: ReadInEntity): Promise<ReadInPayload> {
  const stored = await loadStored(db, userId, entity);
  const job = await latestJob(db, userId, entity);
  const fresh = await freshnessOf(db, userId, entity, stored?.readIn.generatedAt ?? null);
  return { entity, readIn: deriveReadIn(entity, stored, job, fresh, await timezoneOf(db, userId)) };
}

export async function entityExists(db: DbOrTx, userId: string, entity: ReadInEntity): Promise<boolean> {
  if (!UUID_RE.test(entity.id)) return false;
  const r = entity.type === 'work_item'
    ? await db.execute(sql`select 1 from work_items where id = ${entity.id}::uuid and owner_user_id = ${userId}`)
    : await db.execute(sql`select 1 from calendar_events where id = ${entity.id}::uuid and owner_user_id = ${userId}`);
  return r.rows.length > 0;
}

/** readInState for every work item that has a read-in (one query per source; no bodies loaded). */
export async function readInStates(db: DbOrTx, userId: string): Promise<Map<string, ReadInState>> {
  const stored = rows<{ id: string; outcome: StoredReadIn['outcome']; generation: string | null; generated_at: string | null; job_id: string | null }>(
    await db.execute(sql`
      select substr(key, length('readin/work_item/') + 1) as id, value->>'outcome' as outcome, value->'readIn'->>'generation' as generation,
             value->'readIn'->>'generatedAt' as generated_at, value->>'jobId' as job_id
        from user_settings where owner_user_id = ${userId} and key like 'readin/work_item/%'`),
  );
  const jobs = rows<JobRowRaw & { dedupe_key: string }>(
    await db.execute(sql`
      select distinct on (dedupe_key) dedupe_key, id, status, generation, payload, result, cancel_requested_at, last_error_code, updated_at
        from jobs where owner_user_id = ${userId} and kind = ${READIN_KIND} and dedupe_key like 'readin:work_item:%'
       order by dedupe_key, id desc`),
  );
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = new Set([...stored.map((s) => s.id), ...jobs.map((j) => j.dedupe_key.slice('readin:work_item:'.length))].filter((id) => UUID.test(id)));
  if (!ids.size) return new Map();
  const fresh = new Map(
    rows<{ id: string; g: string; last: string | null }>(
      await db.execute(sql`select id, reeval_generation as g, last_new_info_at as last from work_items where owner_user_id = ${userId} and id = any(${`{${[...ids].join(',')}}`}::uuid[])`),
    ).map((r) => [r.id, { generation: Number(r.g), lastNewInfoAt: r.last ? new Date(r.last).toISOString() : null }]),
  );
  const out = new Map<string, ReadInState>();
  const sById = new Map(stored.map((s) => [s.id, s]));
  const jById = new Map(jobs.map((j) => [j.dedupe_key.slice('readin:work_item:'.length), snapOf(j)]));
  for (const id of ids) {
    const s = sById.get(id);
    const entity: ReadInEntity = { type: 'work_item', id };
    const st: StoredReadIn | null = s
      ? { v: 1, outcome: s.outcome, jobId: s.job_id ? Number(s.job_id) : null, readIn: { ...emptyReadIn(entity, s.generated_at ?? new Date(0).toISOString()), state: s.outcome === 'ready' ? 'ready' : 'failed', generation: Number(s.generation ?? 0), generatedAt: s.generated_at } }
      : null;
    const r = deriveReadIn(entity, st, jById.get(id) ?? null, fresh.get(id) ?? null);
    if (r) out.set(id, r.state);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Enqueue (dedupe + supersede)
// ---------------------------------------------------------------------------

export type EnqueueAction = 'queued' | 'merged' | 'superseded' | 'running' | 'fresh' | 'failed_recently' | 'gone';

export interface EnqueueReadInOptions {
  trigger: ReadInTrigger;
  /** Claim order: on-demand 90, automatic 60 - rank (rank order). */
  priority: number;
  force?: boolean;
  /** Defaults to the entity's current generation. */
  generation?: number;
}

/**
 * One read-in per entity at a time (dedupe key `readin:<type>:<id>`):
 *  - a queued one absorbs the request (priority raised, generation moved forward);
 *  - a running one for the same generation is left alone; for an older generation it is cancelled
 *    (cancel_requested_at → pg_notify cc_job_cancel → the worker aborts it) and the new one may start at once
 *    (supersedes_running), so new evidence supersedes a running read-in;
 *  - a ready read-in for the current generation is fresh (nothing to do) unless forced;
 *  - an automatic trigger never re-runs a read-in that died at this generation (no hot loops); on-demand does.
 */
export async function enqueueReadIn(db: DbOrTx, userId: string, entity: ReadInEntity, o: EnqueueReadInOptions): Promise<{ action: EnqueueAction; jobId: number | null; generation: number }> {
  const fresh = await freshnessOf(db, userId, entity);
  if (!fresh) return { action: 'gone', jobId: null, generation: 0 };
  const gen = Math.max(o.generation ?? fresh.generation, fresh.generation);
  const key = readinDedupeKey(entity);
  const live = rows<{ id: string; status: string; generation: string | null; cancel_requested_at: string | null }>(
    await db.execute(sql`select id, status, generation, cancel_requested_at from jobs where owner_user_id = ${userId} and dedupe_key = ${key} and status in ('queued', 'running') order by id desc`),
  );
  const queued = live.find((j) => j.status === 'queued');
  if (queued) {
    await db.execute(sql`
      update jobs set priority = greatest(priority, ${o.priority}), generation = greatest(coalesce(generation, 0), ${gen}),
             payload = case when ${o.trigger === 'on_demand'}::boolean then payload || jsonb_build_object('trigger', 'on_demand', 'force', ${!!o.force}::boolean) else payload end,
             updated_at = now()
       where id = ${queued.id} and status = 'queued'`);
    return { action: 'merged', jobId: Number(queued.id), generation: gen };
  }
  const running = live.find((j) => j.status === 'running' && !j.cancel_requested_at);
  let superseded = false;
  if (running) {
    if (Number(running.generation ?? 0) >= gen && !o.force) return { action: 'running', jobId: Number(running.id), generation: gen };
    await db.execute(sql`update jobs set cancel_requested_at = now(), cancel_reason = ${`superseded by generation ${gen}`}, updated_at = now() where id = ${running.id} and status = 'running' and cancel_requested_at is null`);
    superseded = true;
  }
  if (!o.force && !running) {
    const stored = await loadStored(db, userId, entity);
    if (stored?.outcome === 'ready' && stored.readIn.generation >= gen) return { action: 'fresh', jobId: stored.jobId, generation: gen };
    if (o.trigger !== 'on_demand') {
      const last = await latestJob(db, userId, entity);
      if (last && (last.status === 'dead' || last.skipped === 'budget' || last.skipped === 'hard_cap') && (last.generation ?? 0) >= gen && Date.now() - Date.parse(last.updatedAt) < 6 * 3_600_000) {
        return { action: 'failed_recently', jobId: last.id, generation: gen };
      }
    }
  }
  const r = await enqueueJob(db, {
    ownerUserId: userId,
    kind: READIN_KIND,
    queue: READIN_QUEUE,
    payload: { entity_type: entity.type, entity_id: entity.id, trigger: o.trigger, force: !!o.force, ...(entity.type === 'work_item' ? { work_item_id: entity.id } : {}) },
    priority: o.priority,
    dedupeKey: key,
    generation: gen,
    supersedesRunning: true,
    maxAttempts: 3,
    timeoutSeconds: 420,
  });
  return { action: superseded ? 'superseded' : r.inserted ? 'queued' : 'merged', jobId: r.id, generation: gen };
}

// ---------------------------------------------------------------------------
// Commit (one engine change set: the Outbox draft + the stored read-in)
// ---------------------------------------------------------------------------

export interface CommitReadInInput {
  entity: ReadInEntity;
  jobId: number | null;
  /** Content (state ready) or a failure record. */
  readIn: ReadIn;
  outcome: StoredReadIn['outcome'];
  /** The suggested reply to stage in the Outbox (never sent). */
  reply?: { destination: Draft['destination']; doc: Draft['doc']; label: string; preview: string } | null;
  /** W3-style fence: commit only while the entity is still at this generation. */
  fenceGeneration?: number;
}

export interface CommitReadInResult {
  committed: boolean;
  draftId: string | null;
  reason?: 'superseded' | 'gone';
}

export async function commitReadIn(db: Db, userId: string, input: CommitReadInInput): Promise<CommitReadInResult> {
  const fresh = await freshnessOf(db, userId, input.entity);
  if (!fresh) return { committed: false, draftId: null, reason: 'gone' };
  if (input.fenceGeneration !== undefined && fresh.generation > input.fenceGeneration) return { committed: false, draftId: null, reason: 'superseded' };
  const now = new Date();
  const tz = await timezoneOf(db, userId);
  const { result } = await withChangeSet(
    { db, userId, actor: actors.engine(input.readIn.skillVersion ?? 'readin'), reason: input.outcome === 'ready' ? `Read-in ready` : `Read-in failed`, entity: { type: input.entity.type, id: input.entity.id }, undoable: false },
    async (tx, cs) => {
      const prev = await loadStored(tx, userId, input.entity);
      let draftId: string | null = null;
      let readIn = input.readIn;
      if (input.outcome === 'ready' && input.reply && (await itemClosed(tx, userId, input.entity))) {
        // OUTBOX-W: the to-do closed while this read-in ran: no reply to suggest, nothing new in the Outbox.
        readIn = { ...readIn, suggestedReply: null };
      } else if (input.outcome === 'ready' && input.reply) {
        const prevDraftId = prev?.readIn.suggestedReply?.draftId ?? null;
        const prevDraft = prevDraftId
          ? rows<{ id: string; status: string; edited_by_user: boolean }>(await tx.execute(sql`select id, status, edited_by_user from drafts where id = ${prevDraftId}::uuid and owner_user_id = ${userId}`))[0]
          : undefined;
        if (prevDraft && prevDraft.edited_by_user && prevDraft.status === 'ready') {
          // R-UI-20: never overwrite what he edited; the read-in keeps pointing at his draft.
          draftId = prevDraft.id;
          readIn = { ...readIn, suggestedReply: prev!.readIn.suggestedReply };
        } else {
          if (prevDraft && prevDraft.status === 'ready') {
            await tx.execute(sql`update drafts set status = 'discarded', version = version + 1, updated_at = now() where id = ${prevDraft.id}::uuid`);
          }
          const id = randomUUID();
          const at = now.toISOString();
          const d: Draft = {
            id,
            version: 1,
            workItemId: input.entity.type === 'work_item' ? input.entity.id : null,
            nbaId: null,
            destination: input.reply.destination,
            mode: 'draft',
            doc: input.reply.doc,
            plainText: docPlainText(input.reply.doc),
            rendered: renderAll(input.reply.destination, input.reply.doc),
            userTouched: false,
            userLockedFields: [],
            status: 'ready',
            threadContext: [],
            createdAt: at,
            updatedAt: at,
            savedAt: null,
            scheduledFor: null,
            attempts: [],
            verification: null,
            rejectedReason: null,
            resultUrl: null,
          };
          const w: WriteCtx = { tx, cs, userId, me: { id: userId, name: '' }, now, extractorId: '', timezone: tz, kv: new Map() };
          draftId = await insertDraft(w, d);
          readIn = { ...readIn, suggestedReply: { draftId, channel: d.destination.kind, destinationLabel: input.reply.label, preview: input.reply.preview } };
        }
      }
      await putStored(tx, userId, input.entity, { v: 1, outcome: input.outcome, jobId: input.jobId, readIn });
      return draftId;
    },
  );
  await notifyReadIn(db, input.entity, input.outcome === 'ready' ? 'readin.ready' : 'readin.failed');
  return { committed: true, draftId: result };
}

/**
 * OUTBOX-W: is the read-in's work item closed (done, dismissed, merged)? `for share` waits for a close that is
 * committing right now and then sees it; a close that starts after this waits for the read-in to commit, and its
 * withdrawal (store/withdraw.ts, in the closing change set) then sees the new draft. Either way no reply draft
 * outlives its to-do.
 */
async function itemClosed(tx: Tx, userId: string, entity: ReadInEntity): Promise<boolean> {
  if (entity.type !== 'work_item') return false;
  const r = rows<{ status: string }>(await tx.execute(sql`select status::text as status from work_items where id = ${entity.id}::uuid and owner_user_id = ${userId} for share`));
  return !!r[0] && ['done', 'dismissed', 'merged'].includes(r[0].status);
}

/** Live event `readin` (+ item / items so Home rows pick up "✦ Read-in ready"). Small payload on cc_live. */
export async function notifyReadIn(db: DbOrTx, entity: ReadInEntity, reason: string): Promise<void> {
  const at = new Date().toISOString();
  const topics = entity.type === 'work_item' ? ['readin', 'item', 'items', 'today'] : ['readin', 'calendar'];
  for (const t of topics) {
    const payload = JSON.stringify({ o: 'readin', t, i: [entity.id], r: reason, a: at, ...(entity.type === 'work_item' ? { e: 'work_item' } : {}) });
    await db.execute(sql`select pg_notify('cc_live', ${payload})`);
  }
}

// ---------------------------------------------------------------------------
// Spend and budget
// ---------------------------------------------------------------------------

export interface ReadInBudget {
  day: string;
  readinUsd: number;
  totalUsd: number;
  readinCapUsd: number;
  hardUsd: number;
}

function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export async function readInBudget(db: DbOrTx, userId: string, now = new Date()): Promise<ReadInBudget> {
  const day = localDay(now, await timezoneOf(db, userId));
  const b = rows<{ value: { hardUsd?: number; readinUsdPerDay?: number; today?: { day?: string; hardUsd?: number } | null } }>(await db.execute(sql`select value from user_settings where owner_user_id = ${userId} and key = 'settings.budgets'`))[0]?.value ?? {};
  // Settings ▸ Budgets ▸ "Today only" wins for its own day.
  const hardToday = b.today && b.today.day === day && typeof b.today.hardUsd === 'number' ? b.today.hardUsd : undefined;
  const s = rows<{ readin: string; total: string }>(
    await db.execute(sql`
      select coalesce(sum(cost_usd) filter (where skill_key like 'readin-%'), 0) as readin, coalesce(sum(cost_usd), 0) as total
        from llm_calls where owner_user_id = ${userId} and budget_day = ${day}::date and budget = 'daily'`), // BUD-1
  )[0]!;
  return { day, readinUsd: Number(s.readin), totalUsd: Number(s.total), readinCapUsd: b.readinUsdPerDay ?? READIN_DEFAULTS.usdPerDay, hardUsd: hardToday ?? b.hardUsd ?? 15 };
}

export async function recordReadInSpend(
  db: DbOrTx,
  userId: string,
  s: {
    model: string;
    skillKey: string;
    skillVersion: string;
    jobId: number | null;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    status: 'ok' | 'error' | 'timeout' | 'budget_blocked';
    errorCode?: string;
    startedAt: Date;
  } & RequiredAudit,
): Promise<void> {
  const day = localDay(s.startedAt, await timezoneOf(db, userId));
  await insertLlmCall(db, {
    ownerUserId: userId,
    purpose: 'summarize',
    model: s.model,
    skillKey: s.skillKey,
    promptVersion: s.skillVersion,
    requestHash: `readin:${s.jobId ?? 'none'}:${randomUUID()}`,
    jobId: s.jobId,
    status: s.status,
    errorCode: s.errorCode ?? null,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    cacheReadTokens: s.cacheReadTokens ?? 0,
    cacheWriteTokens: s.cacheWriteTokens ?? 0,
    costUsd: s.costUsd,
    budgetDay: day,
    startedAt: s.startedAt,
    finishedAt: new Date(),
    trigger: s.trigger,
    modelReason: s.modelReason,
    contentHash: s.contentHash,
    outcome: s.outcome,
  });
}

// ---------------------------------------------------------------------------
// Ledger search (internal, read-only)
// ---------------------------------------------------------------------------

export function dbLedgerSearch(db: DbOrTx, userId: string): LedgerSearch {
  return {
    async search({ text, limit }) {
      const q = text.replace(/[^\p{L}\p{N}\s@.'-]/gu, ' ').trim();
      if (!q) return [];
      const msgs = rows<{ id: string; source: string; at: string; title: string | null; url: string | null; from_me: boolean; body: string | null; wid: string | null }>(
        await db.execute(sql`
          select s.id, s.source, s.occurred_at as at, s.title, s.url, s.from_me, left(s.body, 500) as body,
                 (select e.work_item_id from work_item_evidence e where e.source_item_id = s.id order by e.created_at limit 1) as wid
            from source_items s
           where s.owner_user_id = ${userId} and s.body is not null and s.search_tsv @@ websearch_to_tsquery('english', ${q})
           order by s.from_me desc, s.occurred_at desc limit ${limit}`),
      );
      const items = rows<{ id: string; title: string; status: string; kind: string; created_at: string }>(
        await db.execute(sql`
          select id, title, status, kind, created_at from work_items
           where owner_user_id = ${userId} and search_tsv @@ websearch_to_tsquery('english', ${q})
           order by updated_at desc limit ${Math.max(2, Math.floor(limit / 2))}`),
      );
      const hits: LedgerHit[] = [
        ...msgs.map((m) => ({
          kind: 'message' as const,
          at: new Date(m.at).toISOString(),
          label: `${m.source}${m.title ? ` · ${redactText(m.title).slice(0, 80)}` : ''}`,
          text: redactText((m.body ?? '').replace(/\s+/g, ' ')).slice(0, 400),
          fromMe: m.from_me,
          ...(m.url ? { permalink: m.url } : {}),
          ...(m.wid ? { workItemId: m.wid } : {}),
        })),
        ...items.map((w) => ({ kind: 'work_item' as const, at: new Date(w.created_at).toISOString(), label: `${w.kind} · ${w.status}`, text: redactText(w.title), fromMe: false, workItemId: w.id })),
      ];
      return hits;
    },
  };
}

/** Adds `readInState` to the items that have a read-in (model.ts calls this once per read model). */
export function withReadInStates<T extends { id: string; readInState?: ReadInState }>(items: T[], states: Map<string, ReadInState>): T[] {
  if (!states.size) return items;
  return items.map((w) => (states.has(w.id) ? { ...w, readInState: states.get(w.id)! } : w));
}

export function queuedPlaceholder(entity: ReadInEntity, now: Date): ReadIn {
  return { ...emptyReadIn(entity, now.toISOString()), progress: { step: 'queued', label: 'Queued', done: 0, total: 6 } };
}
