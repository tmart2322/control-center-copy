'use client';
/**
 * D-65 (TL-14, TL-20): the way out of a row that is not in Org62 after all, its Event deleted there or its canvas run
 * without it: Log again (back to approved: the next "Log these" puts it on a canvas) or Leave out (dismissed by you).
 * One undoable change each, through POST /activity/:id/org62-resolve. Nothing is written to Org62 from here.
 */
import type { ActivityEntry } from '@/contract';
import { useOptimisticMutation } from '@/client/optimistic/useOptimisticMutation';
import { Button } from '@/ui';
import { readbackState } from './derive';

export function RelogActions({ e, size = 'sm', now }: { e: ActivityEntry; size?: 'sm' | 'md'; now: string }) {
  const resolve = useOptimisticMutation({
    route: 'resolveActivity',
    topics: ['time'],
    optimistic: (input, cache) =>
      cache.patchEntity(input.params.id, (x) => (input.body?.action === 'log_again' ? { ...x, status: 'approved' } : { ...x, status: 'dismissed', excludedReason: 'dismissed' })),
    toast: (_r, input) =>
      input.body?.action === 'log_again'
        ? { title: 'Back on the list to log', body: 'The next "Log these" puts it on a canvas; the Org62 check confirms it.', key: `relog:${e.id}` }
        : { title: 'Left out', body: 'It is dismissed and never logged again. Restore it from the Ledger.', key: `relog:${e.id}` },
  });
  const rb = readbackState(e, now);
  if (rb !== 'missing' && rb !== 'deleted') return null;
  const run = (action: 'log_again' | 'leave_out') => resolve.mutate({ params: { id: e.id }, body: { ifVersion: resolve.versionOf(e.id) ?? e.version, action } });
  return (
    <span className="inline-flex items-center gap-2" data-testid="relog-actions">
      <Button size={size} variant="primary" onClick={() => run('log_again')} disabled={resolve.isPending}>
        Log again
      </Button>
      <Button size={size} variant="secondary" onClick={() => run('leave_out')} disabled={resolve.isPending}>
        Leave out
      </Button>
    </span>
  );
}
