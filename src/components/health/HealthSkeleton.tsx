'use client';
/**
 * Health's loading skeleton, data-free: the calm line and the panes in their final grid, so nothing jumps when
 * /health lands. The pane count follows #cc-main's width with the same container queries as the page (Sources |
 * tabs at ≥ 56 rem, + Spend at ≥ 100 rem, + Scan ledger at ≥ 140 rem), and the tabbed pane shows the tabs that tier
 * keeps. The route's loading.tsx and the shell's pending-navigation skeleton render it before the route arrives.
 */
import type { ReactNode } from 'react';
import { cn, Skeleton, Tabs } from '@/ui';

const noop = () => {};

/** An L1 pane with an optional title row (Health's panes). */
export function HealthPane({ title, count, sub, children, className, ...data }: { title?: string; count?: number; sub?: ReactNode; children: ReactNode; className?: string; [d: `data-${string}`]: unknown }) {
  return (
    <section aria-label={title} className={cn('@container/pane flex min-h-0 min-w-0 flex-col rounded-lg border border-line bg-surface', className)} {...data}>
      {title ? (
        <div className="flex min-w-0 shrink-0 items-baseline gap-2 px-4 pt-4 pb-2">
          <h2 className="shrink-0 text-lead font-bold text-fg-heading">{title}</h2>
          {count !== undefined ? <span className="text-body text-muted tabular-nums">{count}</span> : null}
          {sub ? <span className="ml-auto min-w-0 truncate text-caption text-faint">{sub}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The pane grid; the page and the skeleton share it. */
export const HEALTH_GRID = cn(
  'grid min-h-0 flex-1 grid-cols-1 gap-5',
  '@min-[56rem]/main:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]',
  '@min-[100rem]/main:grid-cols-[minmax(22rem,26rem)_minmax(0,1fr)_minmax(22rem,28rem)]',
  '@min-[140rem]/main:grid-cols-[minmax(24rem,28rem)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(24rem,30rem)]',
);

const TAB_LABEL = { ledger: 'Scan ledger', jobs: 'Jobs', errors: 'Errors', spend: 'Spend' } as const;
type TabId = keyof typeof TAB_LABEL;

function TierTabs({ tabs, className }: { tabs: TabId[]; className: string }) {
  return (
    <div className={className}>
      <Tabs label="Health detail" idBase="health-skeleton" variant="line" value={tabs[0]!} onChange={noop} tabs={tabs.map((t) => ({ value: t, label: TAB_LABEL[t] }))} />
    </div>
  );
}

/** The calm line while /health loads: a bar in a lead-sized line box, so the panes don't move when the text lands. */
export function HealthCalmSkeleton() {
  return (
    <p className="min-w-0 text-lead font-bold" aria-hidden>
      <span className="inline-block w-72 animate-pulse rounded-md bg-surface-sunken align-middle">{' '}</span>
    </p>
  );
}

export function HealthSkeleton() {
  return (
    <div className="flex min-h-full flex-col gap-5 px-6 pt-5 pb-6 @min-[56rem]/main:h-full" data-health-root>
      <header className="flex min-w-0 shrink-0 flex-wrap items-baseline gap-x-8 gap-y-1" data-health-head>
        <HealthCalmSkeleton />
      </header>
      <div className={HEALTH_GRID}>
        <HealthPane title="Sources" data-pane="sources">
          <Skeleton variant="row" count={8} />
        </HealthPane>
        <HealthPane title="Scan ledger" data-pane="ledger" className="hidden @min-[140rem]/main:flex">
          <Skeleton variant="row" count={6} />
        </HealthPane>
        <HealthPane className="min-h-[24rem]" data-pane="tabs">
          <div className="shrink-0 px-4 pt-3 pb-2">
            <TierTabs tabs={['ledger', 'jobs', 'errors', 'spend']} className="@min-[100rem]/main:hidden" />
            <TierTabs tabs={['ledger', 'jobs', 'errors']} className="hidden @min-[100rem]/main:block @min-[140rem]/main:hidden" />
            <TierTabs tabs={['jobs', 'errors']} className="hidden @min-[140rem]/main:block" />
          </div>
          <Skeleton variant="row" count={5} />
        </HealthPane>
        <HealthPane title="Spend" sub="today and 7 days" data-pane="spend" className="hidden @min-[100rem]/main:flex">
          <Skeleton variant="block" className="m-4 h-64" />
        </HealthPane>
      </div>
    </div>
  );
}
