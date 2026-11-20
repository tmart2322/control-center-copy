'use client';
/**
 * The History calendar: one month, Monday first, one cell per day with a light summary of what was done (your hours,
 * items finished) and a neutral bar for the hours. Quiet days show only their number. Selection is the one loud
 * thing (blue, DESIGN-V2 "loud selection"); today is marked as "now". No per-account or per-source colour.
 *
 * The grid fills the pane's height (rows share it), so the calendar never scrolls the page. Cells condense with the
 * pane's width (`@container/cal`): below 26rem they keep the number, the hours and the bar.
 */
import type { HistoryDaySummary, HistoryMonth } from '@/contract';
import { cn } from '@/ui';
import { cellLabel, longDay } from './derive';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
/** Hours that fill the bar (a full working day). */
const FULL_DAY_H = 8;

export interface HistoryCalendarProps {
  month: HistoryMonth;
  selected: string;
  onSelect: (day: string) => void;
}

export function HistoryCalendar({ month, selected, onSelect }: HistoryCalendarProps) {
  const rows = Math.ceil(month.days.length / 7);
  return (
    <div className="@container/cal flex min-h-0 flex-1 flex-col px-3 pb-3">
      <div aria-hidden className="grid shrink-0 grid-cols-7 gap-1 px-0.5 pb-1">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={cn('px-1.5 text-caption text-muted', i >= 5 && 'text-faint')}>
            {w}
          </span>
        ))}
      </div>
      <div role="grid" aria-label={`${month.label}: what was done each day`} className="grid min-h-0 flex-1 grid-cols-7 gap-1" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} role="row" className="contents">
            {month.days.slice(r * 7, r * 7 + 7).map((d) => (
              <DayCell key={d.day} d={d} selected={d.day === selected} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayCell({ d, selected, onSelect }: { d: HistoryDaySummary; selected: boolean; onSelect: (day: string) => void }) {
  const dom = Number(d.day.slice(8));
  const quiet = !d.active;
  const barPct = Math.min(100, Math.round((d.yourH / FULL_DAY_H) * 100));
  return (
    <div role="gridcell" aria-selected={selected} className="min-h-0 min-w-0">
      <button
        type="button"
        data-history-day={d.day}
        data-active={d.active ? '' : undefined}
        aria-label={cellLabel(d, longDay(d.day))}
        aria-current={d.isToday ? 'date' : undefined}
        disabled={d.future}
        onClick={() => onSelect(d.day)}
        className={cn(
          'relative flex h-full min-h-12 w-full min-w-0 flex-col items-stretch gap-0.5 overflow-hidden rounded-md border px-1.5 pt-1 pb-1.5 text-left outline-none @max-[26rem]/cal:px-1',
          'focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]',
          selected ? 'border-accent bg-selected' : d.isToday ? 'border-line-strong bg-surface' : 'border-transparent',
          !selected && !d.future && 'hover:bg-surface-muted',
          !d.inMonth && !selected && 'opacity-60',
          d.future && 'cursor-default opacity-40',
        )}
      >
        <span className="flex min-w-0 items-baseline gap-1">
          <span className={cn('text-body tabular-nums', d.isToday ? 'font-bold text-accent' : quiet ? 'text-muted' : 'font-bold text-fg-heading')}>{dom}</span>
        </span>
        {d.yourH ? <span className="truncate text-caption text-fg tabular-nums">{`${Math.round(d.yourH * 100) / 100}h`}</span> : null}
        {d.finished ? <span className="truncate text-caption text-muted tabular-nums @max-[26rem]/cal:hidden">{d.finished} done</span> : null}
        {!d.yourH && !d.finished && d.active ? <span className="truncate text-caption text-faint @max-[26rem]/cal:hidden">{otherLine(d)}</span> : null}
        {d.yourH ? (
          <span aria-hidden className="absolute inset-x-1.5 bottom-1 h-1 overflow-hidden rounded-full bg-surface-sunken">
            <span className="block h-full rounded-full bg-line-strong" style={{ width: `${Math.max(8, barPct)}%` }} />
          </span>
        ) : null}
      </button>
    </div>
  );
}

/** A day with no hours and nothing finished, but something else (meetings, sends, runs, arrivals). */
function otherLine(d: HistoryDaySummary): string {
  if (d.meetings) return `${d.meetings} mtg`;
  if (d.sent) return `${d.sent} sent`;
  if (d.agentRuns) return `${d.agentRuns} run${d.agentRuns === 1 ? '' : 's'}`;
  if (d.org62) return `${d.org62} logged`;
  if (d.arrived) return `${d.arrived} new`;
  return '';
}
