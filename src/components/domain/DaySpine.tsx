'use client';
/**
 * DaySpine (the Today timeline) and DayRibbon (Home's slim day bar). DESIGN-V2; mockups today.html "Day"
 * and home-1-briefing's ribbon; UI-SPEC §4.2 for behaviour.
 *
 * Both draw the day at true proportions (default 08:00–17:30, widened to fit the calendar). The ribbon
 * shows meetings and open time (planned work only with `showWork`, or the selected item's block):
 * - Meetings are neutral blocks. Only state colors them: live / selected = accent, ★ meeting with prep
 *   missing = amber, missed = red. ★ marks the meetings today's top work serves; prep state rides on them.
 * - Declined and cancelled meetings are ghosts (dashed, struck through). On the spine they sit in the right
 *   lane with the agent's background runs (`agentBlocks`, violet), because neither takes your time.
 * - Planned work (`work` / `fit_in` slots) is dashed: a plan, not a booking. Open gaps are labels.
 * - Past time dims; a now line marks the current time.
 * - Hovering a block calls onHoverItem (the linked card highlights); `highlightedItemId` lights the reverse.
 * - Spine only: dragging a work slot onto a gap (or Alt+↑/↓ on a focused slot) calls onReplan. Internal
 *   only: it never writes to the calendar.
 */
