/**
 * Structural helpers for the TanStack cache (pure). An entity (a WorkItem, Draft, ActivityEntry…)
 * appears in several payloads at once (Today's NOW cards, the Work list, the detail page). These
 * walk any JSON payload and patch every object carrying that `id`.
 *
 * Which objects count as "the entity" (B-069):
 * - `versioned`: only objects with a numeric `version`. Every mutable contract entity carries one, so
 *   rows, refs and chips that merely reuse its id (a HomeRow `{id, title, …}`, an EntityRef) are left alone.
 * - `id`: any object with that id, except link shapes (EntityRef `{type,id,label,href}`, a Job's
 *   `entity`, PersonRef…). This is how versionless kinds (AgentRun, Job, EventLogEntry, MissedOpp,
 *   ToolRun) get patched; under `versioned` they were silently skipped.
 * - `auto` (the default): `versioned` when a versioned copy exists in the data, else `id`. The cache
 *   hook resolves this once over the whole cache (`resolveMatch`), so a payload that only holds an
 *   unversioned row of a versioned entity is still left alone.
 */

type Json = unknown;
type Obj = Record<string, unknown>;

export type EntityMatch = 'auto' | 'versioned' | 'id';
export type VersionedEntity = Obj & { id: string; version: number };
export type FoundEntity = Obj & { id: string; version?: number };

/** Keys a pointer-to-an-entity may carry: EntityRef, HomeEntity, Job.entity, meeting refs, PersonRef. */
const LINK_KEYS = new Set(['type', 'kind', 'id', 'label', 'href', 'url', 'start', 'name', 'role', 'isManager', 'isExternal']);

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hasVersion(v: Obj): boolean {
  return typeof v.version === 'number';
}

/** A reference to an entity rather than the entity itself (only link keys, no version). */
export function isLink(v: Obj): boolean {
  return !hasVersion(v) && Object.keys(v).every((k) => LINK_KEYS.has(k));
}

function matches(v: unknown, id: string, match: 'versioned' | 'id'): v is FoundEntity {
  if (!isObj(v) || v.id !== id) return false;
  if (hasVersion(v)) return true;
  return match === 'id' && !isLink(v);
}

function findFirst(data: Json, id: string, match: 'versioned' | 'id'): FoundEntity | undefined {
  const stack: unknown[] = [data];
  const seen = new Set<unknown>();
  while (stack.length) {
    const v = stack.pop();
    if (typeof v !== 'object' || v === null || seen.has(v)) continue;
    seen.add(v);
    if (matches(v, id, match)) return v;
    if (Array.isArray(v)) stack.push(...v);
    else stack.push(...Object.values(v));
  }
  return undefined;
}

/** `versioned` if any of `payloads` holds a versioned copy of `id`, else `id` (a versionless kind). */
export function resolveMatch(id: string, payloads: Iterable<Json>): 'versioned' | 'id' {
  for (const d of payloads) if (d !== undefined && findFirst(d, id, 'versioned')) return 'versioned';
  return 'id';
}

/** Return a copy of `data` with every matching entity replaced by `updater(entity)`; unchanged branches keep identity. */
export function deepPatchById<T extends Json>(data: T, id: string, updater: (entity: Record<string, unknown>) => Record<string, unknown>, match: EntityMatch = 'auto'): T {
  const mode = match === 'auto' ? resolveMatch(id, [data]) : match;
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v !== 'object' || v === null) return v;
    if (seen.has(v as object)) return v;
    seen.add(v as object);
    if (matches(v, id, mode)) {
      const next = updater(v);
      // Entities can nest other entities (cards carry items); keep walking the result.
      return walkChildren(next);
    }
    return walkChildren(v);
  };
  const walkChildren = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => {
        const y = walk(x);
        if (y !== x) changed = true;
        return y;
      });
      return changed ? out : v;
    }
    if (typeof v === 'object' && v !== null) {
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        const y = walk(x);
        if (y !== x) changed = true;
        out[k] = y;
      }
      return changed ? out : v;
    }
    return v;
  };
  return walk(data) as T;
}

/**
 * First entity with this id anywhere in `data`. `versioned` (what 409 handling and `ifVersion` use)
 * only returns copies that carry a version; `auto` falls back to a versionless entity.
 */
export function deepFindById(data: Json, id: string, match: 'versioned'): VersionedEntity | undefined;
export function deepFindById(data: Json, id: string, match?: EntityMatch): FoundEntity | undefined;
export function deepFindById(data: Json, id: string, match: EntityMatch = 'auto'): FoundEntity | undefined {
  if (match !== 'auto') return findFirst(data, id, match);
  return findFirst(data, id, 'versioned') ?? findFirst(data, id, 'id');
}

/** Shallow-merge helper for updaters: `deepPatchById(d, id, merge({ title }))`. */
export function merge(patch: Record<string, unknown>) {
  return (e: Record<string, unknown>) => ({ ...e, ...patch });
}
