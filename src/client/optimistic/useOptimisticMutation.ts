'use client';
/**
 * useOptimisticMutation: the one way FE lanes mutate (UI-SPEC §10, R-UI-20).
 *
 * 1. onMutate: cancel in-flight queries of the affected topics, snapshot them, patch the cache.
 *    The UI updates before the server answers; it never blocks on a spinner for a local edit.
 * 2. On success: write the server entity back into every cached copy (a versionless entity: within
 *    the topics), show an Undo toast (auditId) if asked, invalidate the topics.
 * 3. On error: roll back the snapshot and expose the error for an inline "Couldn't save · Retry".
 * 4. On 409: if the user's fields weren't touched elsewhere, re-send on the new version once
 *    (silent rebase). Otherwise roll back to the server value and expose `conflict` with
 *    keepMine() / takeTheirs() for a ChangedElsewhere / ProposalDiff surface.
 *
 *   const done = useOptimisticMutation({
 *     route: 'itemAction',
 *     optimistic: (input, cache) => cache.patchEntity(input.params.id, (e) => ({ ...e, state: 'done' })),
 *     toast: (res) => ({ title: `Done: ${res.entity.title}` }),
 *   });
 *   done.mutate({ params: { id, verb: 'done' }, body: { ifVersion: item.version } });
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { routes, type JsonRouteKey, type RouteClientInput, type RouteOutput } from '@/contract';
import { api, ApiError } from '@/client/api';
import { toast as pushToast } from '@/client/toast/store';
import type { ConflictField, InlineStatusProps } from '@/ui/states';
import { findVersioned as findInCache, optimisticCache, patchAll, restoreSnapshots, snapshotTopics, type OptimisticCache, type Snapshots } from './query-cache';
import { patchFieldsOf, rebaseFieldPatch, withIfVersion } from './rebase';

type Input<K extends JsonRouteKey> = RouteClientInput<K>;
type Output<K extends JsonRouteKey> = RouteOutput<K>;
type AnyInput = { params?: Record<string, string>; body?: Record<string, unknown> };
type Entity = Record<string, unknown> & { id: string; version: number };

export type { OptimisticCache };

export interface OptimisticConfig<K extends JsonRouteKey> {
  route: K;
  optimistic?: (input: Input<K>, cache: OptimisticCache) => void;
  /** Topics to snapshot, roll back and invalidate. Default: the route's topic (+ 'today'). */
  topics?: string[];
  /**
   * 409 policy. Default: field-patch rebase (base = the cached entity before this mutation).
   * Return a new input to retry once, or null to surface the conflict. `false` = always surface.
   */
  rebase?: false | ((ctx: { input: Input<K>; current: Entity; base: Entity | undefined }) => Input<K> | null);
  /** The entity id this mutation targets (default: input.params.id). */
  entityId?: (input: Input<K>) => string | undefined;
  /** Write the returned `entity` back into every cached copy (default true). */
  writeBack?: boolean;
  /** Undo toast after success (the auditId is attached automatically); `action` adds a second button ("Open"). */
  toast?: (result: Output<K>, input: Input<K>) => { title: string; body?: string; key?: string; action?: { label: string; href?: string; onClick?: () => void } } | null;
  onSuccess?: (result: Output<K>, input: Input<K>) => void;
  onError?: (error: ApiError, input: Input<K>) => void;
  /** Dev: force `?fail=1` on the request. */
  fail?: boolean | (() => boolean);
}

export interface ConflictState<K extends JsonRouteKey> {
  fields: ConflictField[];
  mine: Input<K>;
  theirs: Entity;
  keepMine: () => void;
  takeTheirs: () => void;
}

export type OptimisticStatus = 'idle' | 'pending' | 'success' | 'error' | 'conflict';

class ConflictError extends Error {
  constructor(
    readonly current: Entity,
    readonly fields: ConflictField[],
    readonly input: unknown,
  ) {
    super('Changed elsewhere');
  }
}

function entityIdOf(input: unknown): string | undefined {
  return (input as AnyInput)?.params?.id;
}

