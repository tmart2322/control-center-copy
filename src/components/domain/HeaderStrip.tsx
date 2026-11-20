'use client';
/**
 * @deprecated Design v2 has no nav-bar status strip: Home and Today state the day in one sentence and a
 * `CapacityMeter`. Kept compiling (restyled minimally) until the Today page lane drops it.
 *
 * HeaderStrip: at most four facts for the nav bar's right slot (UI-SPEC §4.1, brief 12 §8.2).
 * next meeting countdown · capacity bar (focus left vs planned, over/under) · nearest deadline ·
 * catch-up state. Each fact is a caption label over a bold tabular value; hairlines between.
 * Facts shrink from the left (the meeting title truncates first); `max` drops facts from the end.
 */
import type { TodayHeader } from '@/contract';
import { Fragment, type ReactNode } from 'react';
import { cn, Icon } from '@/ui';
import { useClock } from './lib';
import { dueLabel, dur, minutesBetween } from './lib/time';

export interface HeaderStripProps {
  header: TodayHeader;
  /** Facts to show (1–4, default 4). The nav at 1360–1599 px fits three. */
  max?: number;
  now?: string;
  className?: string;
  onOpenMeeting?: (eventId: string) => void;
  onOpenDeadline?: () => void;
  onOpenCatchUp?: () => void;
  onOpenCapacity?: () => void;
}

/** @deprecated No status strip in design v2; use `CapacityMeter` and the page's one-line day summary. */
export function HeaderStrip({ header, max = 4, className, onOpenMeeting, onOpenDeadline, onOpenCatchUp, onOpenCapacity, ...rest }: HeaderStripProps) {
  const { now, tz } = useClock({ now: rest.now });
  const facts: ReactNode[] = [];

  const nm = header.nextMeeting;
  if (nm) {
    const left = Math.max(0, minutesBetween(now, nm.start));
    facts.push(
      <Fact key="next" label="Next meeting" grow onClick={onOpenMeeting ? () => onOpenMeeting(nm.eventId) : undefined} title={`${nm.title} in ${dur(left)}`}>
        <span className="min-w-0 truncate">{nm.title}</span>
        <span className={cn('shrink-0', left <= 15 ? 'text-warning-700' : 'text-fg')}>in {dur(left)}</span>
      </Fact>,
    );
  }

  const c = header.capacity;
  const over = c.overByMin > 0;
  const fill = Math.min(100, (c.focusMinLeft / Math.max(1, c.plannedMin, c.focusMinLeft)) * 100);
  facts.push(
    <Fact key="cap" label="Focus left / planned" onClick={onOpenCapacity} title={over ? `Planned work exceeds focus time by ${dur(c.overByMin)}` : `${dur(-c.overByMin)} of focus time unplanned`}>
      <span className="shrink-0">
        {dur(c.focusMinLeft)}
        <span className="font-normal text-muted"> / {dur(c.plannedMin)}</span>
      </span>
      <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <span className={cn('block h-full rounded-full', over ? 'bg-warning-500' : 'bg-fg')} style={{ width: `${fill}%` }} />
      </span>
      <span className={cn('shrink-0 text-caption font-bold', over ? 'text-warning-700' : 'text-success-700')}>{over ? `▲ ${dur(c.overByMin)} over` : `✓ Fits · ${dur(-c.overByMin)} open`}</span>
    </Fact>,
  );

  const d = header.nearestDeadline;
  if (d) {
    facts.push(
      <Fact key="deadline" label="Nearest deadline" onClick={onOpenDeadline} title={`${d.label} due ${dueLabel(d.due, now, tz)}`}>
        <span className="min-w-0 truncate">{d.label}</span>
        {d.progress ? (
          <span className="shrink-0">
            {fmtNum(d.progress.done)}
            <span className="font-normal text-muted">
              /{fmtNum(d.progress.total)}
              {d.progress.label ?? ''}
            </span>
          </span>
        ) : null}
        <span className="shrink-0 font-normal text-muted">{dueLabel(d.due, now, tz)}</span>
      </Fact>,
    );
  }

  const pending = header.catchUp?.sources.filter((s) => !s.done) ?? [];
  if (pending.length) {
    facts.push(
      <Fact key="catch" label="Catching up" onClick={onOpenCatchUp}>
        <Icon name="sync" size="xs" className="shrink-0 text-muted" />
        <span className="min-w-0 truncate">{pending.map((s) => `${s.label}${s.pct !== null ? ` ${s.pct}%` : ''}`).join(' · ')}</span>
      </Fact>,
    );
  }

  return (
    <div className={cn('flex h-full min-w-0 items-center', className)} role="group" aria-label="Today at a glance">
      {facts.slice(0, Math.max(1, Math.min(4, max))).map((f, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="mx-2.5 h-5 w-px shrink-0 bg-line" aria-hidden /> : null}
          {f}
        </Fragment>
      ))}
    </div>
  );
}

function fmtNum(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Fact({ label, children, onClick, grow, title }: { label: string; children: ReactNode; onClick?: () => void; grow?: boolean; title?: string }) {
  const cls = cn('flex min-w-0 flex-col items-start overflow-hidden rounded-sm px-1 text-left', grow ? 'shrink' : 'shrink-[0.2]', onClick && 'hover:bg-surface-muted');
  const inner = (
    <>
      <span className="whitespace-nowrap text-micro leading-3 text-muted">{label}</span>
      <span className="flex min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap text-body font-bold leading-5 text-fg tabular-nums">{children}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} title={title}>
      {inner}
    </button>
  ) : (
    <div className={cls} title={title}>
      {inner}
    </div>
  );
}
