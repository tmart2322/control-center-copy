'use client';
/**
 * Agents' loading skeletons, data-free: the header (Runs | Tools tabs · Start in Claude) and the section grid in
 * its final place, so nothing jumps when /agents or /agents/tools lands. AgentsView and ToolsView render the grids
 * while they load; the route's loading.tsx and the shell's pending-navigation skeleton render the whole page.
 */
import { Button, Skeleton } from '@/ui';
import { AgentsHeader } from './AgentsHeader';

const noop = () => {};

function SectionsSkeleton({ cols, label }: { cols: 2 | 3; label: string }) {
  return (
    <div className={cols === 3 ? 'grid gap-px overflow-hidden rounded-lg border border-line bg-surface @min-[70rem]/main:grid-cols-3' : 'grid gap-px overflow-hidden rounded-lg border border-line bg-surface @min-[70rem]/main:grid-cols-2'} aria-busy aria-label={label}>
      {Array.from({ length: cols }, (_, i) => (
        <div key={i} className="p-4">
          <Skeleton variant="line" className="mb-3 w-40" />
          <Skeleton variant="row" count={3} />
        </div>
      ))}
    </div>
  );
}

/** The run sections while they load (AgentsView's loading state). */
export function RunsBodySkeleton() {
  return <SectionsSkeleton cols={3} label="Runs loading" />;
}

/** The tool registry while it loads (ToolsView's loading state). */
export function ToolsBodySkeleton() {
  return <SectionsSkeleton cols={2} label="Tools loading" />;
}

export function AgentsSkeleton() {
  return (
    <div className="flex min-h-full flex-col gap-5 px-6 pt-5 pb-6" data-agents-root>
      <AgentsHeader
        tab="runs"
        actions={
          <Button variant="secondary" size="md" icon="agent_session" kbd="shift+s" onClick={noop}>
            Start in Claude
          </Button>
        }
      />
      <RunsBodySkeleton />
    </div>
  );
}

export function ToolsSkeleton() {
  return (
    <div className="flex min-h-full flex-col gap-5 px-6 pt-5 pb-6" data-tools-root>
      <AgentsHeader tab="tools" />
      <ToolsBodySkeleton />
    </div>
  );
}
