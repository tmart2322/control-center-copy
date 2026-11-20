'use client';
/**
 * The Outbox's loading skeleton, data-free: the list frame with its sentence in the final place and placeholder
 * rows, so nothing jumps when /outbox lands. OutboxPage renders the body while its list loads; the route's
 * loading.tsx and the shell's pending-navigation skeleton render the whole page.
 */
import { ListFrame } from '@/components/lists/ListFrame';
import { Skeleton } from '@/ui';

/** The list body while it loads (OutboxPage's loading state). */
export function OutboxListSkeletonBody() {
  return (
    <div className="pt-4" aria-busy>
      <Skeleton variant="row" count={4} />
    </div>
  );
}

export function OutboxSkeleton() {
  return (
    <ListFrame label="Outbox" data-state="loading" lead="Loading the Outbox…">
      <OutboxListSkeletonBody />
    </ListFrame>
  );
}
