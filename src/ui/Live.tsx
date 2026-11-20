'use client';
/**
 * Live-update affordances (docs/UX.md "Live updates"): the calm "N new · Show" pill a list shows while arrivals wait,
 * and a count that updates in place with a subtle tick. Motion respects prefers-reduced-motion (src/styles/live.css).
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from './cn';

export interface LivePillProps {
  count: number;
  onShow: () => void;
  /** "new" (default), or what arrived ("drafts", "rows"). */
  noun?: string;
  /**
   * 'sticky' (default): at the top of its scrolling list. 'overlay': absolutely placed at the top of the nearest
   * positioned parent, for a page laid out as a flex or grid column (a sticky child would take a gap there).
   */
  placement?: 'sticky' | 'overlay';
  className?: string;
}

/**
 * Sticky at the top of its list with zero height, so it never pushes a row down. It appears after a beat (a hold that
 * ends on its own, like a pointer that stops moving, lets the arrivals slide in without the pill ever showing).
 */
export function LivePill({ count, onShow, noun = 'new', placement = 'sticky', className }: LivePillProps) {
  const [visible, setVisible] = useState(false);
  const has = count > 0;
  useEffect(() => {
    if (!has) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 450);
    return () => clearTimeout(t);
  }, [has]);
  if (!has || !visible) return null;
  return (
    <div className={cn('pointer-events-none z-20 flex h-0 justify-center overflow-visible', placement === 'overlay' ? 'absolute inset-x-0 top-3' : 'sticky top-2', className)} style={{ columnSpan: 'all' }} data-live-pill>
      <button
        type="button"
        onClick={onShow}
        aria-live="polite"
        className="cc-live-pill pointer-events-auto inline-flex h-8 items-center gap-2 rounded-full border border-line-strong bg-surface-raised pr-3.5 pl-3 text-caption text-fg shadow-pop hover:bg-surface-overlay focus-visible:shadow-focus focus-visible:outline-none"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-accent" />
        <span className="font-bold text-fg-heading tabular-nums">
          {count} {noun}
        </span>
        <span aria-hidden className="text-faint">
          ·
        </span>
        <span className="font-bold text-link">Show</span>
      </button>
    </div>
  );
}

export interface FieldConflictProps {
  /** The value it changed to elsewhere, as text. */
  theirs: string;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  className?: string;
}

/**
 * A field you are editing changed elsewhere (docs/UX.md "Live updates"): your text stays, this line says what it
 * changed to and lets you pick. Amber: at risk of overwriting, never an error.
 */
export function FieldConflict({ theirs, onKeepMine, onTakeTheirs, className }: FieldConflictProps) {
  return (
    <span role="status" data-field-conflict className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-caption', className)}>
      <span className="min-w-0 truncate text-warning-700">
        Changed elsewhere: <b className="font-bold">{theirs || '—'}</b>
      </span>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onKeepMine} className="rounded-sm font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
        Keep mine
      </button>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onTakeTheirs} className="rounded-sm font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
        Take theirs
      </button>
    </span>
  );
}

export interface LiveCountProps {
  value: number | null | undefined;
  className?: string;
  /** Render the number (default: as is). */
  format?: (n: number) => string;
}

/** A count that changes in place: a short tick when the value changes (never on first render). */
export function LiveCount({ value, className, format }: LiveCountProps) {
  const prev = useRef(value);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (prev.current !== value && prev.current !== undefined && prev.current !== null && value !== undefined && value !== null) setTick((t) => t + 1);
    prev.current = value;
  }, [value]);
  if (value === undefined || value === null) return null;
  return (
    <span key={tick} data-live-tick={tick ? '' : undefined} className={cn('inline-block tabular-nums', className)}>
      {format ? format(value) : value}
    </span>
  );
}
