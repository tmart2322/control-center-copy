/**
 * Re-eval orchestration semantics (R-UI-20, DATA-MODEL §1.4 W2/W3, §4.5 jobs):
 *  - coalesce: bursts of new info become one job per item (debounced, with a max wait);
 *  - nextGeneration: new info during a run bumps the generation, requests cancel of the running job
 *    and coalesces into (or enqueues) the next one;
 *  - shouldCommit: a stale-generation job never writes (the fence), a version conflict re-runs.
 * Pure functions; the worker applies the outputs in the W2/W3 transactions.
 */
import type { ChangeKind, ReevalEvent } from '@/engines/types';
import { CHANGE_KINDS } from '@/engines/types';

const toMs = (iso: string): number => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`invalid instant: ${iso}`);
  return t;
};
const toIso = (ms: number): string => new Date(ms).toISOString();

export const reevalDedupeKey = (workItemId: string): string => `reeval:work_item:${workItemId}`;

/** Change kinds that count as new info on the item (badge + `unseen_evidence_count`). */
export const NEW_INFO_CHANGES: ReadonlySet<ChangeKind> = new Set<ChangeKind>([
  'evidence_origin',
  'evidence_progress',
  'evidence_completion',
  'evidence_context',
  'evidence_contradiction',
  'requirements_change',
  'loop_back',
  'session_status',
  'drive_digest',
  'reply',
  'email_sent',
]);

const canonical = (changes: Iterable<ChangeKind>): ChangeKind[] => {
  const set = new Set(changes);
  return CHANGE_KINDS.filter((c) => set.has(c));
};

// ---------------------------------------------------------------------------
// coalesce
// ---------------------------------------------------------------------------

export interface ReevalJob {
  dedupeKey: string;
  workItemId: string;
  /** Debounced: last event + debounce, but never later than first event + maxWait. */
  runAt: string;
  /** The generation this job must match to commit (W3 fence). */
  generation: number;
  changes: ChangeKind[];
  eventCount: number;
  firstEventAt: string;
  lastEventAt: string;
  evidenceIds: string[];
}

export interface CoalesceOptions {
  /** Cap so a steady stream can't starve the item. Default 10 × debounce. */
  maxWaitMs?: number;
  /** Generation before the first event, per item, when events don't carry one. */
  baseGenerations?: Record<string, number>;
}

/**
 * Bursts become one job per item: events for the same item within `debounceMs` of the previous one
 * (and within `maxWaitMs` of the burst's first) merge. Output is sorted by runAt, then item id.
 */
export function coalesce(events: ReevalEvent[], debounceMs: number, opts: CoalesceOptions = {}): ReevalJob[] {
  if (debounceMs < 0) throw new Error('debounceMs must be ≥ 0');
  const maxWait = opts.maxWaitMs ?? debounceMs * 10;
  const byItem = new Map<string, Array<{ e: ReevalEvent; i: number }>>();
  events.forEach((e, i) => {
    const list = byItem.get(e.workItemId) ?? [];
    list.push({ e, i });
    byItem.set(e.workItemId, list);
  });
  const jobs: ReevalJob[] = [];
  for (const [workItemId, list] of [...byItem.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => toMs(a.e.at) - toMs(b.e.at) || a.i - b.i);
    let gen = opts.baseGenerations?.[workItemId] ?? 0;
    let cur: { first: number; last: number; gen: number; changes: ChangeKind[]; count: number; evidence: string[] } | null = null;
    const close = () => {
      if (!cur) return;
      const runAt = Math.min(cur.last + debounceMs, cur.first + Math.max(maxWait, 0));
      jobs.push({
        dedupeKey: reevalDedupeKey(workItemId),
        workItemId,
        runAt: toIso(Math.max(runAt, cur.last)),
        generation: cur.gen,
        changes: canonical(cur.changes),
        eventCount: cur.count,
        firstEventAt: toIso(cur.first),
        lastEventAt: toIso(cur.last),
        evidenceIds: cur.evidence,
      });
      cur = null;
    };
    for (const { e } of list) {
      const at = toMs(e.at);
      gen = e.generation ?? gen + 1;
      if (cur && at - cur.last <= debounceMs && at - cur.first <= maxWait) {
        cur.last = at;
        cur.gen = Math.max(cur.gen, gen);
        cur.changes.push(e.change);
        cur.count++;
        if (e.evidenceId && !cur.evidence.includes(e.evidenceId)) cur.evidence.push(e.evidenceId);
      } else {
        close();
        cur = { first: at, last: at, gen, changes: [e.change], count: 1, evidence: e.evidenceId ? [e.evidenceId] : [] };
      }
    }
    close();
  }
  return jobs.sort((a, b) => toMs(a.runAt) - toMs(b.runAt) || a.workItemId.localeCompare(b.workItemId) || a.generation - b.generation);
}

