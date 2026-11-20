/**
 * Job lifecycle on top of BE-0's queue primitives (src/db/queue.ts: enqueueJob, claimJobs, recordNewInfo).
 * DATA-MODEL §4.5 transitions, fenced on (status = 'running' AND locked_by = me) so a worker that lost its
 * lease can never complete, fail or release a job someone else re-claimed.
 *
 *   running → succeeded   completeJob
 *   running → queued      failJob (retryable class, attempts left; exponential backoff with equal jitter)
 *                         releaseJob (shutdown: attempt given back) · reapExpiredLeases (worker died / slept)
 *   running → dead        failJob (non-retryable class or attempts exhausted) → notification + app_event
 *   running → cancelled   cancelJob (cancel requested / superseded generation)
 *   dead    → queued      retryDeadJob (Health page "Retry")
 * A transition back to `queued` that would collide with an already-queued job of the same dedupe key
 * (jobs_dedupe_queued_uidx) cancels this one instead: the queued job already covers it.
 */
import { sql } from 'drizzle-orm';

import { GoogleCallError, DisallowedToolError } from '@/connectors/google/client';
import { redact } from '@/connectors/redact';
import type { ClaimedJob } from '@/db/queue';
import { DbError } from '@/db/errors';
import type { Db, DbOrTx } from '@/db/client';

import { JobError, type JobErrorClass, type JobRow } from './types';

export const DEFAULT_LEASE_SECONDS = 90;

export function jobRowOf(c: ClaimedJob): JobRow {
  return {
    id: Number(c.id),
    ownerUserId: c.owner_user_id,
    kind: c.kind,
    queue: c.queue,
    payload: (c.payload ?? {}) as Record<string, unknown>,
    attempts: Number(c.attempts),
    maxAttempts: Number(c.max_attempts ?? 5),
    timeoutSeconds: Number(c.timeout_seconds ?? 600),
    generation: c.generation === null || c.generation === undefined ? null : Number(c.generation),
    dedupeKey: c.dedupe_key ?? null,
    correlationId: (c.correlation_id as string | null | undefined) ?? null,
    cancelRequestedAt: (c.cancel_requested_at as string | null | undefined) ?? null,
  };
}

export const retryable = (c: JobErrorClass) => c === 'transient' || c === 'rate_limited' || c === 'unknown';

/** delay = min(max, base·2^(attempts−1)) (×2 when rate limited), with equal jitter: d/2 + rand·d/2. */
export function backoffSeconds(input: { attempts: number; baseSeconds: number; maxSeconds: number; errorClass: JobErrorClass; rand?: number; retryAfterSeconds?: number }): number {
  const n = Math.max(1, input.attempts);
  const d = Math.min(input.maxSeconds, input.baseSeconds * 2 ** (n - 1) * (input.errorClass === 'rate_limited' ? 2 : 1));
  const r = input.rand ?? Math.random();
  const delay = Math.round(d / 2 + (r * d) / 2);
  return Math.max(delay, Math.ceil(input.retryAfterSeconds ?? 0), 1);
}

/** Error → (class, code, privacy-safe message). Driver messages can embed bound parameters, so DB errors log codes only. */
export function classifyJobError(e: unknown): { errorClass: JobErrorClass; code: string; message: string } {
  const safe = (m: string) => redact(m).text.replace(/\s+/g, ' ').slice(0, 240);
  if (e instanceof JobError) return { errorClass: e.errorClass, code: e.opts.code ?? e.errorClass, message: safe(e.message) };
  if (e instanceof DbError) return { errorClass: e.errorClass, code: e.code, message: e.code };
  if (e instanceof DisallowedToolError) return { errorClass: 'bug', code: 'disallowed_tool', message: safe(e.message) };
  if (e instanceof GoogleCallError) {
    const c = e.info.errorClass;
    return { errorClass: c === 'config' ? 'validation' : c === 'auth' || c === 'transient' || c === 'rate_limited' ? c : 'unknown', code: `google_${e.info.signature}`, message: `google ${e.tool}: ${e.info.signature}` };
  }
  const err = e as { name?: string; message?: string; code?: unknown; cause?: { code?: unknown } };
  const pgCode = typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code) ? err.code : typeof err?.cause?.code === 'string' ? err.cause.code : undefined;
  if (pgCode || /Failed query/i.test(err?.message ?? '')) return { errorClass: 'unknown', code: `db_${pgCode ?? 'query'}`, message: `database error ${pgCode ?? ''}`.trim() };
  if (e instanceof RangeError || e instanceof TypeError || e instanceof SyntaxError) return { errorClass: 'bug', code: (err.name ?? 'bug').toLowerCase(), message: safe(`${err.name}: ${err.message}`) };
  return { errorClass: 'unknown', code: (err?.name ?? 'error').toLowerCase(), message: safe(`${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`) };
}

