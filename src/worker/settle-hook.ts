/**
 * SETTLE-1: queue the Settle pass. Nothing runs while the first scan is still reading history (its items are judged
 * together once it is done, against everything recorded); afterwards one pass every ten minutes judges what changed.
 * The job's dedupe key keeps a single pass queued or running.
 */
import type { Db } from '@/db/client';
import { enqueueSettleCheck } from '@/jobs/handlers/settle';
import { readFirstScanFile } from '@/server/datasource/db/first-scan';

export interface SettleHookDeps {
  readState?: () => { status?: string } | null;
  everyMs?: number;
}

export function settleHook(db: Db, userId: string, log: (msg: string, f?: Record<string, unknown>) => void, deps: SettleHookDeps = {}) {
  let announced = false;
  return {
    name: 'settle',
    everyMs: deps.everyMs ?? 10 * 60_000,
    run: async () => {
      try {
        const st = (deps.readState ?? readFirstScanFile)();
        // Only once the first scan is done: a missing state file means it hasn't been planned yet, not that it finished.
        if (st?.status !== 'done') return;
        const queued = await enqueueSettleCheck(db, userId, { trigger: announced ? 'interval' : 'first_scan' });
        if (queued && !announced) log('settle: queued the first Settle pass (SETTLE-1)');
        announced = true;
      } catch (err) {
        log('settle: could not queue a pass', { code: (err as Error).name });
      }
    },
  };
}