// ---------------------------------------------------------------------------
// nextGeneration (W2)
// ---------------------------------------------------------------------------

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'dead' | 'cancelled';

/** The slice of a `jobs` row the semantics need. */
export interface JobState {
  id: string;
  workItemId: string;
  status: JobStatus;
  generation: number;
  runAt: string;
  cancelRequestedAt?: string | null;
  /** The item version the job read when it started (W3 fences on it too). */
  baseVersion?: number;
  changes?: ChangeKind[];
}

export interface ItemGenerationState {
  id: string;
  reevalGeneration: number;
  version: number;
  unseenEvidenceCount?: number;
  lastNewInfoAt?: string | null;
}

export interface NextGenerationResult {
  generation: number;
  /** Written in the same transaction that saved the new info. */
  itemPatch: { reevalGeneration: number; lastNewInfoAt: string | null; unseenEvidenceCount: number };
  /** Running jobs to cancel (`cancel_requested_at`, `pg_notify('cc_job_cancel')`). Their writes are fenced anyway. */
  cancel: Array<{ jobId: string; reason: string }>;
  /** Running jobs this generation supersedes (`superseded_by_id` = the queued job once it exists). */
  supersede: string[];
  /** Coalesce into the queued job (ON CONFLICT … DO UPDATE) or insert a new one. */
  enqueue: {
    mode: 'insert' | 'coalesce';
    jobId: string | null;
    dedupeKey: string;
    generation: number;
    runAt: string;
    supersedesRunning: true;
    changes: ChangeKind[];
  };
}

export function nextGeneration(
  item: ItemGenerationState,
  opts: { jobs: JobState[]; now: string; debounceMs: number; change: ChangeKind; evidenceId?: string },
): NextGenerationResult {
  const generation = item.reevalGeneration + 1;
  const isNewInfo = NEW_INFO_CHANGES.has(opts.change);
  const mine = opts.jobs.filter((j) => j.workItemId === item.id);
  const running = mine.filter((j) => j.status === 'running' && !j.cancelRequestedAt);
  const queued = mine.find((j) => j.status === 'queued');
  const runAt = toIso(toMs(opts.now) + opts.debounceMs);
  return {
    generation,
    itemPatch: {
      reevalGeneration: generation,
      lastNewInfoAt: isNewInfo ? opts.now : (item.lastNewInfoAt ?? null),
      unseenEvidenceCount: (item.unseenEvidenceCount ?? 0) + (isNewInfo ? 1 : 0),
    },
    cancel: running.map((j) => ({ jobId: j.id, reason: `superseded by generation ${generation}` })),
    supersede: running.map((j) => j.id),
    enqueue: queued
      ? {
          mode: 'coalesce',
          jobId: queued.id,
          dedupeKey: reevalDedupeKey(item.id),
          generation,
          // Debounce: each burst pushes the run out.
          runAt: toMs(runAt) > toMs(queued.runAt) ? runAt : queued.runAt,
          supersedesRunning: true,
          changes: canonical([...(queued.changes ?? []), opts.change]),
        }
      : { mode: 'insert', jobId: null, dedupeKey: reevalDedupeKey(item.id), generation, runAt, supersedesRunning: true, changes: [opts.change] },
  };
}

// ---------------------------------------------------------------------------
// shouldCommit (W3 fence)
// ---------------------------------------------------------------------------

export type CommitVerdict =
  | { commit: true; reason: 'ok'; retry: false }
  | { commit: false; reason: 'cancel_requested' | 'stale_generation' | 'future_generation'; retry: false }
  | { commit: false; reason: 'version_conflict'; retry: true };

/**
 * May this job's result be written? Mirrors W3: `WHERE reeval_generation = $gen AND version = $v`.
 * - cancel requested / stale generation: drop it (a newer job covers the latest state);
 * - version conflict (the user edited mid-run): re-read and re-run at the same generation.
 */
export function shouldCommit(
  job: Pick<JobState, 'generation' | 'cancelRequestedAt' | 'baseVersion'>,
  item: Pick<ItemGenerationState, 'reevalGeneration' | 'version'>,
): CommitVerdict {
  if (job.cancelRequestedAt) return { commit: false, reason: 'cancel_requested', retry: false };
  if (job.generation < item.reevalGeneration) return { commit: false, reason: 'stale_generation', retry: false };
  if (job.generation > item.reevalGeneration) return { commit: false, reason: 'future_generation', retry: false };
  if (job.baseVersion !== undefined && job.baseVersion !== item.version) return { commit: false, reason: 'version_conflict', retry: true };
  return { commit: true, reason: 'ok', retry: false };
}
