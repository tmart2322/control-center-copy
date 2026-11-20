/**
 * Runtime jobs and the job-queue adapter. Free of DB code: BE-1 maps `RuntimeJob` onto its Postgres
 * `jobs` table (kind = `scan.<connector>` | `scan.reconcile`, payload = the job, `dedupe_key`,
 * `priority`, `run_at`) and calls `ScannerRuntime.executeJob(job, signal)` for each dequeued row.
 */
import type { ConnectorHealthProbe, ConnectorId, ScanTrigger, TimeWindow } from '../types';

export type ScanJobMode = 'incremental' | 'head' | 'backfill' | 'continuation' | 'targeted' | 'manual' | 'retry';
export type ReconcilePass = 'coverage_gaps' | 'unlinked' | 'stale_active' | 'skill_upgrade';

/** Priorities (higher first): user/chat > head > live poll > continuation > backfill > reconcile. */
export const PRIORITY = { manual: 100, head: 80, incremental: 60, continuation: 55, retry: 50, targeted: 45, backfill: 40, reconcile: 20 } as const;

export interface ScanJob {
  kind: 'scan';
  /** Deterministic id: identical plans produce identical ids (exactly-once enqueue). */
  id: string;
  connector: ConnectorId;
  scope: string;
  window: TimeWindow;
  mode: ScanJobMode;
  trigger: ScanTrigger;
  priority: number;
  runAt: string;
  /** At most one queued job per key. Incremental polls coalesce; backfill chunks are unique. */
  dedupeKey: string;
  attempt?: number;
  /** ORG-7: times this job was held before it ran (a hold is not an attempt). */
  held?: number;
  model?: string;
  vars?: Record<string, string>;
  instruction?: string;
  /** B-080: a first-scan backfill job spends the one-time first-scan budget, not the daily cap. */
  budget?: 'first_scan';
}

export interface ReconcileJob {
  kind: 'reconcile';
  id: string;
  passes: ReconcilePass[];
  connector?: ConnectorId;
  trigger: ScanTrigger;
  priority: number;
  runAt: string;
  dedupeKey: string;
  /** For skill_upgrade: which scopes and versions. */
  upgrades?: Array<{ connector: ConnectorId; scope: string; fromVersion: string; toVersion: string }>;
}

export type RuntimeJob = ScanJob | ReconcileJob;

/** The job to enqueue after an outcome with `retryAt`: a held job keeps its attempt (ORG-7), a retry counts one. */
export function retryJobOf(job: ScanJob, out: Pick<JobOutcome, 'retryAt' | 'held'>): ScanJob {
  if (out.held) {
    const held = (job.held ?? 0) + 1;
    return { ...job, runAt: out.retryAt!, held, dedupeKey: `${job.dedupeKey.replace(/#held\d+$/, '')}#held${held}` };
  }
  return { ...job, runAt: out.retryAt!, attempt: (job.attempt ?? 0) + 1, dedupeKey: `${job.dedupeKey}#retry` };
}

export interface JobOutcome {
  status: 'succeeded' | 'failed' | 'skipped' | 'paused';
  runId?: string;
  errorClass?: ConnectorHealthProbe['errorClass'];
  /** Retry the same job at this time (null/undefined = no automatic retry). */
  retryAt?: string;
  /** ORG-7: the job did not run (held until a prerequisite is ready): run it again at `retryAt`, attempt unchanged. */
  held?: boolean;
  /** Jobs to enqueue next (continuations, split windows, targeted rescans). */
  followUps: RuntimeJob[];
  touchedWorkItemIds?: string[];
  costUsd?: number;
  detail?: string;
}

export function scanJob(input: Omit<ScanJob, 'kind' | 'id' | 'dedupeKey' | 'priority'> & { priority?: number; dedupeKey?: string }): ScanJob {
  const id = `scan:${input.connector}:${input.scope}:${input.mode}:${input.window.from}:${input.window.to}`;
  const dedupeKey = input.dedupeKey ?? (input.mode === 'incremental' ? `scan:${input.connector}:${input.scope}` : id);
  return { kind: 'scan', ...input, id, dedupeKey, priority: input.priority ?? PRIORITY[input.mode === 'manual' ? 'manual' : input.mode] };
}

/** What the runtime needs from a queue. BE-1 implements it over Postgres (`jobs` + SKIP LOCKED). */
export interface JobQueue {
  enqueue(jobs: RuntimeJob[]): Promise<void>;
}

/** In-process queue for standalone/dev runs and tests: dedupe on queued key, priority then runAt then FIFO. */
export class InMemoryJobQueue implements JobQueue {
  private seq = 0;
  private readonly queued: Array<{ job: RuntimeJob; seq: number }> = [];

  async enqueue(jobs: RuntimeJob[]): Promise<void> {
    for (const job of jobs) {
      const dup = this.queued.find((q) => q.job.dedupeKey === job.dedupeKey);
      if (dup) {
        // Coalesce: keep the earliest runAt and the highest priority; widen an incremental window.
        if (job.runAt < dup.job.runAt) dup.job.runAt = job.runAt;
        if (job.priority > dup.job.priority) dup.job.priority = job.priority;
        if (dup.job.kind === 'scan' && job.kind === 'scan' && job.window.to > dup.job.window.to) dup.job.window = { from: dup.job.window.from, to: job.window.to };
        continue;
      }
      this.queued.push({ job: structuredClone(job), seq: this.seq++ });
    }
  }

  /** Next due job, skipping connectors in `busy`. */
  dequeue(now: Date, busy: Set<string> = new Set()): RuntimeJob | undefined {
    const t = now.getTime();
    const due = this.queued
      .filter((q) => Date.parse(q.job.runAt) <= t && !(q.job.kind === 'scan' && busy.has(q.job.connector)))
      .sort((a, b) => b.job.priority - a.job.priority || Date.parse(a.job.runAt) - Date.parse(b.job.runAt) || a.seq - b.seq);
    const next = due[0];
    if (!next) return undefined;
    this.queued.splice(this.queued.indexOf(next), 1);
    return next.job;
  }

  peek(): RuntimeJob[] {
    return this.queued.map((q) => q.job);
  }
  size(): number {
    return this.queued.length;
  }
  nextRunAt(): string | undefined {
    return this.queued.map((q) => q.job.runAt).sort()[0];
  }
}

/** Per-key async mutex: one active run per connector (SCANNER.md §7). */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly held = new Set<string>();

  isHeld(key: string): boolean {
    return this.held.has(key);
  }

  async acquire(key: string, signal?: AbortSignal): Promise<() => void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => mine);
    this.tails.set(key, tail);
    await Promise.race([
      prev,
      new Promise<void>((_, reject) => {
        if (signal?.aborted) reject(new Error('aborted'));
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    ]).catch((e) => {
      release();
      throw e;
    });
    this.held.add(key);
    return () => {
      this.held.delete(key);
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}
