/**
 * Resume planner (SCANNER.md §5 "Resume after downtime"; brief 09 §5.7). Pure function.
 *
 * Given the uncovered windows of a scope (from the ledger, starting at its cursor) and `now`:
 *  - total gap ≤ headMs  → one `incremental` window per gap (a normal poll);
 *  - otherwise           → `head` = the newest hour first (so Monday morning is right quickly), then
 *                          `backfill` of everything older in chunks (default 6 h), OLDEST → NEWEST.
 *  - first scan (`head: false`, FS-ORDER) → no head: everything is `backfill`, OLDEST → NEWEST up to now, so an
 *                          ask is always recorded before the reply that settles it.
 * Because the cursor only advances over contiguous coverage (store rule S9), the head run commits its
 * coverage but leaves the cursor; each backfill chunk advances it; when the last chunk meets the head
 * window, the cursor fast-forwards to the head run's cursor. No holes, no double work. Chunks are cut forward
 * from each gap's start, so a re-plan (the gap starts where a finished chunk ended) keeps the same boundaries.
 */
import type { TimeWindow } from '../types';

export type PlannedMode = 'incremental' | 'head' | 'backfill';

export interface PlannedWindow {
  window: TimeWindow;
  mode: PlannedMode;
  /** Execution order within the plan (0 first). */
  order: number;
}

export interface ResumePlanInput {
  now: Date;
  /** Uncovered windows of the scope from its cursor (or initial lookback) to now. */
  gaps: TimeWindow[];
  headMs?: number;
  chunkMs?: number;
  /** Ignore anything older than this (never backfill forever). Default 14 days. */
  maxBackfillMs?: number;
  /** Windows shorter than this are skipped (noise). Default 1 s. */
  minWindowMs?: number;
  /**
   * Plan the newest hour first (default true). The first scan passes false (FS-ORDER): before, it ran the head hour
   * and then backfilled NEWEST → OLDEST, so my reply was recorded (and judged) before the ask it answered existed.
   */
  head?: boolean;
  /** The chunk that starts at `a` (ms), when it depends on age (a deeper first-scan lookback, FS-DEEP). */
  chunkMsAt?: (a: number) => number;
}

const H = 3_600_000;

export function planResume(input: ResumePlanInput): PlannedWindow[] {
  const now = input.now.getTime();
  const headMs = input.headMs ?? H;
  const chunkMs = input.chunkMs ?? 6 * H;
  const floor = now - (input.maxBackfillMs ?? 14 * 24 * H);
  const minMs = input.minWindowMs ?? 1000;
  const gaps = input.gaps
    .map((g) => ({ from: Math.max(Date.parse(g.from), floor), to: Math.min(Date.parse(g.to), now) }))
    .filter((g) => g.to - g.from >= minMs)
    .sort((a, b) => a.from - b.from);
  const total = gaps.reduce((a, g) => a + (g.to - g.from), 0);
  const iso = (ms: number) => new Date(ms).toISOString();
  const out: PlannedWindow[] = [];
  if (!gaps.length) return out;

  if (total <= headMs) {
    gaps.forEach((g) => out.push({ window: { from: iso(g.from), to: iso(g.to) }, mode: 'incremental', order: out.length }));
    return out;
  }

  const head = input.head ?? true;
  const headStart = head ? now - headMs : now;
  // 1) head: newest hour first (never on a first scan)
  if (head) {
    for (const g of gaps) {
      const from = Math.max(g.from, headStart);
      if (g.to - from >= minMs) out.push({ window: { from: iso(from), to: iso(g.to) }, mode: 'head', order: out.length });
    }
  }
  // 2) backfill: the older parts (everything, without a head), chunked forward from each gap's start, oldest → newest
  for (const g of gaps) {
    const end = Math.min(g.to, headStart);
    for (let a = g.from; end - a >= minMs; ) {
      const c = Math.max(minMs, input.chunkMsAt?.(a) ?? chunkMs);
      const b = Math.min(a + c, end);
      out.push({ window: { from: iso(a), to: iso(b) }, mode: 'backfill', order: out.length });
      a = b;
    }
  }
  return out;
}

/** Fraction of a catch-up plan that is done, for Health ("catching up: Slack 60%"). */
export function catchUpFraction(planned: TimeWindow[], remaining: TimeWindow[]): number {
  const len = (ws: TimeWindow[]) => ws.reduce((a, w) => a + Math.max(0, Date.parse(w.to) - Date.parse(w.from)), 0);
  const total = len(planned);
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - len(remaining) / total));
}
