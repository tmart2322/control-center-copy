/**
 * The QueryClient side of optimistic mutations (no React, so it is unit-testable): find and patch an
 * entity across cached queries, and snapshot / restore topics for rollback.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { deepFindById, deepPatchById, resolveMatch, type FoundEntity, type VersionedEntity } from './cache';

export type Snapshots = Array<[QueryKey, unknown]>;
type Updater = (e: Record<string, unknown>) => Record<string, unknown>;

/** What a mutation's `optimistic(input, cache)` callback gets. */
export interface OptimisticCache {
  /**
   * Patch every cached copy of entity `id` across the snapshotted topics. Versioned entities match on
   * id + version; versionless kinds (AgentRun, Job, EventLogEntry, MissedOpp…) match on id (B-069).
   */
  patchEntity: (id: string, updater: Updater) => void;
  /** Update one query's data directly (lists: remove/append rows). */
  setQuery: <T>(key: QueryKey, updater: (old: T | undefined) => T | undefined) => void;
  /** The cached entity (versioned copy first; versionless kinds have no `version`). */
  findEntity: (id: string) => FoundEntity | undefined;
  client: QueryClient;
}

function queriesOf(qc: QueryClient, topics?: string[]): Snapshots {
  return topics ? topics.flatMap((t) => qc.getQueriesData({ queryKey: [t] })) : qc.getQueriesData({});
}

/** The versioned copy of `id` (base for a 409 rebase, `ifVersion` at save time). */
export function findVersioned(qc: QueryClient, id: string, topics?: string[]): VersionedEntity | undefined {
  for (const [, data] of queriesOf(qc, topics)) {
    const e = deepFindById(data, id, 'versioned');
    if (e) return e;
  }
  return undefined;
}

/** Any cached copy of `id`: the versioned one if it exists, else a versionless entity (AgentRun, Job…). */
export function findAny(qc: QueryClient, id: string, topics?: string[]): FoundEntity | undefined {
  const queries = queriesOf(qc, topics);
  const match = resolveMatch(
    id,
    queries.map(([, d]) => d),
  );
  for (const [, data] of queries) {
    const e = deepFindById(data, id, match);
    if (e) return e;
  }
  return undefined;
}

/**
 * Patch every cached copy of entity `id` in `topics` (all queries when omitted). Whether the entity is
 * versioned is decided once over the WHOLE cache, so a versioned entity's unversioned rows and refs
 * elsewhere stay untouched while a versionless entity (B-069) is matched by its id.
 */
export function patchAll(qc: QueryClient, id: string, updater: Updater, topics?: string[]): void {
  const match = resolveMatch(
    id,
    qc.getQueriesData({}).map(([, d]) => d),
  );
  for (const [key, data] of queriesOf(qc, topics)) {
    if (data === undefined) continue;
    const next = deepPatchById(data, id, updater, match);
    if (next !== data) qc.setQueryData(key, next);
  }
}

/** The cache handle for `optimistic(input, cache)`, scoped to the mutation's snapshotted topics. */
export function optimisticCache(qc: QueryClient, topics: string[]): OptimisticCache {
  return {
    patchEntity: (id, updater) => patchAll(qc, id, updater, topics),
    setQuery: (key, updater) => qc.setQueryData(key, updater as never),
    findEntity: (id) => findAny(qc, id, topics),
    client: qc,
  };
}

/** Cancel in-flight fetches of `topics` and snapshot their data for rollback. */
export async function snapshotTopics(qc: QueryClient, topics: string[]): Promise<Snapshots> {
  await Promise.all(topics.map((t) => qc.cancelQueries({ queryKey: [t] })));
  return queriesOf(qc, topics);
}

export function restoreSnapshots(qc: QueryClient, snapshots: Snapshots | undefined): void {
  for (const [key, data] of snapshots ?? []) qc.setQueryData(key, data);
}
