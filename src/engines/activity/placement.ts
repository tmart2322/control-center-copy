/** Place an off-calendar block into a free gap of the local day (port of autoplan._place). Pure. */
import { type Interval, HOUR, MIN, addDays, subtractIntervals, zonedToMs } from './time';

export const PREF_TIMES: Readonly<Record<string, string>> = {
  early: '06:30',
  morning: '07:30',
  afternoon: '12:30',
  evening: '17:30',
};

/**
 * First free gap of `hours` at/after the preferred time within 07:00 to 22:30 (then from 07:00).
 * On a day with no gap left, keeps the preferred time: an overlap on Org62 beats a 2 a.m. entry.
 * Returns epoch ms.
 */
export function placeInFreeGap(day: string, hours: number, pref: string | undefined, busy: readonly Interval[], tz: string): number {
  const need = hours * HOUR;
  const hm = pref ? (PREF_TIMES[pref] ?? (/^\d{1,2}:\d{2}$/.test(pref) ? pref : '12:30')) : '12:30';
  const prefT = zonedToMs(day, hm, tz);
  const latest = zonedToMs(day, '22:30', tz);
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  for (const startAt of [prefT, zonedToMs(day, '07:00', tz)]) {
    let t = startAt;
    for (const b of sorted) {
      if (b.end <= t) continue;
      if (b.start - t >= need) break;
      t = Math.max(t, b.end);
    }
    if (t + need <= latest) return t;
  }
  return Math.min(prefT, latest - need);
}

const QUARTER = 15 * MIN;

/**
 * Solo work (engaged time) as rows: `hours` (a multiple of 0.25) laid into the free time of the local day (never
 * overnight, never over `busy`). One row where one free gap holds it all: the first such gap at or after `fromMs` (its
 * first engaged minute), else the latest one before it. Otherwise the fewest rows: the largest free gaps first (at or
 * after `fromMs` before earlier ones), each taking whole quarter hours (D-40), so the pieces add up to `hours` exactly.
 * What does not fit (a day with no free time left) is returned as `unplaced`.
 */
export function placeAcross(day: string, hours: number, fromMs: number, busy: readonly Interval[], tz: string): { pieces: Interval[]; unplaced: number } {
  const dayStart = zonedToMs(day, '00:00', tz);
  const dayEnd = zonedToMs(addDays(day, 1), '00:00', tz);
  const from = Math.min(Math.max(fromMs, dayStart), dayEnd);
  const free = subtractIntervals([{ start: dayStart, end: dayEnd }], busy).sort((a, b) => a.start - b.start);
  const need = Math.round(hours * 4);
  const quarters = (iv: Interval) => Math.floor((iv.end - iv.start) / QUARTER);
  // after `from`: the part of each gap from `from` on; before it: whole gaps that end by `from`
  const after = free.filter((iv) => iv.end > from).map((iv) => ({ start: Math.max(iv.start, from), end: iv.end }));
  const before = free.filter((iv) => iv.end <= from).reverse();
  const whole = after.find((iv) => quarters(iv) >= need);
  if (whole) return { pieces: need ? [{ start: whole.start, end: whole.start + need * QUARTER }] : [], unplaced: 0 };
  const earlier = before.find((iv) => quarters(iv) >= need);
  if (earlier) return { pieces: [{ start: earlier.end - need * QUARTER, end: earlier.end }], unplaced: 0 };
  // split: the largest gaps first, so the day's work lands in as few rows as it can
  const gaps = [...after.map((iv, i) => ({ iv, rank: i, late: false })), ...before.map((iv, i) => ({ iv, rank: i, late: true }))].sort(
    (a, b) => quarters(b.iv) - quarters(a.iv) || Number(a.late) - Number(b.late) || a.rank - b.rank,
  );
  let left = need;
  const pieces: Interval[] = [];
  for (const g of gaps) {
    if (left <= 0) break;
    const n = Math.min(left, quarters(g.iv));
    if (n <= 0) continue;
    left -= n;
    pieces.push(g.late ? { start: g.iv.end - n * QUARTER, end: g.iv.end } : { start: g.iv.start, end: g.iv.start + n * QUARTER });
  }
  return { pieces: pieces.sort((a, b) => a.start - b.start), unplaced: left / 4 };
}