const fence = (id: number, workerId: string) => sql`id = ${id} and status = 'running' and locked_by = ${workerId}`;

/** Extend the leases this worker holds. Returns the ids still held and which of them have a cancel request. */
export async function heartbeatLeases(db: DbOrTx, workerId: string, ids: number[], leaseSeconds = DEFAULT_LEASE_SECONDS): Promise<Map<number, { cancelRequested: boolean }>> {
  const out = new Map<number, { cancelRequested: boolean }>();
  if (!ids.length) return out;
  const res = await db.execute<{ id: string; cancel: boolean }>(sql`
    update jobs set heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => ${leaseSeconds}), updated_at = now()
     where id in (${sql.join(
       ids.map((i) => sql`${i}::bigint`),
       sql`, `,
     )}) and status = 'running' and locked_by = ${workerId}
    returning id, cancel_requested_at is not null as cancel`);
  for (const r of res.rows) out.set(Number(r.id), { cancelRequested: r.cancel });
  return out;
}

export async function completeJob(db: DbOrTx, id: number, workerId: string, result: Record<string, unknown> = {}): Promise<boolean> {
  const res = await db.execute(sql`
    update jobs set status = 'succeeded', finished_at = now(), result = ${JSON.stringify(result)}::jsonb, lease_expires_at = null,
                    heartbeat_at = now(), updated_at = now()
     where ${fence(id, workerId)}`);
  return (res.rowCount ?? 0) > 0;
}

export interface FailInput {
  errorClass: JobErrorClass;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export type FailOutcome = { status: 'queued'; runAt: string } | { status: 'dead'; reason: string } | { status: 'cancelled' } | { status: 'lost' };

/** Retry with backoff, or dead-letter (with a persistent notification) when not retryable / out of attempts. */
export async function failJob(db: Db, id: number, workerId: string, f: FailInput, opts: { rand?: number } = {}): Promise<FailOutcome> {
  return db.transaction(async (tx) => {
    const cur = await tx.execute<{
      attempts: number;
      max_attempts: number;
      backoff_base_seconds: number;
      backoff_max_seconds: number;
      kind: string;
      owner_user_id: string;
      dedupe_key: string | null;
      payload: Record<string, unknown>;
    }>(sql`select attempts, max_attempts, backoff_base_seconds, backoff_max_seconds, kind, owner_user_id, dedupe_key, payload
             from jobs where ${fence(id, workerId)} for update`);
    const j = cur.rows[0];
    if (!j) return { status: 'lost' } as FailOutcome;
    const errorCols = sql`last_error_class = ${f.errorClass}, last_error_code = ${f.code.slice(0, 80)}, last_error = ${f.message.slice(0, 300)},
                          last_failed_at = now(), lease_expires_at = null, updated_at = now()`;
    const dead = !retryable(f.errorClass) || Number(j.attempts) >= Number(j.max_attempts);
    if (!dead) {
      const delay = backoffSeconds({ attempts: Number(j.attempts), baseSeconds: Number(j.backoff_base_seconds), maxSeconds: Number(j.backoff_max_seconds), errorClass: f.errorClass, rand: opts.rand, retryAfterSeconds: f.retryAfterSeconds });
      if (j.dedupe_key && (await queuedTwin(tx, id, j.dedupe_key))) {
        await tx.execute(sql`update jobs set status = 'cancelled', finished_at = now(), cancel_reason = 'retry superseded by a queued job', ${errorCols} where id = ${id}`);
        return { status: 'cancelled' } as FailOutcome;
      }
      const res = await tx.execute<{ run_at: string }>(sql`
        update jobs set status = 'queued', run_at = now() + make_interval(secs => ${delay}), locked_by = null, locked_at = null,
                        heartbeat_at = null, started_at = null, ${errorCols}
         where id = ${id} returning run_at`);
      return { status: 'queued', runAt: new Date(res.rows[0]!.run_at).toISOString() } as FailOutcome;
    }
    const reason = (Number(j.attempts) >= Number(j.max_attempts) && retryable(f.errorClass) ? `attempts exhausted: ${f.code}` : `${f.errorClass}: ${f.code}`).slice(0, 200);
    await tx.execute(sql`
      update jobs set status = 'dead', dead_at = now(), dead_reason = ${reason}, finished_at = now(), ${errorCols} where id = ${id}`);
    await deadLetterSignals(tx, { id, kind: j.kind, ownerUserId: j.owner_user_id, errorClass: f.errorClass, code: f.code, reason });
    return { status: 'dead', reason } as FailOutcome;
  });
}

async function queuedTwin(tx: DbOrTx, id: number, dedupeKey: string): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(sql`select exists (select 1 from jobs where dedupe_key = ${dedupeKey} and status = 'queued' and id <> ${id}) as ok`);
  return r.rows[0]?.ok === true;
}

