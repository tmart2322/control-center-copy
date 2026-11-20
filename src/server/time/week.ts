/**
 * Time's week, the same in both DataSources (D-65):
 *
 *   TL-34  the week is Monday 00:00 to the next Monday 00:00 in the profile timezone, the projections' own week
 *          (src/projections/run.ts projectWeek), never the server's
 *   TL-45  the totals read the one status → count map (src/engines/activity/org62-check.ts countBucketOf)
 */
import type { ActivityEntry, TimeWeek } from '@/contract';
import { addDays, countBucketOf, localDay, needsRelog, weekStart, zonedToMs } from '@/engines/activity';

export interface TimeWeekBounds {
  /** Monday and Sunday, local days. */
  start: string;
  end: string;
  /** [from, to) epoch ms: local Monday 00:00 to the next local Monday 00:00. */
  from: number;
  to: number;
}

/** The local week holding `week` (any day of it, YYYY-MM-DD), or the week of `now`. */
export function timeWeekBounds(week: string | undefined, now: Date, tz: string): TimeWeekBounds {
  const day = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : localDay(now.getTime(), tz);
  const start = weekStart(day);
  return { start, end: addDays(start, 6), from: zonedToMs(start, '00:00', tz), to: zonedToMs(addDays(start, 7), '00:00', tz) };
}

export const inTimeWeek = (b: Pick<TimeWeekBounds, 'from' | 'to'>, iso: string): boolean => Date.parse(iso) >= b.from && Date.parse(iso) < b.to;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The week's totals: hours per count bucket, and the rows that need you (to review, differing, not in Org62). */
export function weekTotals(entries: readonly ActivityEntry[]): TimeWeek['totals'] {
  const sum = (b: ReturnType<typeof countBucketOf>) => r2(entries.filter((e) => countBucketOf(e) === b).reduce((s, e) => s + e.durationH, 0));
  return {
    proposedH: sum('proposed'),
    approvedH: sum('approved'),
    loggedH: sum('logged'),
    needsReview: entries.filter((e) => e.status === 'proposed' || e.status === 'needs_input' || e.status === 'verify_failed' || needsRelog(e)).length,
  };
}
