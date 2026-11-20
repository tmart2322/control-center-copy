/**
 * The quarter total on Time and Today: hours logged in Org62 (logged / verified rows) in the CURRENT Salesforce
 * fiscal quarter only. The fiscal year starts on 1 February (FY27 = Feb 2026 to Jan 2027; quarters start in Feb,
 * May, Aug and Nov), the same rule as `fiscalQuarter()` in bootstrap.ts and `quarterBounds()` in
 * src/components/time/derive.ts. Projections write logged rows for every quarter (past weeks and History show
 * them), so the total must not simply add up every logged row.
 *
 * The quarter is the one `cc.meta` names, as long as `now` is still inside it. After a rollover the stored label
 * is stale: the current quarter is computed from `now` (its own label and due date, no seeded base hours).
 */
import type { ActivityEntry, SeedMeta } from '@/contract';
import { countsAsLogged } from '@/engines/activity/org62-check';
import { localDay, zonedToMs } from '@/engines/activity/time';

export interface QuarterWindow {
  label: string;
  /** First and last local day (YYYY-MM-DD, inclusive). */
  start: string;
  end: string;
  due: string;
  targetH: number;
  /** Hours logged before the seeded rows (seed meta); 0 on a live install or after a rollover. */
  baseH: number;
}

/** `Q4 FY27` → 2026-11-01 … 2027-01-31; null for anything else. */
export function fiscalQuarterBounds(label: string): { start: string; end: string } | null {
  const m = /^Q([1-4])\s+FY(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const q = Number(m[1]);
  const fy = 2000 + Number(m[2]);
  const startMonth = 1 + (q - 1) * 3; // 0-based: Feb, May, Aug, Nov, all in calendar year fy − 1
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { start: day(new Date(Date.UTC(fy - 1, startMonth, 1))), end: day(new Date(Date.UTC(fy - 1, startMonth + 3, 0))) };
}

/** The fiscal quarter containing `now` in `tz`. */
export function fiscalQuarterAt(now: Date, tz: string, dayEnd = '18:00'): { label: string; start: string; end: string; due: string } {
  const today = localDay(now.getTime(), tz);
  const [y, mo] = today.split('-').map(Number) as [number, number];
  const fy = mo >= 2 ? y + 1 : y;
  const q = Math.floor(((mo + 10) % 12) / 3) + 1; // Feb → Q1 … Jan → Q4
  const label = `Q${q} FY${String(fy % 100).padStart(2, '0')}`;
  const b = fiscalQuarterBounds(label)!;
  const end = dayEnd === '24:00' ? '23:59' : dayEnd;
  return { label, ...b, due: new Date(zonedToMs(b.end, end, tz)).toISOString() };
}

export function currentQuarter(meta: Pick<SeedMeta, 'quarter'>, now: Date, tz: string, dayEnd = '18:00'): QuarterWindow {
  const stored = fiscalQuarterBounds(meta.quarter.label);
  const today = localDay(now.getTime(), tz);
  if (stored && today >= stored.start && today <= stored.end) {
    return { label: meta.quarter.label, ...stored, due: meta.quarter.due, targetH: meta.quarter.targetH, baseH: meta.quarter.loggedH };
  }
  if (!stored && !/^Q[1-4]\s+FY\d{2}$/.test(meta.quarter.label.trim())) {
    // a label this module cannot read (a seed's own wording): keep it, count the quarter `now` is in
    const q = fiscalQuarterAt(now, tz, dayEnd);
    return { label: meta.quarter.label, start: q.start, end: q.end, due: meta.quarter.due, targetH: meta.quarter.targetH, baseH: meta.quarter.loggedH };
  }
  const q = fiscalQuarterAt(now, tz, dayEnd);
  return { label: q.label, start: q.start, end: q.end, due: q.due, targetH: meta.quarter.targetH, baseH: 0 };
}

type Counted = Pick<ActivityEntry, 'status' | 'date' | 'durationH'> & { issues?: readonly string[] };

/** Hours of rows counted as logged (TL-45: the one count map) whose local work day falls in the quarter. */
export function quarterLoggedH(activity: readonly Counted[], q: Pick<QuarterWindow, 'start' | 'end'>): number {
  return activity.filter((a) => countsAsLogged(a) && a.date >= q.start && a.date <= q.end).reduce((s, a) => s + a.durationH, 0);
}

/** The payload's quarter block: base + this quarter's logged rows, two decimals. */
export function quarterTotal(meta: Pick<SeedMeta, 'quarter'>, activity: readonly Counted[], now: Date, tz: string, dayEnd?: string): { q: QuarterWindow; loggedH: number } {
  const q = currentQuarter(meta, now, tz, dayEnd);
  return { q, loggedH: Math.round((q.baseH + quarterLoggedH(activity, q)) * 100) / 100 };
}
