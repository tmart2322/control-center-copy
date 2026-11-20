'use client';
/**
 * Work's loading skeleton, data-free: the list frame with its sentence, tabs, search and filter row in the final
 * places and placeholder rows, so nothing jumps when /items lands. WorkPage renders the body while its list
 * loads; the route's loading.tsx and the shell's pending-navigation skeleton render the whole page.
 */
import type { WorkTab } from '@/contract';
import { ListFrame } from '@/components/lists/ListFrame';
import { Icon, SegmentedToggle, Skeleton, Tabs } from '@/ui';

export const WORK_TAB_LABEL: Record<WorkTab, string> = {
  all_open: 'All open',
  said_by_me: 'Said by me',
  asked_of_me: 'Asked of me',
  promises: 'Promises',
  trainings: 'Trainings',
  snoozed: 'Snoozed',
  done: 'Done',
};
export const WORK_TABS = Object.keys(WORK_TAB_LABEL) as WorkTab[];

const noop = () => {};
const FILTERS = ['Account', 'Initiative', 'Source', 'Kind'];

/** The list body while it loads (WorkPage's loading state). */
export function WorkListSkeletonBody() {
  return (
    <div className="pt-4" aria-busy>
      <Skeleton variant="row" count={8} />
    </div>
  );
}

export function WorkSkeleton() {
  return (
    <ListFrame
      label="Work"
      data-state="loading"
      lead="Loading everything you owe…"
      tools={
        <>
          <Tabs variant="line" tabs={WORK_TABS.map((t) => ({ value: t, label: WORK_TAB_LABEL[t] }))} value="all_open" onChange={noop} label="Work tabs" idBase="work-skeleton" className="border-b-0 px-4" />
          <div aria-hidden className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <span className="flex h-9 w-72 min-w-0 items-center gap-2 rounded-md border border-line-strong bg-surface-input px-3 text-body">
              <Icon name="search" size="sm" className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-faint">Search title, purpose, why</span>
              <kbd className="rounded-sm border border-line bg-surface-sunken px-1.5 font-mono text-micro text-muted">/</kbd>
            </span>
            {FILTERS.map((f) => (
              <span key={f} className="inline-flex h-9 max-w-64 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-body text-fg">
                <span className="text-muted">{f}</span>
                <Icon name="chevrondown" size="xs" className="text-muted" />
              </span>
            ))}
            <span className="ml-auto flex items-center gap-3">
              <SegmentedToggle
                label="Group by"
                size="sm"
                value="due"
                onChange={noop}
                options={[
                  { value: 'due', label: 'By when' },
                  { value: 'initiative', label: 'By initiative' },
                ]}
              />
            </span>
          </div>
        </>
      }
    >
      <WorkListSkeletonBody />
    </ListFrame>
  );
}
