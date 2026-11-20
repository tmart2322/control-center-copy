/**
 * Time formatting for domain components. Times render in the user's profile timezone
 * (settings.profile.timezone, CONTRACT.md), never the browser's. Pure functions: pass `now` explicitly
 * so server and client render the same text.
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

const ms = (iso: string) => new Date(iso).getTime();

/** "09:05" (24 h). */
export function clock(iso: string, tz?: string): string {
  return dtf(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** "Thu 5 Nov". */
export function dayLabel(iso: string, tz?: string): string {
  const p = dtf(tz, { weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}`;
}

/** "Fri". */
export function weekday(iso: string, tz?: string): string {
  return dtf(tz, { weekday: 'short' }).format(new Date(iso));
}

/** "YYYY-MM-DD" in tz. */
export function ymd(iso: string, tz?: string): string {
  const p = dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function sameDay(a: string, b: string, tz?: string): boolean {
  return ymd(a, tz) === ymd(b, tz);
}

/** Whole minutes from a to b (b − a). */
export function minutesBetween(a: string, b: string): number {
  return Math.round((ms(b) - ms(a)) / 60_000);
}

/** "5m" · "1h" · "1h40m" · "2d". */
export function dur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h${String(r).padStart(2, '0')}m` : `${h}h`;
  }
  return `${Math.round(m / 1440)}d`;
}

/** Compact age: "now" · "12m" · "3h" · "6d". */
export function age(iso: string, now: string): string {
  const m = minutesBetween(iso, now);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/** "12m ago" · "just now". */
export function ago(iso: string, now: string): string {
  const a = age(iso, now);
  return a === 'now' ? 'just now' : `${a} ago`;
}

/** "11:00" today · "Fri 12:00" this week · "18 Nov" later. */
export function dueLabel(iso: string, now: string, tz?: string): string {
  if (sameDay(iso, now, tz)) return clock(iso, tz);
  const days = (ms(iso) - ms(now)) / 86_400_000;
  if (days > -6 && days < 6) return `${weekday(iso, tz)} ${clock(iso, tz)}`;
  const p = dtf(tz, { day: 'numeric', month: 'short' }).format(new Date(iso));
  return p;
}

/** Offset (minutes) of tz from UTC at instant t. */
function tzOffsetMin(t: number, tz?: string): number {
  const p = dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - t) / 60_000);
}

/** A wall-clock time ("2026-11-05", "09:30") in tz → ISO instant. */
export function zonedIso(date: string, hhmm: string, tz?: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y!, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  let t = guess - tzOffsetMin(guess, tz) * 60_000;
  t = guess - tzOffsetMin(t, tz) * 60_000; // second pass settles DST edges
  return new Date(t).toISOString();
}

/** Strip a leading "10:05 " clock prefix from engine labels (the spine shows its own time column). */
export function stripClock(label: string): string {
  return label.replace(/^\s*\d{1,2}:\d{2}\s*/, '');
}

/** Short due for narrow columns: "11:00" today · "Fri" this week · "4 Dec" later. */
export function shortDue(iso: string, now: string, tz?: string): string {
  if (sameDay(iso, now, tz)) return clock(iso, tz);
  const days = (ms(iso) - ms(now)) / 86_400_000;
  if (days > -6 && days < 6) return weekday(iso, tz);
  return dtf(tz, { day: 'numeric', month: 'short' }).format(new Date(iso));
}
