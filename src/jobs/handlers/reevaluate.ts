/**
 * `reevaluate` (BE-3, queue `engine`): scanner signals change item state ("auto-completion", R-UI-1/20/22).
 *
 * The scanner saves new evidence first and bumps the item's generation (W2, recordNewInfo); this job then
 * re-evaluates the item: every evidence link since the last evaluation goes through the closure state
 * machine and the re-eval planner, and the decisions are written as one `engine:reeval` change set (audited,
 * undoable, published as live events by the change-set commit hook). See reevaluateWorkItem().
 *
 *   completion, Sure            → done ("Closed for you · Undo"); Likely → likely_done ("Confirm")
 *   requirement after done      → reopen (same deliverable, closed ≤ reopen.window_days) or a sibling
 *   loop_back: on a hand-off    → reopen / "Looped back in" sibling; on a live hand-off, owner again
 *   progress                    → in_progress (open items only)
 *   a user-locked status        → a proposal group; never a write
 *
 * Fences: the worker cancels a job whose generation is already stale before it starts; inside the run the
 * change set is fenced again on the generation and on `cancel_requested_at` (an abort rolls it all back).
 * Follow-up: `nba.generate` for the item (and for a new sibling) after it moved.
 */
import type { JobHandler } from '@/jobs/types';
import { JobError } from '@/jobs/types';
import { reevaluateWorkItem, type ReevaluateOptions, type ReevaluateOutcome } from '@/server/datasource/db/closure';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReevaluateHandlerDeps {
  /** Test seam (see ReevaluateOptions.onStep). */
  onStep?: ReevaluateOptions['onStep'];
  /** How long to wait for the worker's abort after the run found itself superseded (default 3 s). */
  supersededWaitMs?: number;
}

/** The W2 commit that made this run stale also requested its cancel; the worker aborts it on the NOTIFY. */
function waitForAbort(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/** jobs.result: ids, counts and codes only (no source text). `reeval` is the watermark the next run starts after. */
function resultOf(out: ReevaluateOutcome): Record<string, unknown> {
  switch (out.outcome) {
    case 'missing':
      return { outcome: out.outcome, workItemId: out.workItemId };
    case 'stale':
    case 'cancelled':
      return { outcome: out.outcome, workItemId: out.workItemId, reason: out.reason, generation: out.generation, current: out.current };
    default:
      return {
        outcome: out.outcome,
        workItemId: out.workItemId,
        generation: out.generation,
        changeSetId: out.changeSetId,
        newEvidence: out.newEvidence,
        decisions: out.decisions.map((d) => ({ evidenceId: d.evidenceId, kind: d.kind, to: d.to, ruleKey: d.ruleKey })),
        transitions: out.transitions,
        proposalIds: out.proposalIds,
        siblingIds: out.siblingIds,
        followUpJobIds: out.followUpJobIds,
        plan: out.plan,
        ...(out.watermark ? { reeval: out.watermark } : {}),
      };
  }
}

export function reevaluateHandler(deps: ReevaluateHandlerDeps = {}): JobHandler {
  return async (ctx) => {
    const workItemId = ctx.job.payload.work_item_id;
    if (workItemId === undefined || workItemId === null) {
      // Every enqueuer (W2 recordNewInfo, the scanner, proposeItem) sets work_item_id. Rows without it are seed
      // fixtures in the contract Job shape ({entity}): skip them, so they neither dead-letter nor act on fixture data.
      ctx.log('skipped: no work_item_id in the payload', { jobId: ctx.job.id });
      return { outcome: 'skipped', reason: 'no work_item_id' };
    }
    if (typeof workItemId !== 'string' || !UUID.test(workItemId)) {
      throw new JobError(`reevaluate job ${ctx.job.id}: work_item_id is not a uuid`, 'validation', { code: 'bad_payload' });
    }
    const out = await reevaluateWorkItem({
      db: ctx.db,
      userId: ctx.job.ownerUserId || ctx.userId,
      workItemId,
      job: { id: ctx.job.id, generation: ctx.job.generation },
      signal: ctx.signal,
      clock: ctx.clock,
      ...(deps.onStep ? { onStep: deps.onStep } : {}),
    });
    if (out.outcome === 'stale' || out.outcome === 'cancelled') await waitForAbort(ctx.signal, deps.supersededWaitMs ?? 3000);
    const result = resultOf(out);
    ctx.log(`${out.outcome}`, {
      workItemId,
      generation: ctx.job.generation,
      ...('transitions' in out ? { transitions: out.transitions, proposals: out.proposalIds.length, siblings: out.siblingIds.length, changeSetId: out.changeSetId } : {}),
    });
    return result;
  };
}
