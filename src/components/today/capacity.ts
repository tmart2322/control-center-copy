/**
 * Day capacity (DESIGN-V2 "Capacity and estimates", binding): only today-scoped, hands-on minutes count;
 * agent time runs in the background and never counts; "over" only when that work exceeds the free time
 * outside meetings.
 *
 * The engine's `TodayHeader.capacity` (youMinToday · freeMin · openMin · fits · agentMinBackground ·
 * agentRunsBackground · pullForward[]) wins. When a field is missing (an older payload) the page derives
 * the same number from what it has. The legacy `focusMinLeft` / `plannedMin` / `overByMin` aliases are not
 * read: the v2 names say the same thing.
 */
import type { CalendarEvent, TodayHeader } from '@/contract';
import { freeIntervals } from './timeline';
import { minuteOfDay, sameLocalDay } from './time';


/** Read defensively: any field may be missing in an older payload (the page derives it then). */
export type CapacityIn = Partial<TodayHeader['capacity']>;

export interface DayCapacity {
  youMin: number;
  freeMin: number;
  openMin: number;
  fits: boolean;
  /** > 0 only when today-scoped hands-on work truly exceeds the free time. */
  overByMin: number;
  agentMin: number;
  agentRuns: number;
  /** Which numbers came from the engine (the rest were derived here). */
  fromEngine: boolean;
  /** MIN-22: the engine counted the next working day (today's working hours are over). */
  next: boolean;
  /** "today", "tomorrow", "Monday". */
  dayLabel: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Free minutes from now (or the day start) to the end of the working day, outside meetings you attend. */
export function freeMinutesLeft(events: CalendarEvent[], nowIso: string, tz: string | undefined, workStart: number, workEnd: number): number {
  const now = minuteOfDay(nowIso, tz);
  const from = Math.max(now, workStart);
  if (from >= workEnd) return 0;
  const busy = events
    .filter((e) => sameLocalDay(e.start, nowIso, tz) && !['declined', 'cancelled'].includes(e.attendance))
    .map((e) => ({ s: minuteOfDay(e.start, tz), e: sameLocalDay(e.end, e.start, tz) ? minuteOfDay(e.end, tz) : 24 * 60 }));
  return freeIntervals(from, workEnd, busy).reduce((sum, g) => sum + (g.e - g.s), 0);
}

export function resolveCapacity(
  cap: CapacityIn | undefined,
  derived: { youMin: number; freeMin: number; agentMin: number; agentRuns: number },
): DayCapacity {
  const youMin = num(cap?.youMinToday) ?? derived.youMin;
  const freeMin = num(cap?.freeMin) ?? derived.freeMin;
  const openMin = num(cap?.openMin) ?? Math.max(0, freeMin - youMin);
  const fits = typeof cap?.fits === 'boolean' ? cap.fits : youMin <= freeMin;
  return {
    youMin,
    freeMin,
    openMin,
    fits,
    overByMin: fits ? 0 : Math.max(0, youMin - freeMin),
    agentMin: num(cap?.agentMinBackground) ?? derived.agentMin,
    agentRuns: num(cap?.agentRunsBackground) ?? derived.agentRuns,
    fromEngine: num(cap?.youMinToday) !== null,
    next: cap?.day === 'next',
    dayLabel: cap?.day === 'next' && cap.dayLabel ? cap.dayLabel : 'today',
  };
}

/** A pull-forward reference from the engine, whatever shape it arrives in. */
export interface PullRef {
  itemId: string | null;
  title: string | null;
  youMin: number | null;
  due: string | null;
  why: string | null;
}

export function normalizePullForward(list: unknown[] | undefined): PullRef[] | null {
  if (!Array.isArray(list)) return null;
  const out: PullRef[] = [];
  for (const raw of list) {
    if (typeof raw === 'string') {
      out.push({ itemId: raw, title: null, youMin: null, due: null, why: null });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const item = (r.item && typeof r.item === 'object' ? r.item : null) as Record<string, unknown> | null;
    const id = [r.itemId, r.workItemId, item?.id, r.id].find((v): v is string => typeof v === 'string') ?? null;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const effort = (item?.effort ?? r.effort) as { youMin?: unknown } | undefined;
    out.push({
      itemId: id,
      title: str(r.title) ?? str(item?.title),
      youMin: num(r.youMin) ?? num(effort?.youMin),
      due: str(r.due) ?? str(item?.due),
      why: str(r.why) ?? str(r.reason) ?? str(r.hint) ?? null,
    });
  }
  return out;
}