/** R-UI-19: a dead-lettered job persists until acted on (notification) and shows in the Health event log. */
async function deadLetterSignals(tx: DbOrTx, j: { id: number; kind: string; ownerUserId: string; errorClass: JobErrorClass; code: string; reason: string }) {
  // Auth failures already raise the connector's own re-auth notification.
  if (j.errorClass !== 'auth') {
    await tx.execute(sql`
      insert into notifications (owner_user_id, kind, severity, title, body, entity_type, entity_id, job_id, action_route, action_kind, dedupe_key)
      values (${j.ownerUserId}, 'job_dead_lettered', 'error', ${`Background job failed: ${j.kind}`}, ${j.reason}, 'job', ${String(j.id)}, ${j.id},
              '/health#jobs', 'retry_job', ${`job:${j.id}:dead`})
      on conflict (owner_user_id, dedupe_key) where status in ('open', 'seen', 'snoozed') do nothing`);
  }
  await tx.execute(sql`
    insert into app_events (owner_user_id, severity, component, code, error_class, message, job_id, detail, fingerprint)
    values (${j.ownerUserId}, 'error', 'worker.jobs', 'job_dead_lettered', ${j.errorClass}, ${`${j.kind} dead-lettered (${j.code})`}, ${j.id},
            ${JSON.stringify({ kind: j.kind, code: j.code })}::jsonb, ${`worker.jobs|job_dead_lettered|${j.kind}|${j.code}`})
    on conflict (fingerprint) where resolved_at is null
    do update set occurrence_count = app_events.occurrence_count + 1, last_occurred_at = now(), job_id = excluded.job_id`);
}

/** running → cancelled (superseded generation or user cancel). Links the queued successor, if any. */
export async function cancelJob(db: DbOrTx, id: number, workerId: string, reason: string): Promise<boolean> {
  const res = await db.execute(sql`
    update jobs j set status = 'cancelled', finished_at = now(), cancel_reason = coalesce(j.cancel_reason, ${reason.slice(0, 200)}),
                      lease_expires_at = null, updated_at = now(),
                      superseded_by_id = (select q.id from jobs q where q.dedupe_key = j.dedupe_key and q.status = 'queued' and q.id <> j.id
                                           order by q.id desc limit 1)
     where j.id = ${id} and j.status = 'running' and j.locked_by = ${workerId}`);
  return (res.rowCount ?? 0) > 0;
}

/** Shutdown: give the job back (attempt not consumed). Cancelled instead when an identical job is already queued. */
export async function releaseJob(db: Db, id: number, workerId: string): Promise<'queued' | 'cancelled' | 'lost'> {
  return db.transaction(async (tx) => {
    const cur = await tx.execute<{ dedupe_key: string | null }>(sql`select dedupe_key from jobs where ${fence(id, workerId)} for update`);
    if (!cur.rows[0]) return 'lost' as const;
    const key = cur.rows[0].dedupe_key;
    if (key && (await queuedTwin(tx, id, key))) {
      await tx.execute(sql`update jobs set status = 'cancelled', finished_at = now(), cancel_reason = 'released at shutdown; a queued job covers it',
                                           lease_expires_at = null, updated_at = now() where id = ${id}`);
      return 'cancelled' as const;
    }
    await tx.execute(sql`
      update jobs set status = 'queued', attempts = greatest(attempts - 1, 0), run_at = now(), locked_by = null, locked_at = null,
                      lease_expires_at = null, heartbeat_at = null, started_at = null, updated_at = now()
       where id = ${id}`);
    return 'queued' as const;
  });
}

/** B3: what the reaper says on an Outbox delivery it stopped (it is never requeued: it may have reached the destination). */
export const OUTBOX_REAPED_REASON = 'needs review: the app stopped during an Outbox delivery, which never re-runs on its own (it may have reached the destination)';

/** An Outbox job the reaper stopped: the caller resolves its attempt without writing (src/outbox/job.ts recoverOnly). */
export interface ReapedOutboxJob {
  id: number;
  ownerUserId: string;
  payload: Record<string, unknown>;
}

/**
 * Reaper: running jobs whose lease expired (the worker died, or the laptop slept through it) go back to
 * `queued`, or to `cancelled` (cancel requested / a twin is queued) or `dead` (attempts exhausted).
 * Jobs this worker is actively running are skipped. 2026-11-13 audit B3: an `outbox.*` job is never requeued,
 * whatever its attempts: it goes `dead` ("needs review", with the dead-letter signal) and comes back in `outbox`, so
 * the worker resolves its item without writing again.
 */
