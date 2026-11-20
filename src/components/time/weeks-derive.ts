/**
 * Activity ▸ Org62 ▸ Weeks: the week picker (pure, tested in ./weeks-derive.test.ts). The weeks of the current fiscal
 * quarter and the one before, grouped by quarter, newest last; each with the hours the app found that week (live rows:
 * not dismissed, not upcoming) and how many of them are in Org62. A week is its Monday.
 */
import type { ActivityLog } from '@/contract';

import { quarterBounds, shiftWeek } from './derive';
import { mondayOf } from './path-derive';

/** The fiscal quarter before ("Q1 FY28" → "Q4 FY27"). */
export function previousQuarter(label: string): string | null {
  const m = /^Q([1-4])\s+FY(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const q = Number(m[1]);
  const fy = Number(m[2]);
  return q === 1 ? `Q4 FY${String(fy - 1).padStart(2, '0')}` : `Q${q - 1} FY${m[2]}`;
}

/** The days the picker reads (GET /time/log): from the previous quarter's first day to this week's Sunday. */
export function pickerRange(quarterLabel: string, weekEnd: string): { from: string; to: string } | null {
  const prev = previousQuarter(quarterLabel);
  const b = prev ? quarterBounds(prev) : null;
  return b ? { from: b.start, to: weekEnd } : null;
}

export interface WeekChip {
  monday: string;
  /** "Nov 9" */
  label: string;
  hours: number;
  loggedH: number;
  /** Logged share of the found hours, 0–100. */
  pct: number;
  current: boolean;
}

export interface WeekGroup {
  quarter: string;
  weeks: WeekChip[];
}

const fmt = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Every week from the previous quarter's first Monday to this one, with its totals, grouped by fiscal quarter. */
export function weekGroups(log: Pick<ActivityLog, 'weeks'> | null | undefined, quarterLabel: string, currentMonday: string): WeekGroup[] {
  const prev = previousQuarter(quarterLabel);
  const cur = quarterBounds(quarterLabel);
  const before = prev ? quarterBounds(prev) : null;
  if (!cur) return [];
  const totals = new Map((log?.weeks ?? []).map((w) => [w.weekStart, w] as const));
  const first = mondayOf(before?.start ?? cur.start);
  const groups: WeekGroup[] = [];
  for (let m = first; m <= currentMonday; m = shiftWeek(m, 1)) {
    const q = m >= mondayOf(cur.start) && cur ? quarterLabel : (prev ?? quarterLabel);
    const t = totals.get(m);
    const hours = r2(t?.hours ?? 0);
    const loggedH = r2(Math.min(t?.loggedH ?? 0, hours || (t?.loggedH ?? 0)));
    const chip: WeekChip = { monday: m, label: fmt(m), hours, loggedH, pct: hours > 0 ? Math.round((Math.min(loggedH, hours) / hours) * 100) : 0, current: m === currentMonday };
    const g = groups.at(-1);
    if (g && g.quarter === q) g.weeks.push(chip);
    else groups.push({ quarter: q, weeks: [chip] });
  }
  return groups;
}
