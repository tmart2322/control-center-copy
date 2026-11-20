'use client';
/**
 * Week timeline (UI-SPEC §12 Time, R-UI-6): Mon to Fri (plus a weekend day that has work), one row per signal
 * lane, hour grid, overlap shading, a now-line, and hover/focus evidence on every block. Agent background time is
 * hatched, sits in its own "leverage" row and is never totalled into your hours.
 *
 * The window shows the whole working day and grows to fit every block of the week (after-hours work, agent runs,
 * the now-line), rounded out to the hour; time outside working hours is shaded. A fitted window rather than a
 * scrolled 24 h one: each day is a narrow column with time running across it, so 24 h would halve every block.
 */
import { useMemo } from 'react';
import type { ActivityEntry, TimeWeek } from '@/contract';
import { clock, dayLabel, dur, minutesBetween, sameDay } from '@/components/domain/lib/time';
import { cn, Tooltip } from '@/ui';
import { ACTIVITY_META } from '@/components/domain/vocab';
import { axisLabels, DEFAULT_WORK, dayWindow, hoursByRow, hourTicks, offHours, overlapBands, placeBlocks, ROW_ORDER, subRows, visibleDays, weekDays, windowClock, minutesOfDay, ymdIn, type PlacedBlock, type RowId, type WorkSpan } from './derive';

const SUB_H = 18;
const GUTTER = 'w-36 shrink-0';

/** Color is an indicator, never identity: your lanes are neutral surfaces; agent time is the one violet (AI) lane. */
const TONE: Record<RowId, string> = {
  meetings: 'bg-surface-sunken border-line-input text-fg-heading',
  focus: 'bg-surface-raised border-line-input text-fg',
  claude: 'bg-surface-raised border-line-input text-fg',
  leverage: 'border-ai-500 text-ai-700',
  drive: 'bg-surface-muted border-line-strong text-fg',
  slack: 'bg-surface-muted border-line-strong text-fg',
  git: 'bg-surface-muted border-line-strong text-muted',
};

const HATCH = 'repeating-linear-gradient(135deg, var(--color-ai-200) 0 3px, transparent 3px 7px)';
/** Outside working hours: a fine neutral hatch over the canvas tone (context, not a state; agent time hatches violet the other way). */
const OFF_HOURS = 'repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-line-strong) 45%, transparent) 0 1px, transparent 1px 9px), color-mix(in oklab, var(--color-bg) 85%, transparent)';
const SUB_LABEL: Partial<Record<RowId, string>> = { leverage: 'background, not counted', git: 'no signal' };

const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Weekday of a YYYY-MM-DD as settings store it (0 = Sun … 6 = Sat). */
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();

export interface WeekTimelineProps {
  week: TimeWeek;
  now: string;
  tz?: string;
  /** Working hours (profile settings) in minutes since midnight, and the weekdays you work (0 = Sun). */
  work?: WorkSpan & { days?: number[] };
  onOpenActivity?: (id: string) => void;
}

