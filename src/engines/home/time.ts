/**
 * Pure, timezone-aware time helpers for Home. Labels are in the user's profile zone (never the host's),
 * via Intl only (no timezone database dependency).
 */

export const MIN_MS = 60_000;
export const HOUR_MS = 60 * MIN_MS;
export const DAY_MS = 24 * HOUR_MS;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

export interface ZonedParts {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' });
    fmtCache.set(tz, f);
  }
  return f;
}

export function toMs(v: string | number | Date): number {
  return typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : v.getTime();
}

export function zoned(ms: number, tz: string): ZonedParts {
  const parts = partsFormatter(tz).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const wd = WEEKDAYS.indexOf(get('weekday') as (typeof WEEKDAYS)[number]);
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), hh: Number(get('hour')) % 24, mm: Number(get('minute')), weekday: wd < 0 ? 0 : wd };
}

/** Minutes the zone is ahead of UTC at `ms` (Denver in November: −420). */
export function offsetMin(ms: number, tz: string): number {
  const p = zoned(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  return Math.round((asUtc - Math.floor(ms / MIN_MS) * MIN_MS) / MIN_MS);
}

/** The UTC instant of local wall-clock y-m-d hh:mm in `tz` (DST-safe to the minute). */
export function atLocal(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMin(guess, tz) * MIN_MS;
  return guess - offsetMin(first, tz) * MIN_MS;
}

/** Local midnight (as a UTC instant) of the day holding `ms`. */
export function dayStart(ms: number, tz: string): number {
  const p = zoned(ms, tz);
  return atLocal(p.y, p.m, p.d, 0, 0, tz);
}

/** Local midnight `n` days after the day holding `ms`. */
export function addLocalDays(ms: number, n: number, tz: string): number {
  const p = zoned(ms, tz);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return atLocal(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, tz);
}

/** 'YYYY-MM-DD' of the local day holding `ms`. */
export function dayKey(ms: number, tz: string): string {
  const p = zoned(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function sameDay(a: number, b: number, tz: string): boolean {
  return dayKey(a, tz) === dayKey(b, tz);
}

/** Whole local days from the day of `from` to the day of `to` (0 = same day). */
export function daysBetween(from: number, to: number, tz: string): number {
  const a = zoned(from, tz);
  const b = zoned(to, tz);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

/** "09:30" */
export function hm(ms: number, tz: string): string {
  const p = zoned(ms, tz);
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

/** "11/12" */
export function md(ms: number, tz: string): string {
  const p = zoned(ms, tz);
  return `${p.m}/${p.d}`;
}

/** "Thu" */
export function wd(ms: number, tz: string): string {
  return WEEKDAYS[zoned(ms, tz).weekday];
}

/** "Thursday 5 November" */
export function longDate(ms: number, tz: string): string {
  const p = zoned(ms, tz);
  return `${WEEKDAYS_LONG[p.weekday]} ${p.d} ${MONTHS_LONG[p.m - 1]}`;
}

/** "HH:MM" (24 h) → minutes after midnight. */
export function parseHM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * When an item is due, phrased relative to now: "13:00" today, "Fri 12:00" this week, "Fri 11/6" when the
 * time is the end of the working day, "Tue 11/3" in the past.
 */
export function whenLabel(ms: number, nowMs: number, tz: string): string {
  const days = daysBetween(nowMs, ms, tz);
  if (days === 0) return hm(ms, tz);
  const p = zoned(ms, tz);
  const eod = p.hh >= 17 || (p.hh === 0 && p.mm === 0);
  if (days >= 1 && days < 7 && !eod) return `${wd(ms, tz)} ${hm(ms, tz)}`;
  return `${wd(ms, tz)} ${md(ms, tz)}`;
}

/** Short zone name for labels ("MT", "PT", "ET", "UTC"). */
export function tzShort(tz: string, ms: number): string {
  const known: Record<string, string> = {
    'America/Denver': 'MT',
    'America/Phoenix': 'MT',
    'America/Boise': 'MT',
    'America/Los_Angeles': 'PT',
    'America/New_York': 'ET',
    'America/Detroit': 'ET',
    'America/Chicago': 'CT',
    UTC: 'UTC',
    'Etc/UTC': 'UTC',
  };
  if (known[tz]) return known[tz];
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value;
  return name ?? tz;
}

/** "45m", "1h 30m", "5h" */
export function dur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** A working day Home can plan: its local date, its working-hours start and end, and how to name it. */
export interface WorkingDay {
  /** 'YYYY-MM-DD' (local). */
  date: string;
  /** Local midnight and the next one (UTC instants). */
  dayStartMs: number;
  dayEndMs: number;
  /** Working hours that day (UTC instants). */
  startMs: number;
  endMs: number;
  /** "Tomorrow" when it is the next calendar day, else its weekday ("Monday"). */
  label: string;
  /** "Thu 11/12" */
  short: string;
}

/**
 * The first working day after the local day holding `ms` (Friday evening → Monday). `days` are weekday numbers,
 * 0 = Sunday; an empty list means every day. Working hours are "HH:MM" in `tz`.
 */
export function nextWorkingDay(ms: number, tz: string, wh: { start: string; end: string; days: readonly number[] }): WorkingDay {
  const days = wh.days.length ? new Set(wh.days) : new Set([0, 1, 2, 3, 4, 5, 6]);
  let start = addLocalDays(ms, 1, tz);
  for (let i = 0; i < 7 && !days.has(zoned(start, tz).weekday); i++) start = addLocalDays(start, 1, tz);
  return workingDayAt(start, tz, wh, addLocalDays(ms, 1, tz));
}

/** The working day holding `ms` (whether or not it is a working day); `tomorrowMs` names it "Tomorrow". */
export function workingDayAt(ms: number, tz: string, wh: { start: string; end: string }, tomorrowMs: number = Number.NaN): WorkingDay {
  const p = zoned(ms, tz);
  const s = parseHM(wh.start);
  const e = parseHM(wh.end);
  const dayStartMs = atLocal(p.y, p.m, p.d, 0, 0, tz);
  return {
    date: dayKey(ms, tz),
    dayStartMs,
    dayEndMs: addLocalDays(ms, 1, tz),
    startMs: atLocal(p.y, p.m, p.d, Math.floor(s / 60), s % 60, tz),
    endMs: atLocal(p.y, p.m, p.d, Math.floor(e / 60), e % 60, tz),
    label: Number.isFinite(tomorrowMs) && sameDay(dayStartMs, tomorrowMs, tz) ? 'Tomorrow' : WEEKDAYS_LONG[p.weekday],
    short: `${wd(ms, tz)} ${md(ms, tz)}`,
  };
}

/** Is the local day holding `ms` a working day? (An empty list means every day.) */
export function isWorkingDay(ms: number, tz: string, days: readonly number[]): boolean {
  return !days.length || days.includes(zoned(ms, tz).weekday);
}
