'use client';
/**
 * Live updates (docs/UX.md "Live updates"): one EventSource on GET /api/v1/events. Every LiveEvent invalidates the
 * TanStack queries whose key starts with its topic (see `queryKey` in ./api). Views decide how to apply fresh data
 * without moving rows under the cursor (src/components/lists/live-list.ts, UI-SPEC §10).
 *
 * - Coalescing: a burst of events refetches each topic once (QUIET_MS), and chatty topics (jobs, scans, health…)
 *   at most once per CHATTY_MS, always with a trailing refetch so the last change is never missed.
 * - Reconnect: when the stream comes back (a drop, sleep / wake, a deploy restarting the web app) every query
 *   refetches once, since anything published while it was away is lost. The server sends a `ping` frame every
 *   15 s; no frame for STALE_MS (or a timer gap that means the Mac slept) reopens the stream.
 * - Polling is only a safety net (SAFETY_NET_MS) where push cannot see a change (a worker that stopped beating).
 *
 * `subscribeLive` lets UI code react to events directly (notifications, the dev toolbar); `useLiveFollow` lets one
 * query follow other topics (a VDP push follows `jobs` while it runs). Never toast from here for a background event.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LiveEvent, type LiveTopic } from '@/contract';
import { serverNow } from '@/ui/clock';

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();

export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const reconnectListeners = new Set<() => void>();
/** Called once each time the stream comes back after a drop (not on the first connect). */
export function onLiveReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

export type LiveStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Where push can't see a change: refetch this rarely, and right after the stream reconnects. */
export const SAFETY_NET_MS = 5 * 60_000;
/** Events of one topic within this window refetch it once. */
export const QUIET_MS = 120;
/** Chatty topics (jobs, scans, health…) refetch at most this often while their events keep coming. */
export const CHATTY_MS = 1_500;
export const CHATTY_TOPICS: ReadonlySet<string> = new Set<LiveTopic>(['jobs', 'scans', 'health', 'event_log', 'tool_run', 'tools']);
/** No frame (hello, live or the 15 s ping) for this long: the connection is dead even if the socket says open. */
export const STALE_MS = 45_000;
/** A drop shorter than this never shows "Reconnecting…". */
const CALM_MS = 4_000;
const WATCH_MS = 10_000;

export interface TopicSchedulerOptions {
  quietMs?: number;
  minIntervalMs?: (topic: string) => number;
  now?: () => number;
}

/**
 * Per-topic coalescing: the first event of a topic schedules one run QUIET_MS later; more events of it before then
 * ride along. A topic that ran recently waits until its min interval has passed (one trailing run, never N).
 */
export class TopicScheduler {
  private readonly pending = new Map<string, number>();
  private readonly last = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Infinity;
  private readonly quietMs: number;
  private readonly minInterval: (topic: string) => number;
  private readonly now: () => number;

  constructor(
    private readonly run: (topics: string[]) => void,
    o: TopicSchedulerOptions = {},
  ) {
    this.quietMs = o.quietMs ?? QUIET_MS;
    this.minInterval = o.minIntervalMs ?? ((t) => (CHATTY_TOPICS.has(t) ? CHATTY_MS : 0));
    this.now = o.now ?? Date.now;
  }

  add(topic: string): void {
    if (!this.pending.has(topic)) {
      const now = this.now();
      this.pending.set(topic, Math.max(now + this.quietMs, (this.last.get(topic) ?? -Infinity) + this.minInterval(topic)));
    }
    this.arm();
  }

  /** Topics waiting for their run (tests). */
  get waiting(): string[] {
    return [...this.pending.keys()];
  }

  private arm(): void {
    let due = Infinity;
    for (const d of this.pending.values()) due = Math.min(due, d);
    if (due === Infinity || (this.timer && this.timerAt <= due)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = due;
    this.timer = setTimeout(() => this.flush(), Math.max(0, due - this.now()));
  }

  private flush(): void {
    this.timer = null;
    this.timerAt = Infinity;
    const now = this.now();
    const ready: string[] = [];
    for (const [topic, due] of this.pending) if (due <= now + 1) ready.push(topic);
    for (const t of ready) {
      this.pending.delete(t);
      this.last.set(t, now);
    }
    if (ready.length) this.run(ready);
    if (this.pending.size) this.arm();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}

// ── followers: one query that also refetches on other topics ───────────────────────────────

interface Follower {
  key: readonly unknown[];
  topics: ReadonlySet<string>;
}
const followers = new Set<Follower>();

/** Topics a follower set wants that this run covers (exported for tests). */
export function followersFor(topics: readonly string[]): Array<readonly unknown[]> {
  return [...followers].filter((f) => topics.some((t) => f.topics.has(t))).map((f) => f.key);
}

/**
 * While `active`, the query with this exact key also refetches on events of `topics` (coalesced with the rest).
 * Use it where a view's data is computed from tables of another topic: Home follows today / items / outbox…,
 * a VDP push follows `jobs` until it is done.
 */
export function useLiveFollow(key: readonly unknown[], topics: readonly LiveTopic[], active = true): void {
  const hash = JSON.stringify(key);
  const topicHash = topics.join(',');
  useEffect(() => {
    if (!active) return;
    const f: Follower = { key: JSON.parse(hash) as unknown[], topics: new Set(topicHash.split(',').filter(Boolean)) };
    followers.add(f);
    return () => {
      followers.delete(f);
    };
  }, [hash, topicHash, active]);
}

// ── time boundaries: the clock is an event too ─────────────────────────────────────────────

// Times a person scheduled (a meeting's start / end, a due time): never computed ones like a next read, which would
// turn this into a poll.
const TIME_KEYS = new Set(['start', 'end', 'startsAt', 'endsAt', 'due', 'startBy']);
const HORIZON_MS = 12 * 3_600_000;

/**
 * The earliest time in `data` (keys start / end / startsAt / endsAt / due / startBy, any depth up to 6) that is
 * still ahead of `now`, within 12 h. Exported for tests.
 */
export function nextBoundary(data: unknown, now: number): number | null {
  let best: number | null = null;
  let seen = 0;
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6 || seen > 5000) return;
    seen += 1;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === 'string' && TIME_KEYS.has(k) && x.length >= 16 && x[4] === '-') {
        const t = Date.parse(x);
        if (Number.isFinite(t) && t > now && t - now <= HORIZON_MS && (best === null || t < best)) best = t;
      } else if (x && typeof x === 'object') walk(x, depth + 1);
    }
  };
  walk(data, 0);
  return best;
}

