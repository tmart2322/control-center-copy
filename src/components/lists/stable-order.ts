/**
 * "Nothing moves under your cursor" (UI-SPEC §10), as a pure reconcile step.
 * Rows already on screen keep their relative order (with fresh data); rows that vanished drop out;
 * rows the server newly returned are appended at the end and reported as `added` ("2 new ↓").
 */
export interface Reconciled {
  order: string[];
  added: string[];
}

export interface ReconcileOptions {
  initial?: boolean;
  /**
   * Rows that left recently, each with the id that followed it when it left (null = it was last). A row
   * that comes back (Undo, a rolled-back action) returns to that place instead of being appended as new.
   */
  returning?: ReadonlyMap<string, string | null>;
}

export function reconcileOrder(prev: string[], incoming: string[], opts: ReconcileOptions = {}): Reconciled {
  if (opts.initial || prev.length === 0) return { order: [...incoming], added: [] };
  const inc = new Set(incoming);
  const kept = prev.filter((id) => inc.has(id));
  const known = new Set(prev);
  const fresh = incoming.filter((id) => !known.has(id));
  const back = opts.returning ? fresh.filter((id) => opts.returning!.has(id)) : [];
  const added = fresh.filter((id) => !back.includes(id));
  const order = [...kept];
  for (const id of back) {
    const anchor = opts.returning!.get(id) ?? null;
    const at = anchor ? order.indexOf(anchor) : -1;
    if (at >= 0) order.splice(at, 0, id);
    else order.push(id);
  }
  return { order: [...order, ...added], added };
}

/** For rows in `prev` missing from `next`: the next surviving id after each (its place if it comes back). */
export function departures(prev: string[], next: string[]): Map<string, string | null> {
  const alive = new Set(next);
  const out = new Map<string, string | null>();
  prev.forEach((id, i) => {
    if (alive.has(id)) return;
    out.set(id, prev.slice(i + 1).find((x) => alive.has(x)) ?? null);
  });
  return out;
}

/** Sort `items` by a stable order (unknown ids last, in their incoming order). */
export function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const idx = new Map(order.map((id, i) => [id, i] as const));
  return [...items].sort((a, b) => (idx.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}
