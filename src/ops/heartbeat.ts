/**
 * Worker heartbeat file (R-UI-7, R-UI-12).
 *
 * File: `<state>/worker.heartbeat`, JSON, mode 600, replaced atomically (tmp + rename)
 * every HEARTBEAT_INTERVAL_MS. Format v1:
 *
 *   {
 *     "v": 1,
 *     "instance_id": "host:pid:uuid",   // same id as worker_instances.id
 *     "pid": 1234,
 *     "state": "starting|idle|running|catching_up|draining|stopping|stopped",
 *     "started_at": "ISO",
 *     "beat_at": "ISO",                 // doctor/Health compare this to now
 *     "seq": 42,                        // increments per beat
 *     "active_jobs": 0,
 *     "app_version": "0.1.0",
 *     "last_error_code": null           // a code only, never message text (privacy-safe logs)
 *   }
 *
 * Staleness: fresh <= 60 s, stale <= 5 min (warn), dead beyond (fail). A "stopped" state with a
 * recent beat is a clean shutdown, not a fault.
 */
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { z } from 'zod';
import { heartbeatPath } from './paths';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_FRESH_MS = 60_000;
export const HEARTBEAT_DEAD_MS = 5 * 60_000;

/** `blocked`: alive, claiming nothing until the database schema matches the build (src/worker/schema-guard.ts). */
export const workerStates = ['starting', 'idle', 'running', 'catching_up', 'blocked', 'draining', 'stopping', 'stopped'] as const;

export const heartbeatSchema = z.object({
  v: z.literal(1),
  instance_id: z.string(),
  pid: z.number().int(),
  state: z.enum(workerStates),
  started_at: z.string(),
  beat_at: z.string(),
  seq: z.number().int().nonnegative(),
  active_jobs: z.number().int().nonnegative(),
  app_version: z.string(),
  last_error_code: z.string().nullable(),
});
export type Heartbeat = z.infer<typeof heartbeatSchema>;

export type HeartbeatHealth = 'fresh' | 'stale' | 'dead' | 'missing' | 'invalid';

export function readHeartbeat(path = heartbeatPath()): { hb: Heartbeat | null; health: HeartbeatHealth; ageMs: number | null } {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { hb: null, health: 'missing', ageMs: null };
  }
  try {
    const hb = heartbeatSchema.parse(JSON.parse(raw));
    return { hb, ...classifyHeartbeat(hb) };
  } catch {
    return { hb: null, health: 'invalid', ageMs: null };
  }
}

export function classifyHeartbeat(hb: Heartbeat, now = Date.now()): { health: HeartbeatHealth; ageMs: number } {
  const ageMs = Math.max(0, now - Date.parse(hb.beat_at));
  const health: HeartbeatHealth = ageMs <= HEARTBEAT_FRESH_MS ? 'fresh' : ageMs <= HEARTBEAT_DEAD_MS ? 'stale' : 'dead';
  return { health, ageMs };
}

export interface HeartbeatWriterOptions {
  path?: string;
  appVersion?: string;
  intervalMs?: number;
  now?: () => number;
  /** Called after each beat so the worker can mirror it to worker_instances.last_beat_at. */
  onBeat?: (hb: Heartbeat) => void | Promise<void>;
}

export class HeartbeatWriter {
  private readonly path: string;
  private readonly startedAt: string;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  readonly instanceId: string;
  state: Heartbeat['state'] = 'starting';
  activeJobs = 0;
  lastErrorCode: string | null = null;

  constructor(private readonly opts: HeartbeatWriterOptions = {}) {
    this.path = opts.path ?? heartbeatPath();
    this.now = opts.now ?? Date.now;
    this.startedAt = new Date(this.now()).toISOString();
    this.instanceId = `${hostname()}:${process.pid}:${randomUUID()}`;
  }

  snapshot(): Heartbeat {
    return {
      v: 1,
      instance_id: this.instanceId,
      pid: process.pid,
      state: this.state,
      started_at: this.startedAt,
      beat_at: new Date(this.now()).toISOString(),
      seq: this.seq,
      active_jobs: this.activeJobs,
      app_version: this.opts.appVersion ?? '0.0.0',
      last_error_code: this.lastErrorCode,
    };
  }

  /** Write one beat now (atomic replace, mode 600). Never throws: a failed beat must not kill the worker. */
  beat(): Heartbeat {
    this.seq += 1;
    const hb = this.snapshot();
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(hb), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.path);
    } catch {
      /* disk full / permissions: Health will show the heartbeat as stale, which is the right signal */
    }
    void Promise.resolve(this.opts.onBeat?.(hb)).catch(() => undefined);
    return hb;
  }

  start(): void {
    this.beat();
    this.timer = setInterval(() => this.beat(), this.opts.intervalMs ?? HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  setState(state: Heartbeat['state']): void {
    this.state = state;
    this.beat();
  }

  /** Final beat with state "stopped" so doctor can tell clean shutdown from a crash. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = 'stopped';
    this.activeJobs = 0;
    this.beat();
  }
}
