/**
 * One sliding-window limiter for every VDP MCP call this process makes (D-69, VD-27): VDP allows 60 calls a minute per
 * user, shared between reads and writes, so the mirror's reads, the push's writes and their live checks draw from
 * the same window (at most 55 a minute, a margin for the read-back). `vdpCallLimiter` is the process-wide one the
 * scanner's read client and the Outbox's VDP transport share; tests make their own.
 *
 * Generate takes 30-90 s upstream: its call gets a 120 s timeout (`VDP_GENERATE_TIMEOUT_MS`), every other one 30 s.
 */
import { sleep as defaultSleep } from '../util';

export const VDP_CALLS_PER_MINUTE = 55;
export const VDP_GENERATE_TIMEOUT_MS = 120_000;
/** VDP generates at most 20 use cases per 10 minutes per user: a push carries at most this many Generates. */
export const VDP_MAX_GENERATES_PER_PUSH = 20;

export interface VdpLimiter {
  /** Wait for a slot (at most `max` calls in any 60 s), then take it. */
  slot(o?: { signal?: AbortSignal; now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }): Promise<void>;
  /** Calls in the current window (tests, Health). */
  inWindow(nowMs?: number): number;
}

export function createVdpLimiter(max = VDP_CALLS_PER_MINUTE): VdpLimiter {
  const calls: number[] = [];
  const prune = (t: number) => {
    while (calls.length && t - calls[0]! >= 60_000) calls.shift();
  };
  return {
    async slot(o = {}) {
      const now = o.now ?? Date.now;
      for (;;) {
        const t = now();
        prune(t);
        if (calls.length < Math.max(1, max)) {
          calls.push(t);
          return;
        }
        await (o.sleep ?? defaultSleep)(60_000 - (t - calls[0]!) + 50, o.signal);
      }
    },
    inWindow(nowMs = Date.now()) {
      prune(nowMs);
      return calls.length;
    },
  };
}

/** The process-wide limiter (the worker reads and writes VDP in one process). */
export const vdpCallLimiter: VdpLimiter = createVdpLimiter();

/** The timeout for one call: Generate takes 30-90 s upstream. */
export const vdpTimeoutFor = (tool: string, fallback?: number): number => (tool === 'generate_use_case' ? Math.max(fallback ?? 0, VDP_GENERATE_TIMEOUT_MS) : (fallback ?? 30_000));
