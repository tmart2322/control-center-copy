'use client';
/**
 * Long lists never stop silently (2026-11-13 audit C7): the first `step` rows render, then "Show N more" (and "Show
 * all N") under them, with the count always said. A selected row past the shown ones is always rendered (j/k and a
 * resumed selection never land on a row that isn't there). Pure parts are tested in ./ui.test.ts.
 */
import { useCallback, useEffect, useState } from 'react';

export const SHOW_STEP = 100;

/** How many rows to render: whole steps, and at least up to the pinned (selected) row. */
export function shownCount(total: number, steps: number, step = SHOW_STEP, pinIndex = -1): number {
  return Math.min(total, Math.max(steps * step, pinIndex + 1));
}

export function useShowMore(total: number, o: { step?: number; pinIndex?: number; resetKey?: unknown } = {}) {
  const step = o.step ?? SHOW_STEP;
  const [steps, setSteps] = useState(1);
  // a new list (another filter, another tab) starts at the first step again
  useEffect(() => setSteps(1), [o.resetKey]);
  const shown = shownCount(total, steps, step, o.pinIndex ?? -1);
  const more = useCallback(() => setSteps((n) => n + 1), []);
  const all = useCallback(() => setSteps(Math.max(1, Math.ceil(total / step))), [total, step]);
  return { shown, hidden: Math.max(0, total - shown), step, more, all };
}

/** "Showing 100 of 869 · Show 100 more · Show all 869"; nothing when every row is shown. */
export function ShowMore({ shown, total, step, onMore, onAll, noun = 'rows', className = '' }: { shown: number; total: number; step: number; onMore: () => void; onAll: () => void; noun?: string; className?: string }) {
  if (shown >= total) return null;
  const next = Math.min(step, total - shown);
  const btn = 'rounded-sm font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus';
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-caption text-muted tabular-nums ${className}`} data-testid="show-more">
      <span>{`Showing ${shown} of ${total} ${noun}`}</span>
      <button type="button" className={btn} onClick={onMore}>
        {`Show ${next} more`}
      </button>
      {total - shown > next ? (
        <button type="button" className={btn} onClick={onAll}>
          {`Show all ${total}`}
        </button>
      ) : null}
    </div>
  );
}
