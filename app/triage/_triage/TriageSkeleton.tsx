'use client';
/**
 * Triage's loading skeleton, data-free: the list frame with its sentence and key hints in the final places and
 * placeholder rows, so nothing jumps when /triage lands. TriagePage renders the body and the key hints; the
 * route's loading.tsx and the shell's pending-navigation skeleton render the whole page.
 */
import { ListFrame } from '@/components/lists/ListFrame';
import { Kbd, Skeleton } from '@/ui';

const KEYS: Array<[string, string]> = [
  ['a', 'accept'],
  ['e', 'edit'],
  ['m', 'merge'],
  ['n', 'dismiss'],
  ['1–9', 'answer'],
];

/** The list's key hints (the frame's sub line). */
export function TriageKeys() {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {KEYS.map(([k, l]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <Kbd>{k}</Kbd> {l}
        </span>
      ))}
    </span>
  );
}

/** The list body while it loads (TriagePage's loading state). */
export function TriageListSkeletonBody() {
  return (
    <div className="pt-4" aria-busy>
      <Skeleton variant="row" count={6} />
    </div>
  );
}

export function TriageSkeleton() {
  return (
    <ListFrame label="Triage" data-state="loading" lead="Loading what came in…" sub={<TriageKeys />}>
      <TriageListSkeletonBody />
    </ListFrame>
  );
}
