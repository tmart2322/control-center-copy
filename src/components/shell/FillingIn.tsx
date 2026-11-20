'use client';
/**
 * <FillingIn>: the shared empty state while the first scan runs (B-079). Where a list would say "Nothing needs you",
 * it says "Filling in, about 3 h left" instead, with why: the first scan is still reading your history, so items may
 * be missing or look undone. Without a first scan running it renders its children (the page's own empty state).
 *
 *   note    the words only ("Filling in, about 3 h left."), for a lead line
 *   line    one caption line, for a Home section's empty slot
 *   card    a Do now card's text
 *   panel   a centred empty state with a link to the progress (Work, Deals)
 */
import type { ReactNode } from 'react';
import { AppLink } from './AppLink';
import { useFirstScan } from './FirstScanBanner';
import type { FirstScanView } from './first-scan';
import { cn, Icon } from '@/ui';

export type FillingInVariant = 'note' | 'line' | 'card' | 'panel';

const WHY = 'Items may be missing or look undone until it finishes.';

export function FillingInView({ v, variant = 'panel', className }: { v: FirstScanView; variant?: FillingInVariant; className?: string }) {
  const reading = `Your first scan is reading ${v.lookbackDays} day${v.lookbackDays === 1 ? '' : 's'} of history (${v.pct}% so far).`;
  if (variant === 'note')
    return (
      <span data-testid="filling-in" data-variant="note" className={className}>
        {v.fillingText}.
      </span>
    );
  if (variant === 'line')
    return (
      <span data-testid="filling-in" data-variant="line" className={className}>
        {v.fillingText}. {WHY}
      </span>
    );
  if (variant === 'card')
    return (
      <span data-testid="filling-in" data-variant="card" className={cn('flex flex-col gap-1', className)}>
        <span className="font-bold text-fg">{v.fillingText}</span>
        <span>
          {reading} {WHY}
        </span>
      </span>
    );
  return (
    <div data-testid="filling-in" data-variant="panel" className={cn('flex flex-col items-center justify-center gap-2 px-4 py-8 text-center', className)}>
      <span className="grid size-9 place-items-center rounded-full bg-surface-muted text-muted">
        <Icon name="sync" size="md" />
      </span>
      <p className="text-body-lg font-bold text-fg-heading">{v.fillingText}</p>
      <div className="max-w-[48ch] text-body text-muted">
        {reading} {WHY}
      </div>
      <AppLink href="/health" className="mt-1 rounded-sm text-caption font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
        See its progress
      </AppLink>
    </div>
  );
}

/** The page's own empty state (children), or "Filling in" while the first scan runs. */
export function FillingIn({ variant = 'panel', className, children }: { variant?: FillingInVariant; className?: string; children?: ReactNode }) {
  const v = useFirstScan();
  return v ? <FillingInView v={v} variant={variant} className={className} /> : <>{children}</>;
}

/** For an `empty` prop that hides the section when null (Home's SectionColumn): the filling line, or the fallback. */
export function useFillingEmpty(fallback: ReactNode): ReactNode {
  const v = useFirstScan();
  return v ? <FillingInView v={v} variant="line" /> : fallback;
}
