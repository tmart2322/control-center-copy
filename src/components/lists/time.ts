/**
 * Time helpers for the list pages (pure; the profile timezone is always passed in, never the browser's).
 */

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${tz ?? ''}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz });
    cache.set(key, f);
  }
  return f;
}

function parts(at: Date, tz: string | undefined) {
  const p = dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** "YYYY-MM-DD" of an instant in the zone. */
export function ymdIn(iso: string | Date, tz?: string): string {
  const { y, m, d } = parts(typeof iso === 'string' ? new Date(iso) : iso, tz);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Whole calendar days from `a` to `b` in the zone (b - a). */
export function dayDiff(a: string | Date, b: string | Date, tz?: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((toUtc(ymdIn(b, tz)) - toUtc(ymdIn(a, tz))) / 86_400_000);
}

/** Offset (ms) of the zone from UTC at an instant. */
function offsetAt(at: Date, tz: string | undefined): number {
  const p = parts(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads y-m-d hh:mm. */
export function zonedInstant(ymd: string, hh: number, mm: number, tz?: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh, mm, 0);
  let t = guess - offsetAt(new Date(guess), tz);
  // One more pass handles a DST edge between the guess and the result.
  t = guess - offsetAt(new Date(t), tz);
  return new Date(t);
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export interface SnoozePreset {
  id: string;
  label: string;
  /** Wall-clock hint shown beside the label ("17:00", "Thu 09:00"). */
  hint: string;
  until: string;
}

/** Snooze presets in the user's zone. Later today is only offered while it is still ahead. */
export function snoozePresets(now: string | Date, tz?: string): SnoozePreset[] {
  const n = typeof now === 'string' ? new Date(now) : now;
  const today = ymdIn(n, tz);
  const wd = dtf(tz, { weekday: 'short' });
  const hm = (d: Date) => dtf(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const out: SnoozePreset[] = [];
  const later = zonedInstant(today, 17, 0, tz);
  if (later.getTime() - n.getTime() > 60 * 60_000) out.push({ id: 'later_today', label: 'Later today', hint: hm(later), until: later.toISOString() });
  const tomorrow = zonedInstant(addDays(today, 1), 9, 0, tz);
  out.push({ id: 'tomorrow', label: 'Tomorrow morning', hint: `${wd.format(tomorrow)} ${hm(tomorrow)}`, until: tomorrow.toISOString() });
  // Next Monday strictly after today.
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat (calendar day, zone-independent)
  const toMon = (8 - dow) % 7 || 7;
  const monday = zonedInstant(addDays(today, toMon), 9, 0, tz);
  out.push({ id: 'next_week', label: 'Next week', hint: `${wd.format(monday)} ${hm(monday)}`, until: monday.toISOString() });
  return out;
}
