/**
 * Today v2 time helpers (pure). Times are wall-clock in the profile timezone, never the browser's.
 * Durations read "1h 30m" (brief 14 §5); approximate values carry a "~".
 */

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string | undefined): Intl.DateTimeFormat {
  const key = tz ?? '';
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    cache.set(key, f);
  }
  return f;
}

export interface ZonedParts {
  ymd: string;
  /** Minutes since local midnight. */
  min: number;
  weekday: string;
  month: number;
  day: number;
}

export function zoned(at: string | number, tz?: string): ZonedParts {
  const d = typeof at === 'number' ? new Date(at) : new Date(at);
  const p = Object.fromEntries(fmt(tz).formatToParts(d).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  return { ymd: `${p.year}-${p.month}-${p.day}`, min: h * 60 + Number(p.minute), weekday: String(p.weekday), month: Number(p.month), day: Number(p.day) };
}

export const minuteOfDay = (iso: string, tz?: string) => zoned(iso, tz).min;
export const sameLocalDay = (a: string, b: string, tz?: string) => zoned(a, tz).ymd === zoned(b, tz).ymd;

/** "07:30" → 450. Falls back to `fallback` on anything unparsable. */
export function parseHHMM(v: string | null | undefined, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? '');
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 450 → "07:30". */
export function hhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 90 → "1h 30m" · 45 → "45m" · 300 → "5h". */
export function hm(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Rounded for a "~" estimate: 5-minute steps under 2 h, 15-minute steps above. */
export function roundEstimate(min: number): number {
  const step = min >= 120 ? 15 : 5;
  return Math.max(0, Math.round(min / step) * step);
}

/** "~5h" · "~6h 30m" · "~20m". */
export const approx = (min: number) => `~${hm(roundEstimate(min))}`;

/** "Thu 5 Nov". */
export function dateLabel(iso: string, tz?: string): string {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** A due date relative to today: "17:00" today · "Fri" within the week · "12/4" later · "Fri 12:00" with time. */
export function dueLabel(dueIso: string, nowIso: string, tz?: string, opts: { withTime?: boolean } = {}): string {
  const d = zoned(dueIso, tz);
  const n = zoned(nowIso, tz);
  if (d.ymd === n.ymd) return hhmm(d.min);
  const days = (Date.parse(dueIso) - Date.parse(nowIso)) / 86_400_000;
  // Due "Sat 00:00" means "by end of Fri": show the day the work is actually due.
  const atMidnight = d.min === 0;
  if (days > -1 && days < 6.5) {
    const shown = atMidnight ? zoned(Date.parse(dueIso) - 60_000, tz) : d;
    if (shown.ymd === n.ymd) return 'today';
    return opts.withTime && !atMidnight ? `${shown.weekday} ${hhmm(shown.min)}` : shown.weekday;
  }
  return `${d.month}/${d.day}`;
}

export const msOf = (iso: string) => Date.parse(iso);
