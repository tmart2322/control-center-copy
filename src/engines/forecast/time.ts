/**
 * Fiscal quarters as `SpecialistForecast__c.FiscalQuarter__c` writes them ("FY27 Q4": checked read-only against Org62,
 * 2026-11-11) and the weekly notes deadline (the persona's `notesDueWeekday` at `notesDueAt`, local). Pure.
 *
 * The Salesforce fiscal year starts on 1 February: FY27 = Feb 2026 to Jan 2027, Q1 = Feb–Apr … Q4 = Nov–Jan.
 */
import { atLocal, DAY_MS, toMs, zoned } from '@/engines/home/time';

const LABEL = /^FY(\d{2})\s*Q([1-4])$/i;

/** "2026-11-11" → "FY27 Q4". */
export function sfrQuarterOfDay(day: string): string {
  const [y, mo] = day.split('-').map(Number) as [number, number];
  const fy = mo >= 2 ? y + 1 : y;
  const q = Math.floor(((mo + 10) % 12) / 3) + 1;
  return `FY${String(fy % 100).padStart(2, '0')} Q${q}`;
}

/** "FY27 Q4" → "FY28 Q1"; null for anything else. */
export function nextSfrQuarter(label: string): string | null {
  const m = LABEL.exec(label.trim());
  if (!m) return null;
  const fy = Number(m[1]);
  const q = Number(m[2]);
  return q === 4 ? `FY${String((fy + 1) % 100).padStart(2, '0')} Q1` : `FY${m[1]} Q${q + 1}`;
}

/** "FY27 Q4" → { start: '2026-11-01', end: '2027-01-31' }; null for anything else. */
export function sfrQuarterBounds(label: string): { start: string; end: string } | null {
  const m = LABEL.exec(label.trim());
  if (!m) return null;
  const fy = 2000 + Number(m[1]);
  const q = Number(m[2]);
  // Q1 starts in February of the calendar year before the fiscal year's number
  const startMonth = 2 + (q - 1) * 3; // 2, 5, 8, 11
  const y0 = fy - 1;
  const start = new Date(Date.UTC(y0, startMonth - 1, 1));
  const end = new Date(Date.UTC(y0, startMonth - 1 + 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** "fy27  q4" → "FY27 Q4" (as Org62 writes it); anything else unchanged. */
export function normalizeQuarter(label: string | null | undefined): string | null {
  if (!label) return null;
  const m = LABEL.exec(label.trim());
  return m ? `FY${m[1]} Q${m[2]}` : label.trim();
}

/** The quarter a local day of `now` is in, and the one after it: the window `forecast.sync` reads. */
export function quarterPair(nowMs: number, tz: string): { current: string; next: string } {
  const p = zoned(nowMs, tz);
  const current = sfrQuarterOfDay(`${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`);
  return { current, next: nextSfrQuarter(current)! };
}

/** "09:00" → [9, 0]; anything unreadable → [9, 0]. */
export function parseDueAt(s: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return [9, 0];
  const h = Math.min(23, Number(m[1]));
  const mi = Math.min(59, Number(m[2]));
  return [h, mi];
}

/**
 * The notes deadlines around `now`: `prevMs` is the latest one at or before now, `nextMs` the first one after it
 * (weekday 0 = Sunday … 6 = Saturday, at `dueAt` local time; DST-safe).
 */
export function notesDue(nowMs: number, tz: string, weekday: number, dueAt: string): { prevMs: number; nextMs: number } {
  const [hh, mm] = parseDueAt(dueAt);
  const p = zoned(nowMs, tz);
  const back = (p.weekday - (((weekday % 7) + 7) % 7) + 7) % 7;
  const at = (daysFromToday: number) => {
    const d = new Date(Date.UTC(p.y, p.m - 1, p.d + daysFromToday));
    return atLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hh, mm, tz);
  };
  let prev = at(-back);
  if (prev > nowMs) prev = at(-back - 7);
  // the next one: seven local days on (not 7 × 24 h, which drifts an hour across DST)
  const pz = zoned(prev, tz);
  const n = new Date(Date.UTC(pz.y, pz.m - 1, pz.d + 7));
  const next = atLocal(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), hh, mm, tz);
  return { prevMs: prev, nextMs: next };
}

/** Whole days from `fromIso` to `nowMs` (floor; never negative). */
export function ageDays(fromIso: string | null, nowMs: number): number | null {
  if (!fromIso) return null;
  const t = toMs(fromIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}