export function WeekTimeline({ week, now, tz, work = DEFAULT_WORK, onOpenActivity }: WeekTimelineProps) {
  const all = useMemo(() => weekDays(week.weekStart, 7), [week.weekStart]);
  const blocks = useMemo(() => placeBlocks(week.timeline, all, tz), [week.timeline, all, tz]);
  const days = useMemo(() => visibleDays(week.weekStart, blocks), [week.weekStart, blocks]);
  const today = ymdIn(now, tz);
  const nowMin = minutesOfDay(now, tz);
  const workSpan = useMemo(() => ({ start: work.start, end: work.end }), [work.start, work.end]);
  const win = useMemo(() => dayWindow(blocks, workSpan, days.includes(today) ? [nowMin] : []), [blocks, workSpan, days, today, nowMin]);
  const [lo, hi] = win;
  const span = (hi - lo) * 60;
  const subs = useMemo(() => subRows(blocks), [blocks]);
  const hours = useMemo(() => hoursByRow(blocks), [blocks]);
  const entryById = useMemo(() => new Map(week.entries.map((e) => [e.id, e])), [week.entries]);
  const off = useMemo(() => offHours(win, workSpan), [win, workSpan]);
  const workDays = work.days?.length ? work.days : [1, 2, 3, 4, 5];
  const pct = (m: number) => `${Math.min(100, Math.max(0, ((m - lo * 60) / span) * 100))}%`;
  const ticks = hourTicks(win, 3);
  const labels = axisLabels(win);
  const cols = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };
  // Lanes with no signal this week fold into one muted line; meetings and agent time always show.
  const has = (id: RowId) => blocks.some((b) => b.rowId === id);
  const rows = ROW_ORDER.filter((r) => r.id === 'meetings' || r.id === 'leverage' || has(r.id)).map((r) => ({ ...r, h: Math.max(30, subs[r.id] * SUB_H + 8) }));
  const quiet = ROW_ORDER.filter((r) => r.id !== 'meetings' && r.id !== 'leverage' && !has(r.id)).map((r) => r.label);
  const overlapCount = days.reduce((n, d) => n + overlapBands(blocks, d).length, 0);
  const lastDay = days[days.length - 1]!;
  const range = days.length === 5 ? 'Mon to Fri' : `Mon to ${dayLabel(`${lastDay}T12:00:00Z`, 'UTC').split(' ')[0]}`;
  const afterHours = blocks.filter((b) => b.startMin < work.start || b.endMin > work.end || !workDays.includes(weekday(b.day))).length;

  return (
    <div className="@container/tl flex h-full min-h-0 flex-col select-none" data-window={`${windowClock(lo * 60)}-${windowClock(hi * 60)}`}>
      <div className="flex items-end border-b border-line">
        <div className={cn(GUTTER, 'px-4 pb-4 text-caption text-muted')}>{range}</div>
        <div className="grid min-w-0 flex-1" style={cols}>
          {days.map((d) => (
            <div key={d} className="min-w-0 border-l border-line">
              <div className={cn('truncate px-2 text-caption', d === today ? 'font-bold text-fg-heading' : 'text-muted')}>
                {dayLabel(`${d}T12:00:00Z`, 'UTC')}
                {d === today ? <span className="ml-1.5 font-normal text-muted">· today</span> : null}
              </div>
              {/* the hour axis, so an after-hours block reads against a time */}
              <div className="relative h-4 overflow-hidden text-micro text-muted tabular-nums" aria-hidden data-testid="hour-axis">
                {labels.map((h) => (
                  <span key={h} className="absolute top-0 -translate-x-1/2" style={{ left: pct(h * 60) }}>
                    {String(h % 24).padStart(2, '0')}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lanes share the pane's height (busier lanes get more), so the timeline fills its pane instead of leaving a hole. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* outside working hours (and days you don't work), under every lane */}
        <div className="pointer-events-none absolute inset-y-0 right-0 left-36 grid" style={cols} aria-hidden>
          {days.map((d) => (
            <div key={d} className="relative">
              {(workDays.includes(weekday(d)) ? off : [[lo * 60, hi * 60] as [number, number]]).map(([s, e]) => (
                <span key={s} data-off-hours="" className="absolute inset-y-0" style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})`, background: OFF_HOURS }} />
              ))}
            </div>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.id} className="flex border-b border-line last:border-b-0" style={{ minHeight: r.h, flex: `${subs[r.id] + 1} 1 ${r.h}px` }}>
            <div className={cn(GUTTER, 'flex flex-col justify-center px-4')} title={r.hint}>
              <span className={cn('truncate text-caption font-bold', r.id === 'leverage' ? 'text-ai-700' : 'text-fg')}>{r.id === 'leverage' ? '✦ Agent time' : r.label}</span>
              <span className="truncate text-micro text-muted tabular-nums">{SUB_LABEL[r.id] ?? (hours[r.id] ? `${Math.round(hours[r.id] * 10) / 10} h` : 'none')}</span>
            </div>
            <div className="grid min-w-0 flex-1" style={cols}>
              {days.map((d) => (
                <DayCell key={d} day={d} row={r.id} n={subs[r.id]} blocks={blocks} lo={lo} span={span} ticks={ticks} entryById={entryById} tz={tz} onOpenActivity={onOpenActivity} />
              ))}
            </div>
          </div>
        ))}

        {/* overlap bands (your own time only) and the now-line sit over every lane */}
        <div className="pointer-events-none absolute inset-y-0 right-0 left-36 grid" style={cols} aria-hidden>
          {days.map((d) => (
            <div key={d} className="relative">
              {overlapBands(blocks, d).map(([s, e]) => (
                <span key={s} className="absolute inset-y-0 border-x border-dashed border-line-input" style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }} />
              ))}
              {d === today && nowMin >= lo * 60 && nowMin <= hi * 60 ? (
                <span data-testid="now-line" className="absolute inset-y-0 w-0.5 bg-fg-heading" style={{ left: pct(nowMin) }}>
                  <span className="absolute -top-px -left-4 rounded-sm bg-fg-heading px-1 text-micro text-bg tabular-nums">{clock(now, tz)}</span>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-caption text-muted">
        {overlapCount ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-2 border-x border-dashed border-line-input" /> {overlapCount} {overlapCount === 1 ? 'overlap' : 'overlaps'} in your own time
          </span>
        ) : null}
        {quiet.length ? <span>No signal: {quiet.join(', ')}</span> : null}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-[2px] border border-ai-500" style={{ backgroundImage: HATCH }} /> Agent time runs in the background and is never counted as yours
        </span>
        <span className="inline-flex items-center gap-1.5" data-testid="off-hours-legend">
          <span className="size-3 rounded-[2px] border border-line-strong" style={{ background: OFF_HOURS }} /> Outside working hours ({hh(work.start)}–{hh(work.end)})
          {afterHours ? ` · ${afterHours} ${afterHours === 1 ? 'block' : 'blocks'} there` : ''}
        </span>
        <span className="ml-auto tabular-nums">
          {windowClock(lo * 60)}–{windowClock(hi * 60)} · {tz ?? 'local time'}
        </span>
      </div>
    </div>
  );
}

function DayCell({
  day,
  row,
  n,
  blocks,
  lo,
  span,
  ticks,
  entryById,
  tz,
  onOpenActivity,
}: {
  day: string;
  row: RowId;
  /** Sub-rows in this lane (blocks are centred in their slot as the lane grows). */
  n: number;
  blocks: PlacedBlock[];
  lo: number;
  span: number;
  ticks: number[];
  entryById: Map<string, ActivityEntry>;
  tz?: string;
  onOpenActivity?: (id: string) => void;
}) {
  const mine = blocks.filter((b) => b.rowId === row && b.day === day);
  return (
    <div className="relative border-l border-line">
      {ticks.map((h) => (
        <span key={h} aria-hidden className="absolute inset-y-0 w-px bg-line/60" style={{ left: `${(((h - lo) * 60) / span) * 100}%` }} />
      ))}
      {mine.map((b) => (
        <BlockMark key={b.id} b={b} n={n} lo={lo} span={span} entry={b.activityId ? entryById.get(b.activityId) : undefined} tz={tz} onOpenActivity={onOpenActivity} />
      ))}
    </div>
  );
}

function BlockMark({ b, n, lo, span, entry, tz, onOpenActivity }: { b: PlacedBlock; n: number; lo: number; span: number; entry?: ActivityEntry; tz?: string; onOpenActivity?: (id: string) => void }) {
  const left = ((b.startMin - lo * 60) / span) * 100;
  const width = Math.max(0.8, ((b.endMin - b.startMin) / span) * 100);
  const meta = entry ? ACTIVITY_META[entry.status] : null;
  const evidence = (
    <div className="max-w-72 space-y-1 text-left">
      <div className="font-bold">{b.label}</div>
      <div className="tabular-nums opacity-80">
        {clock(b.start, tz)}–{clock(b.end, tz)} · {dur(minutesBetween(b.start, b.end))}
        {b.hatched ? ' · agent leverage, not logged' : ''}
      </div>
      {entry ? (
        <div className="border-t border-line pt-1">
          <div>
            Logged as: {entry.taskType ?? 'no type'} · {entry.oppName ?? 'no opp'} · {entry.meetingType ?? '–'} · {entry.durationH} h
          </div>
          <div className="opacity-80">{meta?.label}. Click to jump to the row.</div>
          {entry.sources.length ? <div className="opacity-80">Evidence: {entry.sources.map((s) => s.label).slice(0, 3).join(' · ')}</div> : null}
        </div>
      ) : b.rowId === 'leverage' ? (
        <div className="border-t border-line pt-1 opacity-80">Agent time runs in the background; it is never part of your logged hours.</div>
      ) : (
        <div className="border-t border-line pt-1 opacity-80">No activity row yet for this block.</div>
      )}
    </div>
  );
  return (
    <Tooltip content={evidence} side="top" delayMs={150}>
      <button
        type="button"
        data-block={b.id}
        data-row={b.rowId}
        aria-label={`${b.label}, ${clock(b.start, tz)} to ${clock(b.end, tz)}`}
        onClick={() => b.activityId && onOpenActivity?.(b.activityId)}
        className={cn(
          'absolute flex items-center overflow-hidden rounded-sm border border-l-[3px] px-1.5 text-left text-micro leading-none whitespace-nowrap focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-focus',
          b.hatched ? TONE.leverage : TONE[b.rowId],
          b.activityId ? 'cursor-pointer hover:border-accent' : 'cursor-default',
        )}
        style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, top: `calc(${((b.sub + 0.5) * 100) / Math.max(1, n)}% - ${(SUB_H - 2) / 2}px)`, height: SUB_H - 2, backgroundImage: b.hatched ? HATCH : undefined }}
      >
        <span className="truncate">{b.label}</span>
      </button>
    </Tooltip>
  );
}

export function TimelineEmpty({ week }: { week: TimeWeek }) {
  const n = week.timeline.reduce((s, l) => s + l.blocks.length, 0);
  return n === 0 ? <p className="px-3 py-6 text-center text-body text-muted">No signals for this week yet.</p> : null;
}

export { sameDay };
