'use client';
/**
 * Briefs' loading skeleton, data-free: the context head (sentence · Manage watches) and the list | reading panes
 * in their final grid, so nothing jumps when /briefs lands. BriefsPage renders the pane bodies while they load;
 * the route's loading.tsx and the shell's pending-navigation skeleton render the whole page.
 */
import { ContextHead, ContextPage, Pane } from '@/components/deals/context-frame';
import { Button, Skeleton } from '@/ui';

const noop = () => {};

/** The brief list while it loads. */
export function BriefListSkeleton() {
  return <Skeleton variant="row" count={7} className="px-4 pt-3" />;
}

/** The reading pane while a brief loads. */
export function BriefPaneSkeleton() {
  return (
    <div className="space-y-4 px-6 py-5" aria-busy="true" aria-label="Loading the brief" data-testid="brief-pane-loading">
      <Skeleton variant="line" count={3} />
      <Skeleton variant="card" />
      <Skeleton variant="card" />
    </div>
  );
}

export function BriefsSkeleton() {
  return (
    <ContextPage label="Briefs">
      <ContextHead
        title="Briefs"
        sentence="Loading your briefs…"
        actions={
          <Button variant="quiet" size="sm" icon="settings" onClick={noop}>
            Manage watches
          </Button>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] gap-5 @max-[1100px]/main:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)] @max-[1100px]/main:gap-4">
        <Pane as="aside" aria-label="Briefs">
          <BriefListSkeleton />
        </Pane>
        <Pane aria-label="Brief">
          <BriefPaneSkeleton />
        </Pane>
      </div>
    </ContextPage>
  );
}