export function useOptimisticMutation<K extends JsonRouteKey>(config: OptimisticConfig<K>) {
  const qc = useQueryClient();
  const cfg = useRef(config);
  cfg.current = config;
  const [conflict, setConflict] = useState<ConflictState<K> | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const lastInput = useRef<Input<K> | null>(null);

  const topicsFor = useCallback(() => {
    const t = cfg.current.topics ?? [routes[cfg.current.route].topic, 'today'];
    return [...new Set(t)];
  }, []);

  const mutation = useMutation<Output<K>, ApiError | ConflictError, { input: Input<K>; base: Entity | undefined }, { snapshots: Snapshots }>({
    mutationFn: async ({ input, base }) => {
      const c = cfg.current;
      const fail = typeof c.fail === 'function' ? c.fail() : c.fail;
      try {
        return await api(c.route, input, { fail });
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'conflict') throw err;
        const current = err.current as Entity | undefined;
        if (!current || typeof current !== 'object') throw err;
        const body = (input as AnyInput).body;
        const fields = patchFieldsOf(body);
        let rebased: Input<K> | null = null;
        if (c.rebase !== false) {
          if (typeof c.rebase === 'function') rebased = c.rebase({ input, current, base });
          else {
            const r = rebaseFieldPatch(base, current, fields);
            rebased = r.ok ? ({ ...(input as AnyInput), body: withIfVersion(body ?? {}, r.ifVersion) } as Input<K>) : null;
          }
        }
        if (rebased) return await api(c.route, rebased, { fail });
        const r = rebaseFieldPatch(base, current, fields);
        const diff = r.ok ? Object.entries(fields).map(([field, mine]) => ({ field, mine, theirs: current[field] })) : r.conflicts.map((x) => ({ field: x.field, mine: x.mine, theirs: x.theirs }));
        throw new ConflictError(current, diff, input);
      }
    },
    onMutate: async ({ input }) => {
      const topics = topicsFor();
      const snapshots = await snapshotTopics(qc, topics);
      setConflict(null);
      cfg.current.optimistic?.(input, optimisticCache(qc, topics));
      return { snapshots };
    },
    onError: (err, { input }, ctx) => {
      restoreSnapshots(qc, ctx?.snapshots);
      if (err instanceof ConflictError) {
        const id = (cfg.current.entityId ?? entityIdOf)(input);
        if (id) patchAll(qc, id, () => err.current);
        setConflict({
          fields: err.fields,
          mine: input,
          theirs: err.current,
          keepMine: () => {
            const body = (input as AnyInput).body ?? {};
            run({ ...(input as AnyInput), body: withIfVersion(body, Number(err.current.version)) } as Input<K>, err.current);
          },
          takeTheirs: () => {
            setConflict(null);
            void Promise.all(topicsFor().map((t) => qc.invalidateQueries({ queryKey: [t] })));
          },
        });
        return;
      }
      cfg.current.onError?.(err, input);
    },
    onSuccess: (result, { input }) => {
      const c = cfg.current;
      setSavedAt(Date.now());
      const res = result as { entity?: Entity; auditId?: string | null };
      if ((c.writeBack ?? true) && res.entity && typeof res.entity === 'object' && 'id' in res.entity) {
        const e = res.entity;
        // Versioned entities write back everywhere. A versionless one (matched by id, B-069) only within
        // this mutation's topics, so a different kind that reuses the id elsewhere (a TriageItem shares
        // its MissedOpp's id) never gets merged into.
        patchAll(qc, e.id, (old) => ({ ...old, ...e }), typeof (e as { version?: unknown }).version === 'number' ? undefined : topicsFor());
      }
      const spec = c.toast?.(result, input);
      if (spec) pushToast({ ...spec, tone: 'info', undo: res.auditId ? { auditId: res.auditId } : undefined });
      c.onSuccess?.(result, input);
    },
    onSettled: () => {
      for (const t of topicsFor()) void qc.invalidateQueries({ queryKey: [t] });
    },
  });

  const run = useCallback(
    (input: Input<K>, baseOverride?: Entity) => {
      lastInput.current = input;
      const id = (cfg.current.entityId ?? entityIdOf)(input);
      const base = baseOverride ?? (id ? findInCache(qc, id) : undefined);
      return mutation.mutateAsync({ input, base });
    },
    [mutation, qc],
  );

  const mutate = useCallback((input: Input<K>) => void run(input).catch(() => undefined), [run]);
  const mutateAsync = useCallback((input: Input<K>) => run(input), [run]);
  const retry = useCallback(() => {
    if (lastInput.current) mutate(lastInput.current);
  }, [mutate]);

  /** Latest cached version of an entity (for building `ifVersion` at save time). */
  const versionOf = useCallback((id: string) => findInCache(qc, id)?.version, [qc]);

  const error = mutation.error instanceof ApiError ? mutation.error : null;
  const status: OptimisticStatus = conflict ? 'conflict' : mutation.isPending ? 'pending' : error ? 'error' : mutation.isSuccess ? 'success' : 'idle';
  const inlineStatus: InlineStatusProps = {
    state: status === 'pending' ? 'saving' : status === 'success' ? 'saved' : status === 'error' ? 'error' : status === 'conflict' ? 'conflict' : 'idle',
    savedAt,
    error: error ? error.message : null,
    onRetry: retry,
  };

  return {
    mutate,
    mutateAsync,
    retry,
    reset: () => {
      mutation.reset();
      setConflict(null);
    },
    versionOf,
    status,
    error,
    conflict,
    isPending: mutation.isPending,
    inlineStatus,
  };
}
