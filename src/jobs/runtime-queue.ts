/**
 * BE-2a's runtime `JobQueue` (src/scanner/runtime/jobs.ts) over the Postgres `jobs` table.
 *
 * One RuntimeJob = one row: kind and queue `scan.<connector>` (or `scan.reconcile`), payload = the job,
 * `dedupe_key`, `priority`, `run_at`. A second enqueue of a queued key coalesces like InMemoryJobQueue: the
 * earliest run_at, the highest priority, and an incremental scan window widened to the later `to`.
 */
import { sql } from 'drizzle-orm';

import type { Db, DbOrTx } from '@/db/client';
import { mapPgError } from '@/db/errors';
import type { JobQueue, RuntimeJob } from '@/scanner/runtime/jobs';

import { QUEUES } from './registry';

export const kindOfRuntimeJob = (j: RuntimeJob) => (j.kind === 'scan' ? `scan.${j.connector}` : 'scan.reconcile');
export const queueOfRuntimeJob = (j: RuntimeJob) => (j.kind === 'scan' ? QUEUES.scan(j.connector) : QUEUES.reconcile);

export interface PgRuntimeJobQueueOptions {
  /** Max run time before the lease is considered lost (LLM steps run up to ~3 min). */
  timeoutSeconds?: number;
  /** Job-level attempts (scan-level retries are the runtime's `retryAt` / follow-ups). */
  maxAttempts?: number;
}

export class PgRuntimeJobQueue implements JobQueue {
  constructor(
    private readonly db: Db,
    private readonly userId: string,
    private readonly opts: PgRuntimeJobQueueOptions = {},
  ) {}

  async enqueue(jobs: RuntimeJob[], tx?: DbOrTx): Promise<void> {
    for (const j of jobs) await this.upsert(tx ?? this.db, j);
  }

  private async upsert(db: DbOrTx, j: RuntimeJob): Promise<void> {
    const runAt = Number.isFinite(Date.parse(j.runAt)) ? new Date(j.runAt).toISOString() : new Date().toISOString();
    try {
      await db.execute(sql`
        insert into jobs (owner_user_id, queue, kind, payload, priority, run_at, max_attempts, timeout_seconds, dedupe_key)
        values (${this.userId}, ${queueOfRuntimeJob(j)}, ${kindOfRuntimeJob(j)}, ${JSON.stringify(j)}::jsonb,
                ${Math.max(-32768, Math.min(32767, Math.trunc(j.priority)))}, ${runAt}::timestamptz,
                ${this.opts.maxAttempts ?? 3}, ${this.opts.timeoutSeconds ?? 900}, ${j.dedupeKey})
        on conflict (dedupe_key) where status = 'queued'
        do update set
          run_at   = least(jobs.run_at, excluded.run_at),
          priority = greatest(jobs.priority, excluded.priority),
          payload  = case
                       when jobs.payload->>'kind' = 'scan' and excluded.payload->>'kind' = 'scan'
                        and (excluded.payload#>>'{window,to}') > (jobs.payload#>>'{window,to}')
                       then jsonb_set(jobs.payload, '{window,to}', excluded.payload#>'{window,to}')
                       else jobs.payload end,
          updated_at = now()`);
    } catch (e) {
      throw mapPgError(e);
    }
  }
}
