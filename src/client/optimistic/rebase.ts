/**
 * 409 handling (UI-SPEC §10, CONTRACT "Versioning"). A stale `ifVersion` returns the server's
 * current entity. If nobody else touched the fields this patch writes, the user's intent re-applies
 * on top of the new version (a silent rebase). If they did, surface "Changed elsewhere: keep
 * yours / take theirs".
 */

export interface ConflictFieldDiff {
  field: string;
  base: unknown;
  mine: unknown;
  theirs: unknown;
}

export type RebaseResult = { ok: true; ifVersion: number } | { ok: false; conflicts: ConflictFieldDiff[] };

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * @param base    the entity as the user last saw it (before their edit)
 * @param current the server's entity from the 409 (`error.details.current`)
 * @param patch   the fields the user is writing
 */
export function rebaseFieldPatch(base: Record<string, unknown> | undefined, current: Record<string, unknown>, patch: Record<string, unknown>): RebaseResult {
  const version = Number(current.version);
  const conflicts: ConflictFieldDiff[] = [];
  for (const [field, mine] of Object.entries(patch)) {
    const theirs = current[field];
    if (sameValue(theirs, mine)) continue; // they already wrote what we want
    const baseVal = base ? base[field] : undefined;
    if (base && sameValue(theirs, baseVal)) continue; // untouched elsewhere: safe to re-apply
    conflicts.push({ field, base: baseVal, mine, theirs });
  }
  if (conflicts.length) return { ok: false, conflicts };
  return { ok: true, ifVersion: version };
}

/** Bodies shaped `{ ifVersion, patch }` (patchItem) or `{ ifVersion, ...fields }` (patchDraft/patchActivity). */
export function patchFieldsOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const b = body as Record<string, unknown>;
  if (b.patch && typeof b.patch === 'object') return b.patch as Record<string, unknown>;
  if (b.value && typeof b.value === 'object') return b.value as Record<string, unknown>;
  const { ifVersion: _v, confirm: _c, ...rest } = b;
  return rest;
}

export function withIfVersion<B extends { ifVersion?: number }>(body: B, ifVersion: number): B {
  return { ...body, ifVersion };
}
