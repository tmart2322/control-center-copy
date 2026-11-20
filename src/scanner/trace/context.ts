/**
 * Correlation context for the worker (AUDIT): which job, run, connector and scope the current async work belongs to.
 *
 * The job runtime opens one per job (jobId, kind), the scanner runtime narrows it per scan (connector, scope, budget)
 * and stamps the run id once `startRun` returned it. Readers:
 *  - worker log lines (every line about a run carries runId, jobId, connector and scope),
 *  - spend attribution (`llm_calls.job_id` and `budget` when the caller did not say).
 * Nothing in here changes behavior: outside a context every reader gets `undefined`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceContext {
  jobId?: number;
  jobKind?: string;
  runId?: string;
  connector?: string;
  scope?: string;
  /** Which LLM budget the work spends: the daily cap or the one-time first-scan budget (B-080). */
  budget?: 'daily' | 'first_scan';
}

const als = new AsyncLocalStorage<TraceContext>();

/** Run `fn` in a child context: the parent's fields plus `ctx`. */
export function withTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  const parent = als.getStore();
  return als.run({ ...parent, ...stripUndefined(ctx) }, fn);
}

export function traceContext(): TraceContext | undefined {
  return als.getStore();
}

/** Stamp fields on the current context (e.g. the run id once the run exists). No-op outside a context. */
export function annotateTraceContext(patch: TraceContext): void {
  const s = als.getStore();
  if (s) Object.assign(s, stripUndefined(patch));
}

/** The correlation fields for a log line (only those known). */
export function logFields(): Record<string, string | number> {
  const s = als.getStore();
  if (!s) return {};
  const out: Record<string, string | number> = {};
  if (s.runId) out.runId = s.runId;
  if (s.jobId !== undefined) out.jobId = s.jobId;
  if (s.connector) out.connector = s.connector;
  if (s.scope) out.scope = s.scope;
  return out;
}

function stripUndefined<T extends object>(o: T): T {
  const out = {} as T;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
