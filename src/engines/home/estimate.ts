/**
 * Per-item hands-on minutes for Home labels ("you ~20m"), from the priority engine's estimator
 * (src/engines/priority/estimate.ts, owned by CAPACITY) so Home and Today never disagree.
 * Day totals (youMinToday, freeMin, fits…) are NOT computed here: they arrive as `HomeInput.capacity`
 * (mock: `mockCapacity(store, now)`; db: `todayCapacity(model, now)`).
 *
 * Pure. Agent minutes are reported separately and never added (UI-SPEC §1.8).
 */
import type { WorkItem } from '@/contract';
import { approveBatchMin, estimateYouMin, kindYouMin, makeEstimator, type Estimator } from '@/engines/priority/estimate';

const DEFAULT_ESTIMATOR: Estimator = makeEstimator();

/** Your hands-on minutes for one item (0 while it waits on someone else). */
export function handsOnMin(item: Pick<WorkItem, 'kind' | 'state' | 'title' | 'effort'>, est: Estimator = DEFAULT_ESTIMATOR): number {
  if (item.state === 'waiting_on_others') return 0;
  return estimateYouMin({ kind: item.kind, title: item.title, effort: item.effort }, est).youMin;
}

/** Background agent minutes for one item (never counted against the day). */
export function agentMin(item: Pick<WorkItem, 'state' | 'effort'>): number {
  if (item.state === 'waiting_on_others') return 0;
  return Math.max(0, item.effort.agentMin);
}

/** Approving N drafts in one sitting. */
export function approveMin(n: number, est: Estimator = DEFAULT_ESTIMATOR): number {
  return approveBatchMin(n, est);
}

/** Re-authenticating a connector. */
export function reauthMin(est: Estimator = DEFAULT_ESTIMATOR): number {
  return kindYouMin('reauth', est);
}
