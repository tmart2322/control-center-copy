/**
 * `completion.check` (queue `completion`, concurrency 1): the completion pass (CMP-1, docs/ui/SCANNER.md §4.9).
 *
 * Enqueued after a scan run that stored new source items (src/worker/scanning.ts afterRun), at worker start and
 * on wake (catch-up after downtime), and as its own follow-up when a pass hit its per-pass caps. One queued job
 * per user (`completion.check:<user>`): a scan finishing while one is queued adds nothing, because the job reads
 * its window at run time, from the last pass's watermark to now. The watermark lives in the latest succeeded
 * job's `result.watermark` (like reevaluate's `result.reeval`), so a restart resumes exactly where it stopped.
 *
 * The pass emits `completion` / `progress` evidence only; `reevaluate` and the closure machine decide. jobs.result
 * holds counts, ids and codes, never message text or model reasons.
 */
import { sql } from 'drizzle-orm';

import type { Db, DbOrTx } from '@/db/client';
import { enqueueJob } from '@/db/queue';
import { pgReevaluateEnqueuer } from '@/jobs/scan';
import type { JobHandler, JobHandlerDef } from '@/jobs/types';
import { agentSdkCompletionModel, runCompletionPass, type CompletionLimits, type CompletionModel, type CompletionStore, type CompletionWatermark } from '@/scanner/completion';
import { DbScannerStore } from '@/scanner/store-db';

export const COMPLETION_JOB_KIND = 'completion.check';
export const COMPLETION_QUEUE = 'completion';
export const completionDedupeKey = (userId: string) => `completion.check:${userId}`;

export type CompletionTrigger = 'scan' | 'catch_up' | 'follow_up' | 'manual';

/**
 * Queue one check unless one is already queued for the user (its window is read when it runs, so it already
 * covers what this scan stored). Returns whether a job was inserted.
 */
export async function enqueueCompletionCheck(
  db: DbOrTx,
  userId: string,
  o: { trigger: CompletionTrigger; connector?: string; runId?: string; delaySeconds?: number } = { trigger: 'scan' },
): Promise<boolean> {
  const key = completionDedupeKey(userId);
  const queued = await db.execute<{ id: string }>(sql`select id from jobs where dedupe_key = ${key} and status = 'queued' limit 1`);
  if (queued.rows[0]) return false;
  const r = await enqueueJob(db, {
    ownerUserId: userId,
    kind: COMPLETION_JOB_KIND,
    queue: COMPLETION_QUEUE,
    dedupeKey: key,
    payload: { trigger: o.trigger, ...(o.connector ? { connector: o.connector } : {}), ...(o.runId ? { run_id: o.runId } : {}) },
    delaySeconds: o.delaySeconds ?? 20,
    maxAttempts: 3,
    timeoutSeconds: 900,
  });
  return r.inserted;
}

/** The watermark of the user's latest succeeded pass (null before the first one). */
export async function lastCompletionWatermark(db: Db, userId: string): Promise<CompletionWatermark | null> {
  const r = await db.execute<{ wm: CompletionWatermark | null }>(sql`
    select result -> 'watermark' as wm from jobs
     where owner_user_id = ${userId} and kind = ${COMPLETION_JOB_KIND} and status = 'succeeded' and result ? 'watermark'
     order by (result -> 'watermark' ->> 'through')::timestamptz desc nulls last, id desc
     limit 1`);
  const wm = r.rows[0]?.wm;
  return wm && typeof wm.through === 'string' ? { through: wm.through, pending: wm.pending && typeof wm.pending === 'object' ? wm.pending : {}, ...(wm.skill ? { skill: wm.skill } : {}) } : null;
}

export interface CompletionHandlerDeps {
  /** The model seam (default: one tool-less Agent SDK turn on the skill's model). */
  model?: CompletionModel;
  /** Store override (tests); default: a DbScannerStore over the job's db and clock. */
  store?: (ctx: Parameters<JobHandler>[0]) => CompletionStore;
  limits?: Partial<CompletionLimits>;
  repoRoot?: string;
}

export function completionHandler(deps: CompletionHandlerDeps = {}): JobHandler {
  let model: CompletionModel | undefined = deps.model;
  return async (ctx) => {
    model ??= agentSdkCompletionModel();
    const store = deps.store?.(ctx) ?? new DbScannerStore({ db: ctx.db, userId: ctx.userId, clock: ctx.clock });
    const watermark = await lastCompletionWatermark(ctx.db, ctx.userId);
    const me = await ctx.db.execute<{ name: string | null }>(sql`select display_name as name from users where id = ${ctx.userId}`);
    const out = await runCompletionPass({
      store,
      model,
      now: ctx.clock(),
      watermark,
      meName: me.rows[0]?.name ?? undefined,
      repoRoot: deps.repoRoot,
      signal: ctx.signal,
      limits: deps.limits,
      reevaluate: pgReevaluateEnqueuer(ctx.db, ctx.userId),
      log: (m, d) => ctx.log(m, d),
      trigger: typeof ctx.job.payload?.trigger === 'string' ? (ctx.job.payload.trigger as string) : 'reconcile',
    });
    let followUp = false;
    if (out.more && !ctx.signal.aborted) followUp = await enqueueCompletionCheck(ctx.db, ctx.userId, { trigger: 'follow_up', delaySeconds: 5 });
    return {
      status: out.status,
      watermark: out.watermark,
      skill: out.skill,
      items: out.items,
      withCandidates: out.withCandidates,
      checked: out.checked,
      calls: out.calls,
      costUsd: Number(out.costUsd.toFixed(6)),
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      verdicts: out.verdicts,
      // ids, roles and confidences only (no reasons: they paraphrase message content)
      signals: out.signals.map((s) => ({ workItemId: s.workItemId, sourceItemId: s.sourceItemId, role: s.role, confidence: s.confidence, gate: s.gate, p: s.modelConfidence, basis: s.basis ?? null, relations: s.relations, evidenceId: s.evidenceId ?? null })),
      runIds: out.runIds,
      errors: out.errors,
      followUp,
    };
  };
}

export function completionJobDef(deps: CompletionHandlerDeps = {}): JobHandlerDef {
  return {
    kind: COMPLETION_JOB_KIND,
    queue: COMPLETION_QUEUE,
    wired: true,
    description: 'completion pass: a cheap model checks new messages against open items and emits completion signals (CMP-1)',
    handler: completionHandler(deps),
  };
}
