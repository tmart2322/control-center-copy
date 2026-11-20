'use client';
/**
 * Single-item actions for the Work list (and the triage "not now" path): done, snooze, resolve, and for a
 * likely-done item (LD-1) confirm-done (it leaves) or not-done (it moves back among the open work).
 * Instant and optimistic (UI-SPEC §8): the row leaves the list now, an Undo toast says what happened,
 * and a failed call rolls the row back with an inline error toast.
 */
import type { ItemsPayload, Resolution, WorkItem } from '@/contract';
import { resolutionLabel } from '@/components/domain';
import { useOptimisticMutation } from '@/client/optimistic';
import { toast } from '@/client/toast';
import { withoutItems } from './cache-patches';

export interface ResolveArgs {
  resolution: Resolution;
  detail?: { personId?: string; personName?: string; relatedItemId?: string; note?: string };
  involvement?: 'watcher' | 'not_involved' | 'contributor';
}

export function useItemActions() {
  const m = useOptimisticMutation({
    route: 'itemAction',
    topics: ['items', 'today', 'item'],
    optimistic: (input, cache) => {
      const ids = new Set([input.params.id]);
      const back = input.params.verb === 'not-done';
      for (const [key, data] of cache.client.getQueriesData<ItemsPayload>({ queryKey: ['items'] })) {
        if (!data || !Array.isArray(data.items)) continue;
        cache.setQuery<ItemsPayload>(key, (old) =>
          !old ? old : back ? { ...old, items: old.items.map((i) => (ids.has(i.id) ? { ...i, state: 'in_progress' as const, likelyDone: null } : i)) } : withoutItems(old, ids),
        );
      }
    },
    toast: (res, input) => {
      const t = res.entity.title;
      switch (input.params.verb) {
        case 'done':
          return { title: `Done: ${t}`, key: `item:${res.entity.id}` };
        case 'snooze':
          return { title: `Snoozed: ${t}`, key: `item:${res.entity.id}` };
        case 'confirm-done':
          return { title: `Confirmed done: ${t}`, key: `item:${res.entity.id}` };
        case 'not-done':
          return { title: `Back to open: ${t}`, key: `item:${res.entity.id}` };
        case 'resolve':
          return { title: `${resolutionLabel(res.entity.resolution, res.entity.resolutionDetail?.personName)}: ${t}`, key: `item:${res.entity.id}` };
        default:
          return { title: t, key: `item:${res.entity.id}` };
      }
    },
    onError: (err, input) => {
      toast({ key: `item:${input.params.id}:err`, title: "Couldn't save that change", body: `${err.message}. The row is back where it was.`, tone: 'error', durationMs: null });
    },
  });

  return {
    done: (item: Pick<WorkItem, 'id' | 'version'>) => m.mutate({ params: { id: item.id, verb: 'done' }, body: { ifVersion: item.version } }),
    confirmDone: (item: Pick<WorkItem, 'id' | 'version'>) => m.mutate({ params: { id: item.id, verb: 'confirm-done' }, body: { ifVersion: item.version } }),
    notDone: (item: Pick<WorkItem, 'id' | 'version'>) => m.mutate({ params: { id: item.id, verb: 'not-done' }, body: { ifVersion: item.version } }),
    snooze: (item: Pick<WorkItem, 'id' | 'version'>, until: string) => m.mutate({ params: { id: item.id, verb: 'snooze' }, body: { ifVersion: item.version, until } }),
    resolve: (item: Pick<WorkItem, 'id' | 'version'>, r: ResolveArgs) =>
      m.mutate({
        params: { id: item.id, verb: 'resolve' },
        body: { ifVersion: item.version, resolution: r.resolution, ...(r.detail ? { detail: r.detail } : {}), ...(r.involvement ? { involvement: r.involvement } : {}) },
      }),
    isPending: m.isPending,
  };
}
