/** Local-day math for the stress campaign (DST-safe; the user's zone is America/Denver by default). */

export const TZ = process.env.CC_STRESS_TZ ?? 'America/Denver';

/** Offset (ms) of `zone` at instant `t`: local wall clock minus UTC. */
export function zoneOffsetMs(t: number, zone = TZ): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** UTC instant of local wall time `YYYY-MM-DD` + `HH:MM` in `zone`. */
export function localToUtc(day: string, hm = '00:00', zone = TZ): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset across a DST edge.
  let t = guess - zoneOffsetMs(guess, zone);
  t = guess - zoneOffsetMs(t, zone);
  return new Date(t);
}

export function dayBounds(day: string, zone = TZ): { from: string; to: string } {
  return { from: localToUtc(day, '00:00', zone).toISOString(), to: localToUtc(addDays(day, 1), '00:00', zone).toISOString() };
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function localDay(t: Date | number | string, zone = TZ): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date(t));
}

export function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

export const unix = (iso: string | Date) => Math.floor(new Date(iso).getTime() / 1000);