import type { CalendarEvent, SpineSlot } from '@/contract';
import { useMemo, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/ui';
import { StatusBadge, useClock } from './lib';
import { overlapsBox, packColumns } from './lib/lanes';
import { clock, dayLabel, minutesBetween, sameDay, stripClock } from './lib/time';
import { hm } from './lib/v2';

/** A background agent run on the spine's right lane (it runs in parallel and never counts against your day). */
export interface AgentBlock {
  id: string;
  start: string;
  end: string;
  label: string;
  workItemId?: string | null;
}

export interface DaySpineProps {
  events: CalendarEvent[];
  slots: SpineSlot[];
  later?: { fitIns: number; promises: number };
  now?: string;
  /** Meetings served by today's top work get ★ (default: customer-facing meetings with prep). */
  importantEventIds?: string[];
  highlightedItemId?: string | null;
  className?: string;
  onHoverItem?: (workItemId: string | null) => void;
  onOpenEvent?: (event: CalendarEvent) => void;
  onOpenPrep?: (workItemId: string, event: CalendarEvent) => void;
  onOpenTakeaways?: (event: CalendarEvent) => void;
  onOpenSlot?: (slot: SpineSlot) => void;
  /** Re-plan a slot to start at `start` (internal only). */
  onReplan?: (slot: SpineSlot, start: string) => void;
  onOpenLater?: (shelf: 'fit_ins' | 'promises') => void;

  /** v2: the selected item's block turns accent (run-of-day selection). */
  selectedItemId?: string | null;
  /** v2: background agent runs (spine: right lane; ribbon: ignored). */
  agentBlocks?: AgentBlock[];
  /** v2: the day window in local hours (defaults 8 and 17.5, widened to fit the calendar). */
  startHour?: number;
  endHour?: number;
  /** v2: event ids the page knows are blocked (red edge + "Blocked"). */
  blockedEventIds?: string[];
  /** v2: spine header title (default "Day"); `null` hides the header. */
  title?: string | null;
}

const T = (iso: string) => Date.parse(iso);
const DRAG_TYPE = 'application/x-cc-slot';

function isImportant(e: CalendarEvent, ids?: string[]) {
  return ids ? ids.includes(e.id) : e.isCustomerFacing && !!e.prep;
}
const isDeclined = (e: CalendarEvent) => e.attendance === 'declined' || e.attendance === 'cancelled';

function slotLabel(s: SpineSlot): string {
  return stripClock(s.label).replace(/^▶\s*/, '');
}

/** Local hour (fractional) of an instant in tz: "13:30" → 13.5. */
function localH(iso: string, tz?: string): number {
  const [h, m] = clock(iso, tz).split(':').map(Number);
  return (h ?? 0) + (m ?? 0) / 60;
}

interface DayWindow {
  h0: number;
  h1: number;
  /** 0..1 position of an instant inside the window (clamped). */
  pos: (iso: string, end?: boolean) => number;
  hours: number[];
}

function useDayWindow(events: CalendarEvent[], slots: SpineSlot[], now: string, tz: string | undefined, startHour = 8, endHour = 17.5): DayWindow {
  return useMemo(() => {
    let h0 = startHour;
    let h1 = endHour;
    for (const x of [...events, ...slots]) {
      if (sameDay(x.start, now, tz)) h0 = Math.min(h0, Math.floor(localH(x.start, tz)));
      if (sameDay(x.end, now, tz)) h1 = Math.max(h1, Math.ceil(localH(x.end, tz) * 2) / 2);
      else if (sameDay(x.start, now, tz)) h1 = 24;
    }
    h0 = Math.max(0, h0);
    h1 = Math.min(24, Math.max(h1, h0 + 1));
    const pos = (iso: string, end?: boolean) => {
      if (!sameDay(iso, now, tz)) return T(iso) < T(now) && !end ? 0 : 1;
      return Math.min(1, Math.max(0, (localH(iso, tz) - h0) / (h1 - h0)));
    };
    const hours: number[] = [];
    for (let h = Math.ceil(h0); h <= Math.floor(h1); h++) hours.push(h);
    return { h0, h1, pos, hours };
  }, [events, slots, now, tz, startHour, endHour]);
}

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

// ---------------------------------------------------------------------------
// DaySpine: the Today timeline
// ---------------------------------------------------------------------------

type Placed = { key: string; s: number; e: number; col: number; cols: number; right: boolean; narrow: boolean };

export function DaySpine({
  events,
  slots,
  later,
  importantEventIds,
  highlightedItemId,
  className,
  onHoverItem,
  onOpenEvent,
  onOpenPrep,
  onOpenTakeaways,
  onOpenSlot,
  onReplan,
  onOpenLater,
  selectedItemId,
  agentBlocks = [],
  startHour,
  endHour,
  blockedEventIds = [],
  title = 'Day',
  ...rest
}: DaySpineProps) {
  const { now, tz } = useClock({ now: rest.now });
  const win = useDayWindow(events, slots, now, tz, startHour, endHour);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const todays = useMemo(() => events.filter((e) => sameDay(e.start, now, tz) || sameDay(e.end, now, tz)), [events, now, tz]);
  const gaps = useMemo(() => slots.filter((s) => s.kind === 'gap').sort((a, b) => T(a.start) - T(b.start)), [slots]);
  const work = useMemo(() => slots.filter((s) => s.kind !== 'gap').sort((a, b) => T(a.start) - T(b.start)), [slots]);
  const nowWorkId = selectedItemId ?? work.find((s) => T(s.end) > T(now))?.workItemId ?? null;
  const meetings = todays.filter((e) => !isDeclined(e)).length;

  // Lanes: declined meetings + agent runs on the right (36%); everything else on the left, packed into
  // columns where it overlaps, and narrowed to 62% where a right-lane block sits beside it.
  const placed = useMemo(() => {
    const right = [...todays.filter(isDeclined).map((e) => ({ key: `e:${e.id}`, s: T(e.start), e: T(e.end) })), ...agentBlocks.map((a) => ({ key: `a:${a.id}`, s: T(a.start), e: T(a.end) }))];
    const left = [...todays.filter((e) => !isDeclined(e)).map((e) => ({ key: `e:${e.id}`, s: T(e.start), e: T(e.end), col: 0, cols: 1 })), ...work.map((w) => ({ key: `s:${w.id}`, s: T(w.start), e: T(w.end), col: 0, cols: 1 }))];
    const out = new Map<string, Placed>();
    for (const r of right) out.set(r.key, { ...r, col: 0, cols: 1, right: true, narrow: false });
    // Column packing per overlap cluster (shared with the Today timeline and the Home ribbon).
    packColumns(left);
    for (const c of left) out.set(c.key, { ...c, right: false, narrow: right.some((r) => overlapsBox(r, c)) });
    for (const g of gaps) out.set(`g:${g.id}`, { key: `g:${g.id}`, s: T(g.start), e: T(g.end), col: 0, cols: 1, right: false, narrow: right.some((r) => r.s < T(g.end) && r.e > T(g.start)) });
    return out;
  }, [todays, agentBlocks, work, gaps]);

  const box = (key: string, start: string, end: string): CSSProperties => {
    const p = placed.get(key);
    const top = win.pos(start);
    const bottom = win.pos(end, true);
    const style: CSSProperties = { top: `calc(${pct(top)} + 1px)`, height: `calc(${pct(Math.max(0, bottom - top))} - 2px)` };
    if (!p) return style;
    if (p.right) return { ...style, left: 'auto', right: 0, width: '36%' };
    const span = p.narrow ? 62 : 100;
    return { ...style, left: `${(span / p.cols) * p.col}%`, width: `calc(${span / p.cols}% - ${p.cols > 1 ? 4 : 0}px)` };
  };

  const replanByKey = (slot: SpineSlot, dir: 1 | -1) => {
    const target = dir === 1 ? gaps.find((g) => T(g.start) > T(slot.start)) : [...gaps].reverse().find((g) => T(g.start) < T(slot.start));
    if (target) onReplan?.(slot, target.start);
  };

  const nowPos = win.pos(now);
  const nowIn = sameDay(now, now, tz) && localH(now, tz) >= win.h0 && localH(now, tz) <= win.h1;
  const nowH = localH(now, tz);

  return (
    <aside className={cn('@container flex min-h-0 flex-col rounded-lg border border-line bg-surface', className)} aria-label={`Day · ${dayLabel(now, tz)}`}>
      {title !== null ? (
        <header className="flex shrink-0 items-baseline gap-3 px-5 pb-2 pt-4">
          <h2 className="whitespace-nowrap text-title font-bold text-fg-heading">{title}</h2>
          <span className="whitespace-nowrap text-caption text-muted tabular-nums">
            {meetings} meeting{meetings === 1 ? '' : 's'}
          </span>
          <span className="ml-auto hidden items-center gap-3.5 text-caption text-muted @md:flex" aria-hidden>
            <Legend swatch="h-3 w-4 rounded-[3px] border-l-[3px] border-line-input bg-surface-sunken">Meeting</Legend>
            <Legend swatch="h-3 w-4 rounded-[3px] border border-dashed border-line-input [border-left-style:solid] border-l-[3px]">▶ You</Legend>
            <Legend swatch="h-3 w-4 rounded-[3px] border border-dashed border-ai-200 border-l-[3px] border-l-ai-500 [border-left-style:solid] bg-ai-50">✦ Agent</Legend>
          </span>
        </header>
      ) : null}
      <div className="min-h-0 flex-1 px-4 pb-6 pt-3">
        <div className="relative h-full min-h-[34rem]" role="list" aria-label="Timeline">
          {/* hour lines */}
          {win.hours.map((h) => (
            <span key={h} aria-hidden className="absolute left-[60px] right-0 border-t border-line" style={{ top: pct((h - win.h0) / (win.h1 - win.h0)) }}>
              {Math.abs(h - nowH) < 0.3 ? null : <i className={cn('absolute -left-[60px] -top-2.5 w-[52px] text-caption not-italic leading-5 tabular-nums', h + 1 <= nowH ? 'text-faint' : 'text-muted')}>{hhmm(h)}</i>}
            </span>
          ))}
          {win.hours.slice(0, -1).map((h) =>
            h + 0.5 < win.h1 ? <span key={`${h}h`} aria-hidden className="absolute left-[60px] right-0 border-t border-dashed border-line opacity-70" style={{ top: pct((h + 0.5 - win.h0) / (win.h1 - win.h0)) }} /> : null,
          )}
          {win.h1 % 1 ? (
            <span aria-hidden className="absolute left-[60px] right-0 border-t border-line" style={{ top: '100%' }}>
              <i className="absolute -left-[60px] -top-2.5 w-[52px] text-caption not-italic leading-5 text-muted tabular-nums">{hhmm(win.h1)}</i>
            </span>
          ) : null}

          <div className="absolute inset-y-0 left-[60px] right-0">
            {/* gaps: labels at the bottom of the free stretch (drop targets while re-planning) */}
            {gaps.map((g) => {
              const lit = !!highlightedItemId && g.workItemId === highlightedItemId;
              const isDrop = dropTarget === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  role="listitem"
                  data-slot={g.id}
                  onClick={() => onOpenSlot?.(g)}
                  onMouseEnter={() => onHoverItem?.(g.workItemId)}
                  onMouseLeave={() => onHoverItem?.(null)}
                  onDragOver={(ev: DragEvent) => {
                    if (ev.dataTransfer.types.includes(DRAG_TYPE)) {
                      ev.preventDefault();
                      setDropTarget(g.id);
                    }
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(ev: DragEvent) => {
                    const id = ev.dataTransfer.getData(DRAG_TYPE);
                    const moved = slots.find((x) => x.id === id);
                    setDropTarget(null);
                    if (moved) onReplan?.(moved, g.start);
                  }}
                  title={`${clock(g.start, tz)}–${clock(g.end, tz)} · ${slotLabel(g)}`}
                  style={box(`g:${g.id}`, g.start, g.end)}
                  className={cn(
                    'absolute z-0 flex items-end overflow-hidden rounded-sm px-3 pb-1.5 text-left text-caption focus-visible:outline-none focus-visible:shadow-focus',
                    lit || isDrop ? 'text-muted outline-2 -outline-offset-2 outline-dashed outline-focus' : 'text-faint',
                  )}
                >
                  <span className="truncate">
                    <b className="font-bold text-muted">{hm(minutesBetween(g.start, g.end))} open</b>
                    {gapHint(g) ? ` · ${gapHint(g)}` : ''}
                  </span>
                </button>
              );
            })}

            {/* meetings */}
            {todays.map((e) => {
              const key = `e:${e.id}`;
              const declined = isDeclined(e);
              const past = T(e.end) <= T(now);
              const live = T(e.start) <= T(now) && T(e.end) > T(now);
              const missed = e.attendance === 'missed';
              const important = isImportant(e, importantEventIds);
              const linked = e.prep?.workItemId ?? null;
              const lit = !!highlightedItemId && (linked === highlightedItemId || !!e.takeaways?.workItemIds.includes(highlightedItemId));
              const blocked = blockedEventIds.includes(e.id);
              const prepPending = important && !!e.prep && !e.prep.ready && !past;
              const mins = minutesBetween(e.start, e.end);
              const short = mins <= 30;
              const state = blocked || missed ? 'danger' : prepPending ? 'warning' : null;
              const who = e.attendees.filter((a) => !a.isManager || e.attendees.length === 1).map((a) => a.name.split(' ')[0]);
              const meta = declined
                ? 'Declined'
                : missed
                  ? 'Missed'
                  : `${live ? `now · ${hm(minutesBetween(now, e.end))} left` : `${clock(e.start, tz)}–${clock(e.end, tz)}`}${e.prep && !short ? ` · ${e.prep.ready ? '✓ ' : ''}${e.prep.label}` : who.length ? ` · ${who.slice(0, 2).join(', ')}` : ''}`;
              const badge = blocked ? (
                <StatusBadge tone="danger" icon="ban">
                  Blocked
                </StatusBadge>
              ) : missed && e.takeaways?.count ? (
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onOpenTakeaways?.(e);
                  }}
                  onMouseEnter={() => onHoverItem?.(e.takeaways?.workItemIds[0] ?? null)}
                  className="shrink-0"
                >
                  <StatusBadge tone="danger" icon="close">
                    {e.takeaways.count} takeaways → tasks
                  </StatusBadge>
                </button>
              ) : prepPending ? (
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (e.prep?.workItemId) onOpenPrep?.(e.prep.workItemId, e);
                  }}
                  className="shrink-0"
                  title={e.prep?.label}
                >
                  <StatusBadge tone="warning" icon="clock">
                    Prep pending
                  </StatusBadge>
                </button>
              ) : null;
              return (
                <div
                  key={e.id}
                  role="listitem"
                  tabIndex={0}
                  data-event-id={e.id}
                  onClick={() => (e.prep?.workItemId && prepPending ? onOpenPrep?.(e.prep.workItemId, e) : onOpenEvent?.(e))}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') onOpenEvent?.(e);
                  }}
                  onMouseEnter={() => onHoverItem?.(linked)}
                  onMouseLeave={() => onHoverItem?.(null)}
                  title={`${clock(e.start, tz)}–${clock(e.end, tz)} · ${important ? '★ ' : ''}${e.title}${declined ? ' · declined' : ''}`}
                  style={box(key, e.start, e.end)}
                  className={cn(
                    'absolute min-h-7 cursor-pointer overflow-hidden rounded-sm px-3 py-1 focus-visible:outline-none focus-visible:shadow-focus',
                    declined
                      ? 'z-0 border border-dashed border-line bg-transparent'
                      : cn(
                          'z-[1] border border-line border-l-[3px] bg-[color-mix(in_oklab,var(--color-surface-sunken)_70%,var(--color-surface))]',
                          state === 'danger' ? 'border-l-danger-500' : state === 'warning' ? 'border-l-warning-500' : state === 'now' ? 'border-accent border-l-accent bg-selected' : 'border-l-line-input',
                        ),
                    short && !declined ? 'flex items-center gap-2.5 py-0' : 'flex flex-col',
                    lit && 'outline-2 outline-offset-1 outline-focus',
                  )}
                >
                  <span className={cn('flex min-w-0 items-center gap-2', !short && 'w-full')}>
                    <span
                      className={cn(
                        'min-w-0 truncate leading-5',
                        declined ? 'text-caption text-faint line-through' : 'text-body font-bold text-fg-heading',
                      )}
                    >
                      {important && !declined ? <span aria-label="Important">★ </span> : null}
                      {e.title}
                    </span>
                    {!short && badge ? <span className="ml-auto shrink-0">{badge}</span> : null}
                  </span>
                  <span className={cn('min-w-0 truncate text-caption leading-5', declined ? 'text-faint' : 'text-muted', short && 'shrink-[1000]')}>{meta}</span>
                  {short && badge ? <span className="ml-auto shrink-0">{badge}</span> : null}
                </div>
              );
            })}

            {/* planned work: dashed, yours */}
            {work.map((s) => {
              const key = `s:${s.id}`;
              const lit = !!highlightedItemId && s.workItemId === highlightedItemId;
              const isNow = !!s.workItemId && s.workItemId === nowWorkId;
              const draggable = !!onReplan;
              const mins = minutesBetween(s.start, s.end);
              const short = mins <= 30;
              return (
                <div
                  key={s.id}
                  role="listitem"
                  tabIndex={0}
                  data-slot={s.id}
                  data-now={isNow || undefined}
                  draggable={draggable}
                  onDragStart={(ev: DragEvent) => {
                    ev.dataTransfer.setData(DRAG_TYPE, s.id);
                    ev.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => onOpenSlot?.(s)}
                  onKeyDown={(ev: KeyboardEvent) => {
                    if (ev.key === 'Enter') onOpenSlot?.(s);
                    else if (ev.altKey && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && draggable) {
                      ev.preventDefault();
                      replanByKey(s, ev.key === 'ArrowDown' ? 1 : -1);
                    }
                  }}
                  onMouseEnter={() => onHoverItem?.(s.workItemId)}
                  onMouseLeave={() => onHoverItem?.(null)}
                  title={`${clock(s.start, tz)}–${clock(s.end, tz)} · ${slotLabel(s)}${draggable ? ' · drag onto a gap to re-plan (Alt+↑/↓). Never changes your calendar.' : ''}`}
                  style={box(key, s.start, s.end)}
                  className={cn(
                    'absolute z-[2] min-h-7 overflow-hidden rounded-sm border border-dashed border-l-[3px] px-3 py-1 [border-left-style:solid] focus-visible:outline-none focus-visible:shadow-focus',
                    isNow ? 'border-accent bg-selected' : 'border-line-input bg-surface',
                    short ? 'flex items-center gap-2.5 py-0' : 'flex flex-col',
                    draggable && 'cursor-grab active:cursor-grabbing',
                    lit && 'outline-2 outline-offset-1 outline-focus',
                  )}
                >
                  <span className="min-w-0 truncate text-body font-bold leading-5 text-fg-heading">
                    <span aria-hidden>▶ </span>
                    {slotLabel(s)}
                  </span>
                  <span className="min-w-0 shrink-[1000] truncate text-caption leading-5 text-muted">
                    {short ? `${clock(s.start, tz)} · ${hm(mins)}` : `${clock(s.start, tz)}–${clock(s.end, tz)} · you ~${hm(mins)}`}
                  </span>
                </div>
              );
            })}

            {/* the agent's background runs: right lane, violet, never against your time */}
            {agentBlocks.map((a) => (
              <div
                key={a.id}
                role="listitem"
                onMouseEnter={() => onHoverItem?.(a.workItemId ?? null)}
                onMouseLeave={() => onHoverItem?.(null)}
                title={`${clock(a.start, tz)}–${clock(a.end, tz)} · ${a.label} · runs in the background`}
                style={box(`a:${a.id}`, a.start, a.end)}
                className="absolute z-[1] flex min-h-7 items-center overflow-hidden rounded-sm border border-dashed border-ai-200 border-l-[3px] border-l-ai-500 bg-ai-50 px-2.5 [border-left-style:solid]"
              >
                <span className="min-w-0 truncate text-caption font-bold text-ai-700">✦ {a.label}</span>
              </div>
            ))}
          </div>

          {/* past dims, now line on top */}
          {nowIn ? (
            <>
              <div aria-hidden className="pointer-events-none absolute left-[60px] right-0 top-0 z-[4] bg-[color-mix(in_oklab,var(--color-surface)_58%,transparent)]" style={{ height: pct(nowPos) }} />
              <div className="pointer-events-none absolute left-[56px] right-0 z-[6] border-t-2 border-fg-heading" style={{ top: pct(nowPos) }} aria-label={`Now ${clock(now, tz)}`} role="img">
                <span className="absolute -left-1 -top-1.5 size-2.5 rounded-full bg-fg-heading" />
                <b className="absolute -left-[58px] -top-3 h-[22px] rounded-sm bg-fg-heading px-1.5 text-caption font-bold leading-[22px] text-bg tabular-nums">{clock(now, tz)}</b>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {later ? (
        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-2.5 text-caption">
          <span className="text-muted">Later</span>
          <span className="ml-auto flex items-center gap-2">
            <button type="button" className="font-bold text-link hover:underline" onClick={() => onOpenLater?.('fit_ins')}>
              Fit-ins <span className="tabular-nums">{later.fitIns}</span>
            </button>
            <span className="text-faint">·</span>
            <button type="button" className="font-bold text-link hover:underline" onClick={() => onOpenLater?.('promises')}>
              Promises <span className="tabular-nums">{later.promises}</span>
            </button>
          </span>
        </footer>
      ) : null}
    </aside>
  );
}

/** "11:30 30m gap: fits Training" → "fits Training". */
function gapHint(g: SpineSlot): string {
  const l = slotLabel(g).replace(/^\d+\s*[hm]\S*\s*(gap|open)?:?\s*/i, '');
  return l === slotLabel(g) && /gap|open/i.test(l) ? '' : l;
}

function Legend({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <i className={cn('inline-block', swatch)} />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// DayRibbon: the same day as one slim proportional bar (Home)
// ---------------------------------------------------------------------------

export type DayRibbonProps = Omit<DaySpineProps, 'onReplan'> & {
  /** v2: draw planned work slots too (default off: Home's ribbon shows meetings and open time only). */
  showWork?: boolean;
  /** v2: shortest open gap drawn as an "open" block (default 30 min). */
  minGapMin?: number;
};

export function DayRibbon({
  events,
  slots,
  later,
  importantEventIds,
  highlightedItemId,
  className,
  onHoverItem,
  onOpenEvent,
  onOpenTakeaways,
  onOpenSlot,
  onOpenLater,
  onOpenPrep,
  selectedItemId,
  startHour,
  endHour,
  blockedEventIds = [],
  showWork = false,
  minGapMin = 30,
  ...rest
}: DayRibbonProps) {
  const { now, tz } = useClock({ now: rest.now });
  const plan = useMemo(
    () => slots.filter((s) => (s.kind === 'gap' ? minutesBetween(s.start, s.end) >= minGapMin : showWork && s.kind !== 'focus') || (!!selectedItemId && s.workItemId === selectedItemId && s.kind !== 'gap')),
    [slots, showWork, minGapMin, selectedItemId],
  );
  const win = useDayWindow(events, plan, now, tz, startHour, endHour);
  const todays = useMemo(() => events.filter((e) => sameDay(e.start, now, tz)), [events, now, tz]);
  const span = win.h1 - win.h0;
  const nowH = localH(now, tz);
  const nowIn = nowH >= win.h0 && nowH <= win.h1;
  const nowPos = win.pos(now);
  const place = (start: string, end: string): CSSProperties => {
    const a = win.pos(start);
    const b = win.pos(end, true);
    return { left: pct(a), width: pct(Math.max(0, b - a)) };
  };

  return (
    <section aria-label={`Today's calendar, ${hhmm(win.h0)} to ${hhmm(win.h1)}`} className={cn('relative flex min-w-0 flex-col gap-1', className)}>
      <div
        className="relative h-11 rounded-sm bg-surface-muted"
        style={{ backgroundImage: 'linear-gradient(to right, var(--color-line) 1px, transparent 1px)', backgroundSize: `calc(100% / ${span}) 100%`, backgroundRepeat: 'repeat-x' }}
      >
        {nowIn ? <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 rounded-l-sm bg-[color-mix(in_srgb,var(--color-bg)_45%,transparent)]" style={{ width: pct(nowPos) }} /> : null}

        {/* open time and planned work: dashed, a plan rather than a booking */}
        {plan.map((s) => {
          const lit = !!highlightedItemId && s.workItemId === highlightedItemId;
          const sel = !!selectedItemId && s.workItemId === selectedItemId;
          const gap = s.kind === 'gap';
          const past = T(s.end) <= T(now);
          const label = slotLabel(s);
          return (
            <button
              key={s.id}
              type="button"
              data-slot={s.id}
              onClick={() => onOpenSlot?.(s)}
              onMouseEnter={() => onHoverItem?.(s.workItemId)}
              onMouseLeave={() => onHoverItem?.(null)}
              title={`${clock(s.start, tz)}–${clock(s.end, tz)} · ${label}`}
              style={place(s.start, s.end)}
              className={cn(
                'absolute inset-y-0 flex min-w-0 flex-col justify-center overflow-hidden rounded-sm border border-dashed px-2 text-left whitespace-nowrap focus-visible:outline-none focus-visible:shadow-focus',
                sel ? 'z-[2] border-accent bg-selected' : 'z-0 border-line-strong bg-transparent',
                past && 'opacity-55',
                lit && 'outline-2 outline-offset-1 outline-focus',
              )}
            >
              <span className="truncate text-micro font-bold text-muted tabular-nums">
                {gap ? `${clock(s.start, tz)}–${clock(s.end, tz)} open` : `${clock(s.start, tz)} ▶ you`}
              </span>
              <span className="truncate text-caption text-muted">{gap ? gapHint(s) || label : label}</span>
            </button>
          );
        })}

        {/* meetings */}
        {todays.map((e) => {
          const declined = isDeclined(e);
          const past = T(e.end) <= T(now);
          const live = T(e.start) <= T(now) && T(e.end) > T(now);
          const missed = e.attendance === 'missed';
          const important = isImportant(e, importantEventIds);
          const linked = e.prep?.workItemId ?? null;
          const lit = !!highlightedItemId && (linked === highlightedItemId || !!e.takeaways?.workItemIds.includes(highlightedItemId));
          const blocked = blockedEventIds.includes(e.id);
          const prepPending = important && !!e.prep && !e.prep.ready && !past;
          const mins = minutesBetween(e.start, e.end);
          const short = mins <= 30;
          const tone = blocked || (missed && !!e.takeaways?.count) ? 'danger' : live ? 'now' : prepPending ? 'warning' : 'none';
          const t = clock(e.start, tz);
          const timeLabel = declined ? t : live ? `${t} now` : blocked ? `${t} ⊘ blocked` : prepPending ? `${t} ▲ prep` : missed ? `${t} ✕ missed` : important ? `${t} ★` : t;
          const name = declined ? 'declined' : missed && e.takeaways?.count ? `${e.takeaways.count} takeaways → tasks` : e.title;
          return (
            <button
              key={e.id}
              type="button"
              data-event-id={e.id}
              onClick={() => (missed && e.takeaways ? onOpenTakeaways?.(e) : e.prep?.workItemId ? onOpenPrep?.(e.prep.workItemId, e) : onOpenEvent?.(e))}
              onMouseEnter={() => onHoverItem?.(linked ?? e.takeaways?.workItemIds[0] ?? null)}
              onMouseLeave={() => onHoverItem?.(null)}
              title={`${t}–${clock(e.end, tz)} · ${important ? '★ ' : ''}${e.title} · ${hm(mins)}${declined ? ' · declined' : ''}${e.prep ? ` · prep: ${e.prep.ready ? 'ready' : e.prep.label}` : ''}`}
              style={place(e.start, e.end)}
              className={cn(
                'absolute inset-y-0 z-[1] flex min-w-0 flex-col justify-center overflow-hidden rounded-sm text-left whitespace-nowrap focus-visible:outline-none focus-visible:shadow-focus',
                declined ? 'px-1.5' : short ? 'pl-2 pr-1' : 'px-2',
                declined
                  ? 'border border-dashed border-line-strong bg-surface-muted'
                  : cn(
                      tone === 'now' && 'bg-selected shadow-[inset_3px_0_0_var(--color-accent)]',
                      tone === 'warning' && 'bg-warning-50 shadow-[inset_3px_0_0_var(--color-warning-500)]',
                      tone === 'danger' && 'bg-danger-50 shadow-[inset_3px_0_0_var(--color-danger-500)]',
                      tone === 'none' && 'bg-surface-sunken shadow-[inset_3px_0_0_var(--color-line-strong)]',
                    ),
                past && !live && 'opacity-55',
                lit && 'outline-2 outline-offset-1 outline-focus',
              )}
            >
              <span
                className={cn(
                  'truncate text-micro font-bold tabular-nums',
                  declined ? 'text-faint line-through' : tone === 'now' ? 'text-link' : tone === 'warning' ? 'text-warning-700' : tone === 'danger' ? 'text-danger-700' : 'text-muted',
                )}
              >
                {timeLabel}
              </span>
              <span className={cn('truncate', declined ? 'text-micro text-faint' : short ? 'text-micro text-fg' : 'text-caption font-bold text-fg', live && 'overflow-visible')}>{name}</span>
            </button>
          );
        })}

        {nowIn ? <div aria-hidden className="pointer-events-none absolute -bottom-1.5 -top-1.5 z-0 -ml-px w-0.5 rounded-full bg-fg-heading" style={{ left: pct(nowPos) }} /> : null}
      </div>

      <div className="relative h-5 text-micro text-faint tabular-nums" aria-hidden>
        {nowIn ? (
          <span className="absolute top-0.5 -translate-x-1/2 font-bold text-fg-heading" style={{ left: pct(nowPos) }}>
            {clock(now, tz)}
          </span>
        ) : null}
        {win.hours
          .filter((h) => !nowIn || Math.abs(h - nowH) > 0.45)
          .map((h, i, all) => (
            <span
              key={h}
              className={cn('absolute top-0.5', h === win.h0 ? '' : i === all.length - 1 && h === win.h1 ? '-translate-x-full' : '-translate-x-1/2')}
              style={{ left: pct((h - win.h0) / span) }}
            >
              {hhmm(h)}
            </span>
          ))}
      </div>

      {later ? (
        <div className="flex items-center justify-end gap-2 text-caption">
          <button type="button" className="font-bold text-link hover:underline" onClick={() => onOpenLater?.('fit_ins')}>
            Fit-ins <span className="tabular-nums">{later.fitIns}</span>
          </button>
          <span className="text-faint">·</span>
          <button type="button" className="font-bold text-link hover:underline" onClick={() => onOpenLater?.('promises')}>
            Promises <span className="tabular-nums">{later.promises}</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}


