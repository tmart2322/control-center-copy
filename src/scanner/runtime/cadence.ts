/**
 * Live cadence (SCANNER.md §5): per-connector base interval, ×6 outside working hours, adaptive
 * backoff when nothing changes, failure backoff per error class (brief 09 §5.3).
 */
import type { Org62Scope } from '../../personas/types';
import type { ConnectorHealthProbe, ConnectorId } from '../types';

const MIN = 60_000;

export const DEFAULT_BASE_CADENCE_MS: Record<ConnectorId, number> = {
  slack: 2 * MIN,
  gmail: 3 * MIN,
  calendar: 5 * MIN,
  claude_sessions: 10 * MIN, // sweep; the file watch is near real time (BE-2b)
  drive: 10 * MIN,
  gemini_notes: 10 * MIN, // only for 120 min after a meeting ends (BE-2b decides scopes)
  org62: 30 * MIN,
  trainings: 24 * 60 * MIN,
  watch: 60 * MIN,
  vdp: 30 * MIN,
};

export interface WorkHours {
  /** Local hour [start, end). */
  startHour: number;
  endHour: number;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  timeZone: string;
}

export const DEFAULT_WORK_HOURS: WorkHours = { startHour: 7, endHour: 18, days: [1, 2, 3, 4, 5], timeZone: 'America/Denver' };

export interface CadenceConfig {
  baseMs: Partial<Record<ConnectorId, number>>;
  offHoursMultiplier: number;
  workHours: WorkHours;
  /** Adaptive backoff: each quiet run doubles the interval up to 2^maxLevel. */
  maxQuietLevel: number;
  /** Per-scope multiplier (e.g. Slack channels ×5 vs the inbox). */
  scopeMultiplier: (connector: ConnectorId, scope: string) => number;
}

/**
 * Every Org62 scope a persona can scan (`personaOf(...).org62Scopes`, D-55), with its multiplier on the Org62 base
 * cadence. Typed by the persona's scope list, so a new scope can't be planned without a cadence.
 */
export const ORG62_SCOPE_MULTIPLIER: Readonly<Record<Org62Scope, number>> = { opps: 1, events: 2, dcs: 2, book: 1, missed_opps: 48 /* daily */ };

export const DEFAULT_SCOPE_MULTIPLIER = (connector: ConnectorId, scope: string): number => {
  if (connector === 'slack' && scope.startsWith('channel:')) return 5;
  if (connector === 'org62') return ORG62_SCOPE_MULTIPLIER[scope as Org62Scope] ?? 1;
  return 1;
};

export const DEFAULT_CADENCE: CadenceConfig = {
  baseMs: DEFAULT_BASE_CADENCE_MS,
  offHoursMultiplier: 6,
  workHours: DEFAULT_WORK_HOURS,
  maxQuietLevel: 3,
  scopeMultiplier: DEFAULT_SCOPE_MULTIPLIER,
};

export function localParts(d: Date, timeZone: string): { hour: number; day: number; date: string } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { hour: Number(parts.hour) % 24, day: days.indexOf(String(parts.weekday)), date: `${parts.year}-${parts.month}-${parts.day}` };
}

export function isWorkHours(d: Date, wh: WorkHours): boolean {
  const p = localParts(d, wh.timeZone);
  return wh.days.includes(p.day) && p.hour >= wh.startHour && p.hour < wh.endHour;
}

/**
 * Off-hours and quiet backoff slow a poller down, but never past MAX_SLOWDOWN_MS, or its own base interval when that
 * is longer. Without the cap a daily source planned off-hours waited 6 days (×6), and ×8 quiet on top: trainings
 * and the missed-opp sweep effectively stopped after the first day (stress finding CAD-1).
 */
export const MAX_SLOWDOWN_MS = 4 * 60 * MIN;

export function intervalMs(cfg: CadenceConfig, connector: ConnectorId, scope: string, now: Date, quietLevel: number): number {
  const base = (cfg.baseMs[connector] ?? DEFAULT_BASE_CADENCE_MS[connector] ?? 10 * MIN) * cfg.scopeMultiplier(connector, scope);
  const off = isWorkHours(now, cfg.workHours) ? 1 : cfg.offHoursMultiplier;
  const quiet = 2 ** Math.max(0, Math.min(quietLevel, cfg.maxQuietLevel));
  return Math.min(base * off * quiet, Math.max(base, MAX_SLOWDOWN_MS));
}

/** Retry delay after a failed run. `null` = do not retry automatically (needs the user). */
export function failureDelayMs(errorClass: ConnectorHealthProbe['errorClass'], consecutiveFailures: number): number | null {
  const n = Math.max(0, consecutiveFailures - 1);
  switch (errorClass) {
    case 'auth':
      return null; // paused until re-auth (Health → Rescan / runScope)
    case 'transient':
    case 'rate_limited':
      return Math.min(30 * MIN, MIN * 2 ** n);
    case 'config':
      return 30 * MIN;
    default:
      return consecutiveFailures >= 4 ? null : Math.min(30 * MIN, 2 * MIN * 2 ** n);
  }
}