export async function reapExpiredLeases(db: Db, opts: { exceptIds?: number[]; limit?: number } = {}): Promise<{ requeued: number; dead: number; cancelled: number; outbox: ReapedOutboxJob[] }> {
  const except = opts.exceptIds?.length
    ? sql`and j.id not in (${sql.join(
        opts.exceptIds.map((i) => sql`${i}::bigint`),
        sql`, `,
      )})`
    : sql``;
  return db.transaction(async (tx) => {
    const expired = await tx.execute<{ id: string; attempts: number; max_attempts: number; cancel: boolean; twin: boolean; kind: string; owner_user_id: string; payload: Record<string, unknown> | null }>(sql`
      select j.id, j.attempts, j.max_attempts, j.cancel_requested_at is not null as cancel, j.kind, j.owner_user_id, j.payload,
             (j.dedupe_key is not null and exists (select 1 from jobs q where q.dedupe_key = j.dedupe_key and q.status = 'queued')) as twin
        from jobs j
       where j.status = 'running' and j.lease_expires_at < now() ${except}
       order by j.lease_expires_at
       limit ${opts.limit ?? 200}
       for update skip locked`);
    let requeued = 0;
    let dead = 0;
    let cancelled = 0;
    const outbox: ReapedOutboxJob[] = [];
    for (const j of expired.rows) {
      const id = Number(j.id);
      if (j.kind.startsWith('outbox.')) {
        await tx.execute(sql`update jobs set status = 'dead', dead_at = now(), dead_reason = ${OUTBOX_REAPED_REASON}, finished_at = now(), lease_expires_at = null,
                                             last_error_class = 'transient', last_error_code = 'lease_expired', last_failed_at = now(), updated_at = now()
                              where id = ${id}`);
        await deadLetterSignals(tx, { id, kind: j.kind, ownerUserId: j.owner_user_id, errorClass: 'transient', code: 'lease_expired', reason: OUTBOX_REAPED_REASON });
        outbox.push({ id, ownerUserId: j.owner_user_id, payload: j.payload ?? {} });
        dead++;
      } else if (j.cancel || j.twin) {
        await tx.execute(sql`update jobs set status = 'cancelled', finished_at = now(), lease_expires_at = null, updated_at = now(),
                                             cancel_reason = coalesce(cancel_reason, ${j.cancel ? 'lease expired after cancel' : 'lease expired; a queued job covers it'})
                              where id = ${id}`);
        cancelled++;
      } else if (Number(j.attempts) >= Number(j.max_attempts)) {
        const reason = 'lease expired after the final attempt';
        await tx.execute(sql`update jobs set status = 'dead', dead_at = now(), dead_reason = ${reason}, finished_at = now(), lease_expires_at = null,
                                             last_error_class = 'transient', last_error_code = 'lease_expired', last_failed_at = now(), updated_at = now()
                              where id = ${id}`);
        await deadLetterSignals(tx, { id, kind: j.kind, ownerUserId: j.owner_user_id, errorClass: 'transient', code: 'lease_expired', reason });
        dead++;
      } else {
        await tx.execute(sql`update jobs set status = 'queued', run_at = now(), locked_by = null, locked_at = null, lease_expires_at = null,
                                             heartbeat_at = null, started_at = null, last_error_class = 'transient', last_error_code = 'lease_expired',
                                             last_failed_at = now(), updated_at = now()
                              where id = ${id}`);
        requeued++;
      }
    }
    return { requeued, dead, cancelled, outbox };
  });
}

/** Health page "Retry": dead → queued with a fresh attempt budget. */
export async function retryDeadJob(db: DbOrTx, id: number): Promise<boolean> {
  const res = await db.execute(sql`
    update jobs set status = 'queued', attempts = 0, dead_at = null, dead_reason = null, run_at = now(), locked_by = null,
                    lease_expires_at = null, finished_at = null, updated_at = now()
     where id = ${id} and status = 'dead'
       and not (dedupe_key is not null and exists (select 1 from jobs q where q.dedupe_key = jobs.dedupe_key and q.status = 'queued'))`);
  return (res.rowCount ?? 0) > 0;
}

/** Cancel a queued job (user cancel, or a schedule paused). Running jobs get a cancel request instead (NOTIFY). */
export async function requestCancel(db: DbOrTx, idOrDedupeKey: string, reason: string): Promise<number> {
  const byId = /^\d+$/.test(idOrDedupeKey);
  const where = byId ? sql`id = ${Number(idOrDedupeKey)}` : sql`dedupe_key = ${idOrDedupeKey}`;
  const q = await db.execute(sql`update jobs set status = 'cancelled', finished_at = now(), cancel_reason = ${reason}, updated_at = now()
                                  where ${where} and status = 'queued'`);
  const r = await db.execute(sql`update jobs set cancel_requested_at = now(), cancel_reason = ${reason}, updated_at = now()
                                  where ${where} and status = 'running' and cancel_requested_at is null`);
  return (q.rowCount ?? 0) + (r.rowCount ?? 0);
}
