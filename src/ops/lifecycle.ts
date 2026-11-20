/**
 * Worker lifecycle helpers for BE-1's worker (R-UI-7, R-BE-4):
 *  - Lifecycle: graceful SIGTERM/SIGINT shutdown (stop claiming, abort runs, flush, exit)
 *  - WakeDetector: clock-jump detection so the worker can trigger resume planning after sleep
 *  - SingleInstanceLock: pid file + Postgres advisory lock
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { workerPidPath } from './paths';

// ---------------------------------------------------------------- shutdown

export type ShutdownStep = { name: string; fn: (reason: string) => void | Promise<void> };

export interface LifecycleOptions {
  /** Hard cap for the whole shutdown sequence. launchd sends SIGKILL after ExitTimeOut (20 s in our plist). */
  timeoutMs?: number;
  /** Injected for tests. Defaults to process.exit. */
  exit?: (code: number) => void;
  log?: (msg: string) => void;
}

/**
 * Usage in the worker:
 *   const life = new Lifecycle(); life.installSignalHandlers();
 *   while (!life.stopping) { claim a job; run it with life.signal }
 *   life.onShutdown('heartbeat', () => hb.stop());
 *   life.onShutdown('pool', () => pool.end());
 * Shutdown order is registration order: register "stop timers" first, "close pool" last.
 */
export class Lifecycle {
  private readonly steps: ShutdownStep[] = [];
  private readonly abort = new AbortController();
  private result: Promise<number> | null = null;
  private readonly timeoutMs: number;
  private readonly exit: (code: number) => void;
  private readonly log: (msg: string) => void;

  constructor(opts: LifecycleOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.exit = opts.exit ?? ((c) => process.exit(c));
    this.log = opts.log ?? ((m) => console.log(`[lifecycle] ${m}`));
  }

  /** True once shutdown began: the claim loop must stop taking new jobs. */
  get stopping(): boolean {
    return this.result !== null;
  }
  /** Aborted when shutdown begins. Pass to running jobs / Agent SDK runs. */
  get signal(): AbortSignal {
    return this.abort.signal;
  }

  onShutdown(name: string, fn: ShutdownStep['fn']): void {
    this.steps.push({ name, fn });
  }

  installSignalHandlers(proc: Pick<NodeJS.Process, 'on'> = process): void {
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      proc.on(sig, () => void this.shutdown(sig).then((c) => this.exit(c)));
    }
  }

  /** Idempotent. Resolves to the exit code (0 clean, 1 if a step failed or the timeout hit). */
  shutdown(reason: string): Promise<number> {
    if (!this.result) {
      this.log(`shutdown requested: ${reason}`);
      this.abort.abort(new Error(`shutdown:${reason}`));
      this.result = this.runSteps(reason);
    }
    return this.result;
  }

  private async runSteps(reason: string): Promise<number> {
    let failed = false;
    const all = (async () => {
      for (const s of this.steps) {
        try {
          await s.fn(reason);
        } catch (e) {
          failed = true;
          this.log(`step "${s.name}" failed: ${e instanceof Error ? e.name : 'error'}`);
        }
      }
    })();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => r('timeout'), this.timeoutMs);
      timer.unref();
    });
    const outcome = await Promise.race([all.then(() => 'done' as const), timeout]);
    if (timer) clearTimeout(timer);
    if (outcome === 'timeout') this.log('shutdown timed out; exiting anyway');
    return failed || outcome === 'timeout' ? 1 : 0;
  }
}

// ---------------------------------------------------------------- wake detection

export interface WakeEvent {
  /** Wall-clock time that elapsed beyond what the tick interval explains. */
  gapMs: number;
  /** Last tick before the jump and the first tick after it. */
  from: number;
  to: number;
}

/**
 * Timers pause while the Mac sleeps, so after wake the wall clock is far ahead of the expected tick.
 * A gap well over the interval means "we slept (or the process was suspended)": the worker should
 * re-plan catch-up (SCANNER §5: newest hour first, then backfill).
 */
