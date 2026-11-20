/**
 * `nba.generate` (queue `nba`): the guard in front of next-best-action generation (B-058).
 *
 * Its enqueuers (the re-eval follow-ups in db/closure.ts) target an item or a sibling the same pass created.
 * An Undo of that pass deletes the sibling while its NBA job may still be queued. A job whose work item is
 * gone succeeds quietly with `{ outcome: 'skipped', skipped: 'gone' }`: no retry, no dead letter, nothing
 * generated. Every other job goes to `generate`, the "not yet wired" stub until BE-4 passes the real one in
 * (`nbaGenerateHandler(realGenerate)`), so the guard stays in front of it.
 */
import { sql } from 'drizzle-orm';

import { notWired } from '@/jobs/registry';
import type { JobHandler } from '@/jobs/types';
import { JobError } from '@/jobs/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nbaGenerateHandler<S = unknown>(generate: JobHandler<S> = notWired<S>('nba.generate', 'BE-4')): JobHandler<S> {
  return async (ctx) => {
    const workItemId = ctx.job.payload.work_item_id;
    // Seed fixtures in the contract Job shape carry `{entity}` and no work_item_id: nothing to check.
    if (workItemId === undefined || workItemId === null) return generate(ctx);
    if (typeof workItemId !== 'string' || !UUID.test(workItemId)) {
      throw new JobError(`nba.generate job ${ctx.job.id}: work_item_id is not a uuid`, 'validation', { code: 'bad_payload' });
    }
    const found = await ctx.db.execute(sql`select 1 from work_items where id = ${workItemId}`);
    if (!found.rows.length) {
      ctx.log('skipped: work item gone', { jobId: ctx.job.id, workItemId });
      return { outcome: 'skipped', skipped: 'gone', workItemId };
    }
    return generate(ctx);
  };
}
