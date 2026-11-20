/**
 * `tool.run` (queue `default`, drained by the maintenance pool): HYG-1. Tools ▸ Run records a queued tool run and its
 * Agents-page mirror, then queues this job, but this build has no tool runner (BE-4), so the job dead-lettered
 * ("no handler for tool.run") and the run said "queued" forever. The handler now ends the run in a clear terminal
 * state: failed, "No tool runner in this build", the mirror too. Nothing runs, nothing is sent (invariant 1).
 */
import { sql } from 'drizzle-orm';

import { actors, withChangeSet } from '@/db/changeset';
import { extKey, putKv } from '@/server/datasource/db/ext';

import type { JobHandlerDef } from '../types';

export const TOOL_RUN_JOB_KIND = 'tool.run';
export const NO_TOOL_RUNNER = 'No tool runner in this build: nothing ran';

export function toolRunJobDef(): JobHandlerDef {
  return {
    kind: TOOL_RUN_JOB_KIND,
    queue: 'maintenance',
    wired: true,
    description: 'tool runs: ends a queued run as failed (no tool runner in this build)',
    handler: async (ctx) => {
      const id = (ctx.job.payload as { toolRunId?: unknown }).toolRunId;
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { status: 'skipped', reason: 'bad_payload' };
      const now = ctx.clock().toISOString();
      const ended = await withChangeSet({ db: ctx.db, userId: ctx.userId, actor: actors.system('tool.run'), reason: 'Tool run ended: no tool runner in this build', entity: { type: 'tool_run', id }, undoable: false }, async (tx) => {
        const r = await tx.execute(sql`
          update tool_runs set status = 'failed', finished_at = ${now}::timestamptz, error_code = 'no_runner', error_message = ${NO_TOOL_RUNNER}, updated_at = now()
           where id = ${id}::uuid and owner_user_id = ${ctx.userId} and status in ('queued', 'running')`);
        if (!r.rowCount) return false;
        const key = extKey('tool_runs', id);
        const x = (await tx.execute<{ value: Record<string, unknown> }>(sql`select value from user_settings where owner_user_id = ${ctx.userId} and key = ${key}`)).rows[0]?.value;
        if (x) {
          const mirror = x.agentRun as Record<string, unknown> | undefined;
          const progress = x.progress as Record<string, unknown> | null | undefined;
          await putKv(tx, ctx.userId, key, { ...x, ...(progress ? { progress: { ...progress, label: 'Failed' } } : {}), ...(mirror ? { agentRun: { ...mirror, state: 'failed', finishedAt: now, updatedAt: now, lastEvent: NO_TOOL_RUNNER, error: NO_TOOL_RUNNER } } : {}) }, x);
        }
        return true;
      });
      return { status: ended.result ? 'failed_run' : 'skipped', toolRunId: id };
    },
  };
}
