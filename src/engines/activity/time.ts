/** Time and interval helpers. Timezone-aware without extra dependencies (Intl only). Pure. */

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export interface Interval {
  start: number; // epoch ms
  end: number;
}

export const toMs = (iso: string): number => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`bad timestamp: ${iso}`);
  return t;
};

/** ISO-8601 UTC with ".000Z", the form Org62 Subject+Start matching and the work-order canvas use. */
export const toIsoMs = (ms: number): string => new Date(ms).toISOString();
/** UTC without millis (the autopilot's internal form). */
export const toIsoSec = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const hoursBetween = (a: number, b: number): number => (b - a) / HOUR;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

function parts(ms: number, tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** Local calendar day (YYYY-MM-DD) in `tz`. */
export function localDay(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Local "HH:MM" in `tz`. */
export function localHm(ms: number, tz: string): string {
  const p = parts(ms, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** The UTC offset of `tz` at `ms` (local wall clock − UTC), ms. */
export function utcOffsetMs(ms: number, tz: string): number {
  return offsetMs(ms, tz);
}

function offsetMs(ms: number, tz: string): number {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of a wall-clock `day` + "HH:MM" in `tz`. */
export function zonedToMs(day: string, hm: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [h, mi] = hm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let ms = guess - offsetMs(guess, tz);
  ms = guess - offsetMs(ms, tz);
  return ms;
}

/** Monday of the Mon..Sun week containing local `day`. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = (t.getUTCDay() + 6) % 7; // Mon=0
  return new Date(t.getTime() - dow * DAY).toISOString().slice(0, 10);
}

export const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
};

// ---------- interval math (port of blocks._union/_subtract) ----------

export function unionIntervals(iv: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of [...iv].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end);
    else out.push({ start: x.start, end: x.end });
  }
  return out;
}

export function subtractIntervals(iv: readonly Interval[], busy: readonly Interval[]): Interval[] {
  const res: Interval[] = [];
  for (const x of iv) {
    let cur: Interval[] = [{ ...x }];
    for (const b of busy) {
      const next: Interval[] = [];
      for (const c of cur) {
        if (b.end <= c.start || b.start >= c.end) {
          next.push(c);
          continue;
        }
        if (c.start < b.start) next.push({ start: c.start, end: b.start });
        if (b.end < c.end) next.push({ start: b.end, end: c.end });
      }
      cur = next;
    }
    res.push(...cur);
  }
  return res;
}

export function intersectIntervals(iv: readonly Interval[], other: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const a of iv)
    for (const b of other) {
      const s = Math.max(a.start, b.start);
      const e = Math.min(a.end, b.end);
      if (e > s) out.push({ start: s, end: e });
    }
  return out;
}

export const overlaps = (a: Interval, b: Interval): boolean => Math.min(a.end, b.end) > Math.max(a.start, b.start);
export const totalHours = (iv: readonly Interval[]): number => iv.reduce((s, x) => s + (x.end - x.start), 0) / HOUR;
