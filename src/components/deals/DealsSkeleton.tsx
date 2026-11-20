'use client';
/**
 * Deals' loading skeletons, data-free: the context head (sentence · Accounts | Missed tabs · refresh) and the
 * panes in their final grid, so nothing jumps when /deals lands. DealsView and MissedView render the bodies while
 * they load; the route's loading.tsx and the shell's pending-navigation skeleton render the whole page.
 * Personas (D-55): without deal contributions there is no Log & fix section, so its skeleton goes too (once the
 * persona is known; until then the SE's shape), and the Missed tab follows DealsTabs.
 */
import { IconButton, SegmentedToggle, Skeleton } from '@/ui';
import { ContextHead, ContextPage, Pane, SectionHead } from './context-frame';
import { DealsTabs } from './DealsHeader';
import { useDealsFeatures } from './hooks';

const noop = () => {};

/** My deals' panes while they load (DealsView's loading state). */
export function DealsBodySkeleton() {
  const { ready, dc } = useDealsFeatures();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true">
      {/* the summary tiles and the pipeline chart (PipelineSummary.tsx), at their final heights */}
      <div className="flex shrink-0 gap-3 @max-[1000px]/main:gap-2" aria-hidden>
        {[1, 2, 1, 1, 1].map((grow, i) => (
          <div key={i} style={{ flexGrow: grow }} className="h-[5.4rem] min-w-0 basis-0 rounded-lg border border-line bg-surface px-4 py-3 @max-[1000px]/main:h-[3.75rem]">
            <Skeleton variant="row" count={1} />
          </div>
        ))}
      </div>
      <div className="h-[14.5rem] shrink-0 rounded-lg border border-line bg-surface px-4 py-3 @max-[1000px]/main:h-[11rem]" aria-hidden>
        <Skeleton variant="row" count={1} />
      </div>
      <div className="grid min-h-0 flex-1 gap-5 @min-[1000px]/main:grid-cols-[minmax(22rem,0.85fr)_minmax(0,1.5fr)]">
        <Pane aria-label="Needs you loading">
          {!ready || dc ? (
            <>
              <SectionHead title="Log & fix" />
              <Skeleton variant="row" count={3} className="px-5" />
            </>
          ) : null}
          <SectionHead title="Think ahead" />
          <Skeleton variant="row" count={2} className="px-5" />
        </Pane>
        <Pane aria-label="Accounts loading" head={<SectionHead title="Accounts" />}>
          <Skeleton variant="row" count={8} className="px-5" />
        </Pane>
      </div>
    </div>
  );
}

export function DealsSkeleton() {
  return (
    <ContextPage label="Deals">
      <ContextHead title="Deals" sentence="Loading your accounts…" tabs={<DealsTabs tab="deals" />} actions={<IconButton icon="refresh" label="Refresh deals" onClick={noop} />} />
      <div className="flex min-h-0 flex-1 flex-col">
        <DealsBodySkeleton />
      </div>
    </ContextPage>
  );
}

/** Missed opportunities' list while it loads (MissedView's loading state). */
export function MissedBodySkeleton() {
  return (
    <Pane aria-label="Missed opportunities loading" head={<SectionHead title="Claim" />}>
      <Skeleton variant="row" count={6} className="px-5" />
    </Pane>
  );
}

export function MissedSkeleton() {
  return (
    <ContextPage label="Missed opportunities">
      <ContextHead title="Missed opportunities" sentence="Loading the missed-opp sweep…" tabs={<DealsTabs tab="missed" />} />
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2" aria-hidden>
        <SegmentedToggle label="Verdict" size="sm" value="all" onChange={noop} options={[{ value: 'all', label: 'Claim + check' }, { value: 'claim', label: 'Claim' }, { value: 'check', label: 'Check' }]} />
        <SegmentedToggle label="Opp status" size="sm" value="all" onChange={noop} options={[{ value: 'all', label: 'Open + closed' }, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }]} />
        <span className="flex items-center gap-2 text-caption text-muted">
          Amount
          <span className="inline-flex h-8 items-center rounded-md border border-line-input bg-surface-input px-2 text-caption text-fg">Any amount</span>
        </span>
        <SegmentedToggle label="Show" size="sm" value="review" onChange={noop} options={[{ value: 'review', label: 'To review' }, { value: 'handled', label: 'Handled' }, { value: 'all', label: 'All' }]} />
        <span className="ml-auto text-caption text-muted">
          <kbd className="font-mono">x</kbd> select · <kbd className="font-mono">a</kbd> claim · <kbd className="font-mono">n</kbd> dismiss
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <MissedBodySkeleton />
      </div>
    </ContextPage>
  );
}
