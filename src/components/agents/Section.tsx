'use client';
/**
 * A verb-named section column (DESIGN-V2 principles 2–4; the Home mockup's columns): heading + count + a faint
 * sub, up to `cap` rows (3, or 5 on a 2,400 px screen), then "See all N →", which shows the rest in place.
 * Sections disappear when empty. Each section is its own `sec` container, so rows condense by column width.
 */
import { Children, useId, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/ui';

const WIDE_QUERY = '(min-width: 2400px)';
const subscribeWide = (fn: () => void) => {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
};

/** True on a 2,400 px and wider screen (section caps go from 3 to 5, like Home). */
export function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

export function capFor(wide: boolean): number {
  return wide ? 5 : 3;
}

export interface SectionProps {
  title: string;
  count?: number;
  sub?: ReactNode;
  /** Rows (already capped by the caller, so j/k only walks what is visible). */
  children?: ReactNode;
  total: number;
  expanded: boolean;
  cap: number;
  onToggle: () => void;
  className?: string;
  [data: `data-${string}`]: unknown;
}

export function Section({ title, count, sub, children, total, expanded, cap, onToggle, className, ...data }: SectionProps) {
  const id = useId();
  const rows = Children.toArray(children).filter(Boolean);
  if (!rows.length) return null;
  return (
    <section aria-labelledby={id} className={cn('@container/sec flex min-w-0 flex-col px-4 pt-4 pb-3', className)} {...data}>
      <div className="flex min-w-0 items-baseline gap-2 pb-1">
        <h2 id={id} className="shrink-0 text-lead font-bold whitespace-nowrap text-fg-heading">
          {title}
        </h2>
        {count !== undefined ? <span className="shrink-0 text-body text-muted tabular-nums">{count}</span> : null}
        {sub ? <span className="ml-auto min-w-0 truncate text-caption text-faint">{sub}</span> : null}
      </div>
      <div role="list" aria-label={title} className="-mx-3 flex flex-col">
        {rows}
      </div>
      {total > cap ? (
        <button type="button" aria-expanded={expanded} onClick={onToggle} className="mt-auto inline-flex self-start rounded-sm pt-2 text-caption font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
          {expanded ? 'Show fewer' : `See all ${total} →`}
        </button>
      ) : null}
    </section>
  );
}
