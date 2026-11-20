/**
 * `hygiene.sweep` (queue `maintenance`): HYG-1, the daily dead-data sweep (src/server/hygiene/sweep.ts). Daily at
 * 04:10 local (src/worker/schedules.ts) and once at every worker start (so the first worker after a deploy cleans the
 * dead data already there, with the same code). jobs.result holds the counts per category and error codes only.
 */
import type { DbOrTx } from '@/db/client';
import { enqueueJob } from '@/db/queue';
import { runHygieneSweep } from '@/server/hygiene/sweep';

import type { JobHandlerDef } from '../types';

export const HYGIENE_JOB_KIND = 'hygiene.sweep';
export const HYGIENE_QUEUE = 'maintenance';

/** The worker-start run (one queued per user; the daily schedule has its own dedupe key). */
export async function enqueueHygieneSweep(db: DbOrTx, userId: string, trigger: 'start' | 'manual'): Promise<{ id: number; inserted: boolean }> {
  return enqueueJob(db, { ownerUserId: userId, kind: HYGIENE_JOB_KIND, queue: HYGIENE_QUEUE, payload: { trigger }, dedupeKey: `hygiene.sweep:${trigger}:${userId}`, delaySeconds: trigger === 'start' ? 60 : 0, maxAttempts: 2, timeoutSeconds: 600 });
}

/** `kinds`: the job kinds the worker's registry handles (read when the job runs, so late registrations count). */
export function hygieneJobDef(o: { kinds?: () => Iterable<string> } = {}): JobHandlerDef {
  return {
    kind: HYGIENE_JOB_KIND,
    queue: HYGIENE_QUEUE,
    wired: true,
    description: 'dead-data sweep: stale drafts, stuck DC requests, dead and unhandled jobs, stuck enrichment, unknown scan scopes, orphaned side-cars',
    handler: async (ctx) => {
      const { counts, errors } = await runHygieneSweep(ctx.db, ctx.userId, { now: ctx.clock(), knownKinds: o.kinds ? new Set(o.kinds()) : undefined, log: ctx.log });
      ctx.log('hygiene: sweep done', { ...counts, errors: errors.length });
      return { ...counts, errors };
    },
  };
}