/**
 * A view whose server-built content changes with the clock (a meeting starts, a due time passes) refetches right
 * after the next such time it shows: no polling, the clock is the event.
 */
export function useRefetchAtBoundaries(key: readonly unknown[], data: unknown): void {
  const qc = useQueryClient();
  const hash = JSON.stringify(key);
  useEffect(() => {
    // the server's clock (a mock or scenario clock may differ from the wall clock)
    const now = serverNow().getTime();
    const at = nextBoundary(data, now);
    if (at === null) return;
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: JSON.parse(hash) as unknown[], exact: true }), at - now + 2_000);
    return () => clearTimeout(t);
  }, [qc, hash, data]);
}

// ── the stream ──────────────────────────────────────────────────────────────────────────────

/** Mount once (src/client/providers.tsx). */
export function useLiveEvents(): LiveStatus {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    let es: EventSource | null = null;
    let disposed = false;
    let everOpen = false;
    let lastFrame = Date.now();
    let lastTick = Date.now();
    let downTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryMs = 2_000;

    // Never cancel a fetch in flight (a slow view under a steady stream of events would never finish loading): let it
    // land, then refetch that topic once more, so the last change is never missed.
    const again = new Set<string>();
    const sched = new TopicScheduler((topics) => {
      for (const t of topics) {
        if (qc.isFetching({ queryKey: [t] }) > 0) again.add(t);
        void qc.invalidateQueries({ queryKey: [t] }, { cancelRefetch: false });
      }
      for (const key of followersFor(topics)) {
        if (qc.isFetching({ queryKey: key, exact: true }) > 0) again.add(String(key[0]));
        void qc.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
      }
    });
    const offCache = qc.getQueryCache().subscribe((e) => {
      if (!again.size || e.type !== 'updated' || e.query.state.fetchStatus !== 'idle') return;
      const t = String(e.query.queryKey[0]);
      if (!again.has(t) || qc.isFetching({ queryKey: [t] }) > 0) return;
      again.delete(t);
      sched.add(t);
    });

    const calmDown = () => {
      if (downTimer || disposed) return;
      downTimer = setTimeout(() => {
        downTimer = null;
        if (!disposed && es?.readyState !== EventSource.OPEN) setStatus('reconnecting');
      }, CALM_MS);
    };
    const up = () => {
      if (downTimer) clearTimeout(downTimer);
      downTimer = null;
      retryMs = 2_000;
      setStatus('open');
    };
    const frame = () => {
      lastFrame = Date.now();
    };

    const connect = () => {
      if (disposed) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      es?.close();
      const s = new EventSource('/api/v1/events');
      es = s;
      lastFrame = Date.now();
      s.addEventListener('open', () => {
        if (es !== s) return;
        frame();
        up();
        // Anything published while the stream was away is lost: every view refetches once.
        if (everOpen) {
          void qc.invalidateQueries(undefined, { cancelRefetch: false });
          for (const l of [...reconnectListeners]) l();
        }
        everOpen = true;
      });
      s.addEventListener('error', () => {
        if (es !== s) return;
        calmDown();
        // CLOSED: the browser gave up (an error response); retry ourselves with a backoff.
        if (s.readyState === EventSource.CLOSED && !retryTimer) {
          retryTimer = setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 30_000);
        }
      });
      s.addEventListener('hello', frame);
      s.addEventListener('ping', frame);
      s.addEventListener('live', (msg) => {
        frame();
        let parsed;
        try {
          parsed = LiveEvent.safeParse(JSON.parse((msg as MessageEvent<string>).data));
        } catch {
          return;
        }
        if (!parsed.success) return;
        const ev = parsed.data;
        for (const l of [...listeners]) {
          try {
            l(ev);
          } catch {
            /* one listener must not starve the others */
          }
        }
        sched.add(ev.topic);
      });
    };

    const reopen = () => {
      calmDown();
      connect();
    };

    // Watchdog: a timer gap means the Mac slept; a silent open socket means the connection died with it.
    const watch = setInterval(() => {
      const now = Date.now();
      const slept = now - lastTick > WATCH_MS * 3;
      lastTick = now;
      if (slept || (es?.readyState === EventSource.OPEN && now - lastFrame > STALE_MS)) reopen();
    }, WATCH_MS);
    const onOnline = () => {
      if (es?.readyState !== EventSource.OPEN) reopen();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (es?.readyState !== EventSource.OPEN || Date.now() - lastFrame > STALE_MS)) reopen();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    connect();
    return () => {
      disposed = true;
      clearInterval(watch);
      if (downTimer) clearTimeout(downTimer);
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      sched.dispose();
      offCache();
      es?.close();
      es = null;
      setStatus('closed');
    };
  }, [qc]);

  return status;
}

/** Tests only: the follower registry is module state. */
export function _resetLiveFollowers(): void {
  followers.clear();
}