export class WakeDetector {
  private last: number;
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private readonly onWake: (e: WakeEvent) => void,
    private readonly opts: { intervalMs?: number; thresholdMs?: number; now?: () => number } = {},
  ) {
    this.last = this.now();
  }
  private now(): number {
    return (this.opts.now ?? Date.now)();
  }
  /** One tick. Exposed so tests can drive a fake clock without timers. */
  check(): WakeEvent | null {
    const t = this.now();
    const interval = this.opts.intervalMs ?? 5_000;
    const threshold = this.opts.thresholdMs ?? 30_000;
    const gap = t - this.last - interval;
    const prev = this.last;
    this.last = t;
    if (gap > threshold) {
      const ev = { gapMs: gap, from: prev, to: t };
      this.onWake(ev);
      return ev;
    }
    return null;
  }
  start(): void {
    this.last = this.now();
    this.timer = setInterval(() => this.check(), this.opts.intervalMs ?? 5_000);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// ---------------------------------------------------------------- single instance

/** Minimal shape of a pg Client/PoolClient. */
export interface PgLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Two-int advisory lock key: (4327 = app port, 1 = worker role). */
export const WORKER_ADVISORY_KEY: [number, number] = [4327, 1];

export type LockResult = { acquired: true } | { acquired: false; reason: 'pidfile' | 'advisory'; holderPid?: number };

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Two layers: the pid file catches a second worker before Postgres is even up (and gives doctor a pid
 * to show); the advisory lock is the real guarantee because the session lock dies with the connection,
 * so a crashed worker can never leave it stuck. Hold `client` open for the life of the process
 * (a dedicated Client, not a pooled connection that gets recycled).
 */
export class SingleInstanceLock {
  private held = false;
  constructor(
    private readonly opts: { pidFile?: string; client?: PgLike; key?: [number, number]; pid?: number; alive?: (pid: number) => boolean } = {},
  ) {}

  private get pidFile() {
    return this.opts.pidFile ?? workerPidPath();
  }

  async acquire(): Promise<LockResult> {
    const pid = this.opts.pid ?? process.pid;
    const alive = this.opts.alive ?? pidAlive;
    mkdirSync(dirname(this.pidFile), { recursive: true, mode: 0o700 });
    if (!this.tryCreatePidFile(pid, alive)) {
      return { acquired: false, reason: 'pidfile', holderPid: this.readPid() ?? undefined };
    }
    if (this.opts.client) {
      const [a, b] = this.opts.key ?? WORKER_ADVISORY_KEY;
      const r = await this.opts.client.query('SELECT pg_try_advisory_lock($1::int, $2::int) AS ok', [a, b]);
      if (r.rows[0]?.ok !== true) {
        this.removePidFile(pid);
        return { acquired: false, reason: 'advisory' };
      }
    }
    this.held = true;
    return { acquired: true };
  }

  async release(): Promise<void> {
    if (this.opts.client && this.held) {
      const [a, b] = this.opts.key ?? WORKER_ADVISORY_KEY;
      await this.opts.client.query('SELECT pg_advisory_unlock($1::int, $2::int)', [a, b]).catch(() => undefined);
    }
    if (this.held) this.removePidFile(this.opts.pid ?? process.pid);
    this.held = false;
  }

  private readPid(): number | null {
    try {
      const n = Number.parseInt(readFileSync(this.pidFile, 'utf8').trim(), 10);
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  private tryCreatePidFile(pid: number, alive: (p: number) => boolean): boolean {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(this.pidFile, 'wx', 0o600); // O_EXCL: atomic create
        closeSync(fd);
        writeFileSync(this.pidFile, String(pid), { mode: 0o600 });
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        const holder = this.readPid();
        if (holder === pid) return true;
        if (holder !== null && alive(holder)) return false;
        try {
          unlinkSync(this.pidFile); // stale (crash, reboot, pid reuse by nothing): take over
        } catch {
          /* raced with another starter; loop once more */
        }
      }
    }
    return false;
  }

  private removePidFile(pid: number): void {
    if (this.readPid() === pid) {
      try {
        unlinkSync(this.pidFile);
      } catch {
        /* already gone */
      }
    }
  }
}
