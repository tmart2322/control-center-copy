/**
 * Scan run trace (AUDIT): an append-only, ordered decision trail per scan run, in `scan_run_events`.
 *
 *   trace(runId, 'tool_call', { tool, args, ms, size, error })      sync, never throws, never awaits the database
 *
 * Why: the scanners recorded what happened (scan_runs, the ledger, llm_calls, audit_events) but not why they decided
 * it, so "why wasn't this picked up?" took detective work. The trace says what the run planned, every tool call and
 * its result size, what REC-1 recorded, each triage verdict and its reason, what it proposed and linked (with the
 * evidence ids), the prompt size against the tripwire, retries, spend and the outcome.
 *
 * Rules (tenet: Local data, privacy-safe logs): ids, counts, codes, durations and short reasons only. Strings are
 * credential-redacted and clipped (160 characters; a query 300). Message text stays in `source_items`.
 * Behavior-neutral: events are buffered in memory and written by a sink in the background. A trace failure (a full
 * buffer, a database error) drops events and is logged once a minute; it never fails, slows or changes a run.
 *
 * The worker installs the database sink (`installDbTraceSink`); everywhere else (the web, tests by default) the
 * trace is a no-op unless a sink is set.
 */
import { redact } from '../../llm/redact';
import type { TraceEvent, TraceKind, TraceSink } from './types';

const MAX_STRING = 160;
const LONG_KEYS = new Set(['query', 'q', 'args', 'message']);
const MAX_LONG = 300;

let sink: TraceSink | null = null;
const seqs = new Map<string, number>();

/** Install (or clear) the process-wide sink. Returns the previous one. */
export function setTraceSink(s: TraceSink | null): TraceSink | null {
  const prev = sink;
  sink = s;
  return prev;
}

export function traceSink(): TraceSink | null {
  return sink;
}

/** Next sequence number of a run (per process; runs never span processes). */
function nextSeq(runId: string): number {
  const n = (seqs.get(runId) ?? 0) + 1;
  seqs.set(runId, n);
  if (seqs.size > 2000) {
    // Oldest first (insertion order): runs finished long ago.
    for (const k of [...seqs.keys()].slice(0, 500)) seqs.delete(k);
  }
  return n;
}

/**
 * One trace event. `runId` must be a scan_runs id (anything else, e.g. an in-memory store's run id, is ignored by the
 * database sink). Never throws.
 */
export function trace(
  runId: string | undefined | null,
  kind: TraceKind,
  payload: Record<string, unknown> | (() => Record<string, unknown>) = {},
  refs: { sourceItemId?: string | null; workItemId?: string | null } = {},
): void {
  if (!sink || !runId) return;
  try {
    // A function payload is only computed when a sink listens, and an error computing it is swallowed like any other.
    const p = typeof payload === 'function' ? payload() : payload;
    const e: TraceEvent = { runId, seq: nextSeq(runId), ts: new Date().toISOString(), kind, payload: cleanPayload(p) };
    if (refs.sourceItemId) e.sourceItemId = refs.sourceItemId;
    if (refs.workItemId) e.workItemId = refs.workItemId;
    sink.write(e);
  } catch {
    /* a trace never fails a run */
  }
}

/** Flush the sink (end of a run, shutdown). Never throws. */
export async function flushTrace(): Promise<void> {
  try {
    await sink?.flush();
  } catch {
    /* ignore */
  }
}

/** Redacted, clipped, bounded copy: at most 40 keys, 50 array items, depth 4. */
export function cleanPayload(v: Record<string, unknown>): Record<string, unknown> {
  return clean(v, 0, '') as Record<string, unknown>;
}

function clean(v: unknown, depth: number, key: string): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === 'string') {
    const max = LONG_KEYS.has(key) ? MAX_LONG : MAX_STRING;
    const t = redact(v.length > max * 2 ? v.slice(0, max * 2) : v).text.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
  if (typeof v === 'boolean') return v;
  if (depth >= 4) return '[…]';
  // Id lists (`ids`, `trivialIds`, …) keep up to 200 entries: "was this message seen?" reads them.
  if (Array.isArray(v)) return v.slice(0, key === 'ids' || key.endsWith('Ids') ? 200 : 50).map((x) => clean(x, depth + 1, key));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) if (x !== undefined) out[k] = clean(x, depth + 1, k);
    return out;
  }
  return String(v).slice(0, MAX_STRING);
}

/** In-memory sink for tests and the stress harness. */
export class MemoryTraceSink implements TraceSink {
  readonly events: TraceEvent[] = [];
  write(e: TraceEvent): void {
    this.events.push(e);
  }
  async flush(): Promise<void> {}
  of(runId: string): TraceEvent[] {
    return this.events.filter((e) => e.runId === runId).sort((a, b) => a.seq - b.seq);
  }
}

