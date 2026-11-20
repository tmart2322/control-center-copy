/**
 * Wall-clock helpers in the profile timezone (CONTRACT: the UI formats times in
 * settings.profile.timezone, not the browser's). Pure; no date-fns-tz dependency.
 */

export interface WallParts {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The wall-clock parts of an instant in `tz` (undefined = the runtime's zone). */
export function wallParts(at: Date | string | number, tz?: string): WallParts {
  const date = new Date(at);
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hh: Number(p.hour) % 24,
    mm: Number(p.minute),
    weekday: Math.max(0, WEEKDAYS.indexOf(p.weekday ?? 'Sun')),
  };
}

/** Offset (ms) of `tz` at instant `t`: wall time read as UTC minus the instant. */
function offsetAt(t: number, tz?: string): number {
  const w = wallParts(t, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  return asUtc - Math.floor(t / 60_000) * 60_000;
}

/** The instant whose wall clock in `tz` reads y-m-d hh:mm (DST-safe to the minute). */
export function fromWall(y: number, m: number, d: number, hh: number, mm: number, tz?: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetAt(guess, tz);
  t = guess - offsetAt(t, tz);
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → "YYYY-MM-DDTHH:mm" for <input type="datetime-local">, in `tz`. */
export function toLocalInput(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '';
  const w = wallParts(iso, tz);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}T${pad(w.hh)}:${pad(w.mm)}`;
}

/** "YYYY-MM-DDTHH:mm" read in `tz` → ISO instant (null when empty or invalid). */
export function fromLocalInput(value: string, tz?: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m.map(Number) as [number, number, number, number, number, number];
  return fromWall(y, mo, d, hh, mm, tz).toISOString();
}

/** Calendar-day difference between two instants as seen in `tz` (b − a). */
export function dayDiff(a: Date | string, b: Date | string, tz?: string): number {
  const pa = wallParts(a, tz);
  const pb = wallParts(b, tz);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** "13:30" / "Today 13:30" / "Tomorrow 9:00" / "Fri 12:00" / "Nov 12 9:00" relative to `now`, in `tz`. */
export function fmtWhen(iso: string, now: Date | string, tz?: string, opts: { today?: boolean } = {}): string {
  const w = wallParts(iso, tz);
  const time = `${pad(w.hh)}:${pad(w.mm)}`;
  const diff = dayDiff(now, iso, tz);
  if (diff === 0) return opts.today ? `Today ${time}` : time;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  if (diff > 1 && diff < 7) return `${WEEKDAYS[w.weekday]} ${time}`;
  const month = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' }).format(new Date(iso));
  return `${month} ${w.d} ${time}`;
}

export interface WhenPreset {
  id: string;
  label: string;
  at: string;
}

/** Snooze / due presets in the profile timezone. */
export function whenPresets(now: Date | string, tz?: string): WhenPreset[] {
  const n = new Date(now);
  const w = wallParts(n, tz);
  const at = (dayOffset: number, hh: number, mm = 0) => fromWall(w.y, w.m, w.d + dayOffset, hh, mm, tz).toISOString();
  // Later today: +3 h, rounded up to the quarter hour.
  const later = new Date(Math.ceil((n.getTime() + 3 * 3_600_000) / 900_000) * 900_000).toISOString();
  const toMonday = ((8 - w.weekday) % 7) || 7;
  const out: WhenPreset[] = [];
  if (w.hh < 20) out.push({ id: 'later', label: 'Later today', at: later });
  out.push({ id: 'eod', label: 'Today 17:00', at: at(0, 17) });
  out.push({ id: 'tomorrow', label: 'Tomorrow 09:00', at: at(1, 9) });
  out.push({ id: 'monday', label: 'Monday 09:00', at: at(toMonday, 9) });
  out.push({ id: 'week', label: 'In a week', at: at(7, 9) });
  return out.filter((p) => Date.parse(p.at) > n.getTime());
}
