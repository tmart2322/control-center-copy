/**
 * Pure rules the stores apply when the scanner proposes an item (store-db and store-memory share them).
 *
 *  - DUE-1 `parseDue`: a bare date (`2026-11-04`) means 17:00 in the user's timezone, and a date-time without a zone is
 *    read in that timezone. Before, `Date.parse` made a bare date UTC midnight: the evening before in the Americas, so
 *    13 items of the first 30-day scan were due before they were asked.
 *  - DUP-1 `sameDeliverable`: two proposals from the same conversation and the same person are one item when their
 *    titles share enough words (the person's own name aside). Before, only an identical origin message deduped.
 */
import { atLocal } from '@/engines/home/time';

import { tokenize } from './store-memory';

/** The hour a bare due date means (R7: "EOD" and day-only deadlines are 17:00 local). */
export const BARE_DATE_HOUR = 17;

/** A due value as an instant (ms), read in `tz` when it carries no zone. NaN when unparseable. */
export function parseDue(v: string | undefined | null, tz: string): number {
  const t = (v ?? '').trim();
  if (!t) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(t);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
    const hh = m[4] !== undefined ? Number(m[4]) : BARE_DATE_HOUR;
    const mm = m[5] !== undefined ? Number(m[5]) : 0;
    try {
      return atLocal(y, mo, d, hh, mm, tz) + (m[6] ? Number(m[6]) * 1000 : 0);
    } catch {
      return Date.UTC(y, mo - 1, d, hh, mm);
    }
  }
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? NaN : ms;
}

/** Title words that name a person (their name parts), so a shared name alone never makes two items one. */
export function nameWords(...names: Array<string | null | undefined>): Set<string> {
  return new Set(names.flatMap((n) => tokenize(n ?? '')));
}

/**
 * Do two titles name the same deliverable? At least two shared words, covering at least half of the shorter title
 * (stop words and the person's name left out).
 */
export function sameDeliverable(a: string, b: string, exclude: Set<string> = new Set()): boolean {
  const x = new Set(tokenize(a).filter((w) => !exclude.has(w)));
  const y = new Set(tokenize(b).filter((w) => !exclude.has(w)));
  if (!x.size || !y.size) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared >= 2 && shared / Math.min(x.size, y.size) >= 0.5;
}
