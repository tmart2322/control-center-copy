'use client';
/**
 * History's loading skeleton, data-free: the context head (sentence · day arrows), the month calendar pane and the
 * day pane(s), so nothing jumps when /history lands. Widths follow #cc-main with container queries, the same
 * breakpoints the page uses (calendar 20rem below 1,300 px, two day columns from 1,500 px), so a docked panel and
 * 2,560 px agree before and after the page measures. HistoryPage renders the body while its queries load; the
 * route's loading.tsx renders the whole page (WIRE-FAST's RouteSkeleton can map '/history' to HistorySkeleton).
 */
import { ContextHead, ContextPage, Pane, SectionHead } from '@/components/deals/context-frame';
import { Button, IconButton, Skeleton } from '@/ui';

const noop = () => {};

/** The calendar grid while the month loads: weekday row plus 5 week rows of empty cells. */
export function CalendarSkeleton() {
  return (
    <div aria-hidden className="flex min-h-0 flex-1 animate-pulse flex-col px-3 pb-3">
      <div className="grid shrink-0 grid-cols-7 gap-1 px-0.5 pb-1">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="mx-1.5 my-1 h-3 w-6 rounded-sm bg-surface-sunken" />
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[repeat(5,minmax(0,1fr))] gap-1">
        {Array.from({ length: 35 }, (_, i) => (
          <span key={i} className="min-h-12 rounded-md border border-line/60 p-1.5">
            <span className="block h-3 w-4 rounded-sm bg-surface-sunken" />
          </span>
        ))}
      </div>
    </div>
  );
}

function DayPaneSkeleton({ titles }: { titles: string[] }) {
  return (
    <Pane aria-label="Day loading" scroll={false} bodyClassName="overflow-hidden">
      {titles.map((t) => (
        <div key={t} className="pb-2">
          <SectionHead title={t} />
          <Skeleton variant="row" count={3} className="px-5" />
        </div>
      ))}
    </Pane>
  );
}

/** The body while the month and day load (HistoryPage's loading state). */
export function HistoryBodySkeleton() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[32rem_minmax(0,1fr)] gap-5 @max-[1300px]/main:grid-cols-[24rem_minmax(0,1fr)] @max-[1300px]/main:gap-4 @min-[2200px]/main:grid-cols-[38rem_minmax(0,1fr)]" aria-busy="true">
      <Pane aria-label="Calendar loading" head={<SectionHead title="Month" />} scroll={false} bodyClassName="flex flex-col">
        <CalendarSkeleton />
      </Pane>
      <div className="grid min-h-0 min-w-0 grid-cols-1 gap-5 @min-[1500px]/main:grid-cols-2">
        <DayPaneSkeleton titles={['Finished', 'Sent and approved']} />
        <div className="hidden min-h-0 @min-[1500px]/main:grid">
          <DayPaneSkeleton titles={['Time logged', 'Meetings']} />
        </div>
      </div>
    </div>
  );
}

export function HistorySkeleton() {
  return (
    <ContextPage label="History">
      <ContextHead
        title="History"
        sentence="Loading the day…"
        actions={
          <div className="flex items-center gap-1">
            <IconButton icon="chevronleft" label="Previous day" onClick={noop} />
            <Button size="sm" variant="quiet" disabled>
              Today
            </Button>
            <IconButton icon="chevronright" label="Next day" onClick={noop} />
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <HistoryBodySkeleton />
      </div>
    </ContextPage>
  );
}
