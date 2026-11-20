'use client';
/**
 * The detail lane's mutations, all through useOptimisticMutation (UI-SPEC §10): the cache patches
 * first, failures roll back with an inline error, 409s rebase or surface ChangedElsewhere, and
 * reversible state changes toast with Undo (UI-SPEC §9).
 *
 * `?fail=1` on the page URL forces upstream_unavailable on every mutation from here (rollback test).
 */
import type { ItemActionRequest, Resolution, WorkItem } from '@/contract';
import { useOptimisticMutation } from '@/client/optimistic';
import { resolutionLabel } from '@/components/domain';

/** Every view that can hold a copy of a work item. */
export const ITEM_TOPICS = ['item', 'items', 'today', 'initiative', 'triage', 'nba'];

export function failFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('fail') === '1';
}

export function usePatchItem() {
  return useOptimisticMutation({
    route: 'patchItem',
    topics: ITEM_TOPICS,
    optimistic: (input, cache) => {
      const patch = (input.body?.patch ?? {}) as Record<string, unknown>;
      cache.patchEntity(input.params.id, (e) => {
        const locked = new Set([...((e.userLockedFields as string[] | undefined) ?? []), ...Object.keys(patch)]);
        return { ...e, ...patch, userLockedFields: [...locked] };
      });
    },
    fail: failFromUrl,
  });
}

type Verb = 'done' | 'resolve' | 'snooze' | 'accept' | 'dismiss' | 'confirm-done' | 'reopen' | 'not-now';

const VERB_TITLE: Record<Verb, string> = {
  done: 'Done',
  resolve: 'Resolved',
  snooze: 'Snoozed',
  accept: 'Accepted',
  dismiss: 'Dismissed',
  'confirm-done': 'Confirmed done',
  reopen: 'Reopened',
  'not-now': 'Not now',
};

/** What the server will do, applied to the cached copy before it answers. */
export function optimisticAction(e: Record<string, unknown>, verb: Verb, body: ItemActionRequest, nowIso: string): Record<string, unknown> {
  const done = (resolution: Resolution) => ({
    ...e,
    state: 'done',
    doneAt: nowIso,
    doneBy: 'user',
    resolution,
    resolutionDetail: { inferred: false, ...(body.detail ?? {}) },
    involvement: resolution === 'handed_off' ? body.involvement ?? 'watcher' : e.involvement,
    owner: resolution === 'handed_off' && body.detail?.personName ? { id: body.detail.personId ?? `person:${body.detail.personName}`, name: body.detail.personName } : e.owner,
    loopedBackIn: null,
    waiting: null,
    likelyDone: null,
  });
  switch (verb) {
    case 'done':
      return done(body.resolution ?? 'done_by_me');
    case 'resolve':
      return done(body.resolution ?? 'done_by_me');
    case 'confirm-done':
      return done('done_by_me');
    case 'snooze':
      return { ...e, state: 'snoozed', snoozedUntil: body.until ?? null, snoozedFrom: e.state };
    case 'accept':
      return { ...e, state: 'open' };
    case 'reopen':
      return { ...e, state: 'reopened', resolution: null, resolutionDetail: null, doneAt: null, involvement: 'owner', reopened: { reason: body.note ?? 'Reopened by you', at: nowIso } };
    case 'dismiss':
      return { ...e, state: 'dismissed' };
    case 'not-now':
      return body.reason === 'later' ? { ...e, state: 'snoozed' } : body.reason === 'done_elsewhere' ? done('done_by_me') : body.reason === 'wrong_account' ? e : { ...e, state: 'dismissed' };
  }
}

export function useItemAction() {
  return useOptimisticMutation({
    route: 'itemAction',
    topics: ITEM_TOPICS,
    optimistic: (input, cache) => {
      const now = new Date().toISOString();
      cache.patchEntity(input.params.id, (e) => optimisticAction(e, input.params.verb as Verb, input.body ?? { ifVersion: 0 }, now));
    },
    toast: (res: { entity: WorkItem }, input) => {
      const verb = input.params.verb as Verb;
      const item = res.entity;
      const title =
        verb === 'resolve' || (verb === 'done' && item.resolution && item.resolution !== 'done_by_me')
          ? `${resolutionLabel(item.resolution, item.resolutionDetail?.personName)}: ${item.title}`
          : `${VERB_TITLE[verb]}: ${item.title}`;
      return { title, key: `item:${item.id}` };
    },
    fail: failFromUrl,
  });
}

export function useUndoAudit() {
  return useOptimisticMutation({
    route: 'undoAudit',
    topics: [...ITEM_TOPICS, 'audit', 'draft', 'outbox'],
    writeBack: false,
    entityId: () => undefined,
    toast: (res) => ({ title: res.entity.summary, key: `undo:${res.entity.undoOf ?? res.entity.id}` }),
    fail: failFromUrl,
  });
}

export function useProposalMutation(kind: 'apply' | 'reject') {
  return useOptimisticMutation({
    route: kind === 'apply' ? 'applyProposal' : 'rejectProposal',
    topics: [...ITEM_TOPICS, 'draft'],
    writeBack: false,
    optimistic: (input, cache) => {
      // Hide the pending proposal everywhere at once; the server answer brings the applied values.
      for (const topic of ['item', 'nba', 'today']) {
        for (const [key, data] of cache.client.getQueriesData({ queryKey: [topic] })) {
          const next = dropProposal(data, input.params.id);
          if (next !== data) cache.setQuery(key, () => next);
        }
      }
    },
    toast: (res) => ({ title: kind === 'apply' ? `Applied: ${res.entity.reason}` : 'Kept yours', key: `proposal:${res.entity.id}` }),
    fail: failFromUrl,
  });
}

/** Copy of `data` without the proposal `id` in any `proposals` array (identity kept when absent). */
export function dropProposal<T>(data: T, id: string): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => {
        const y = walk(x);
        if (y !== x) changed = true;
        return y;
      });
      return changed ? out : v;
    }
    if (!v || typeof v !== 'object') return v;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      let y = walk(x);
      if (k === 'proposals' && Array.isArray(y) && y.some((p) => (p as { id?: string })?.id === id)) y = (y as Array<{ id?: string }>).filter((p) => p?.id !== id);
      if (y !== x) changed = true;
      out[k] = y;
    }
    return changed ? out : v;
  };
  return walk(data) as T;
}

export function useMarkSeen() {
  return useOptimisticMutation({
    route: 'markItemSeen',
    topics: ['item', 'items', 'today'],
    optimistic: (input, cache) => cache.patchEntity(input.params.id, (e) => ({ ...e, newEvidenceCount: 0 })),
  });
}
