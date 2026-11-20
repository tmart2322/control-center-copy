/**
 * The live-list merge (docs/UX.md "Live updates"), as one pure step so every page applies fresh data the same way:
 *
 *  - Stable order: rows already on screen keep their relative order; a background refetch never moves them.
 *  - Arrivals enter at their natural place (before the next row the server puts after them; the end when none),
 *    so a new draft lands above the one you have selected and your selection stays put.
 *  - Many at once, or while you are scrolled down or interacting: arrivals wait behind a "N new · Show" pill.
 *  - Rows that left elsewhere linger in place (fading out) for a moment; the row open in the panel stays until you
 *    move on. Rows you removed yourself leave at once.
 *  - A row that left recently and comes back returns to its old place: unmarked after your Undo, marked when it came
 *    back from elsewhere (reopened by an engine, another tab).
 */

export interface LiveMergeInput {
  /** What is on screen now, in display order (live rows and rows fading out). */
  shown: readonly string[];
  /** The server's order now. */
  incoming: readonly string[];
  /** Arrivals waiting behind the pill. */
  held?: readonly string[];
  /** A new list (first data, another tab or filter): take the server's order as is. */
  initial?: boolean;
  /** Rows that left recently → the id that followed each when it left (null: it was last). */
  returning?: ReadonlyMap<string, string | null>;
  /** Hold arrivals (the user is scrolled down or interacting with the list). */
  hold?: boolean;
  /** More arrivals than this at once wait behind the pill. */
  burst?: number;
  /** The user pressed Show: place every held arrival now. */
  flush?: boolean;
  /** 'natural' (default): where the server puts them; 'end': appended. */
  place?: 'natural' | 'end';
  /** A row that left: true keeps it on screen (fading out) instead of dropping it now. */
  linger?: (id: string) => boolean;
  /** A row that came back: true marks it as new (it came back from elsewhere, not by your Undo). */
  markReturning?: (id: string) => boolean;
}

export interface LiveMerge {
  /** Display order, including rows that are fading out. */
  order: string[];
  /** Arrivals placed by this merge (mark them as new). */
  inserted: string[];
  /** Arrivals waiting behind the pill, in server order. */
  held: string[];
  /** Rows in `order` that are no longer in the data. */
  lingering: string[];
  /** Rows that left the screen in this merge. */
  dropped: string[];
}

export const DEFAULT_BURST = 3;

export function mergeLive(i: LiveMergeInput): LiveMerge {
  const incoming = [...i.incoming];
  if (i.initial) return { order: incoming, inserted: [], held: [], lingering: [], dropped: [] };
  const inc = new Set(incoming);
  const shownSet = new Set(i.shown);
  const linger = i.linger ?? (() => false);

  const order: string[] = [];
  const lingering: string[] = [];
  const dropped: string[] = [];
  for (const id of i.shown) {
    if (inc.has(id)) order.push(id);
    else if (linger(id)) {
      order.push(id);
      lingering.push(id);
    } else dropped.push(id);
  }

  const fresh = incoming.filter((id) => !shownSet.has(id));
  const wasHeld = new Set((i.held ?? []).filter((id) => inc.has(id)));
  const back = i.returning ? fresh.filter((id) => !wasHeld.has(id) && i.returning!.has(id)) : [];
  const backSet = new Set(back);
  const arrivals = fresh.filter((id) => !backSet.has(id));

  // A row that comes back (Undo) returns to its old place, whatever else is held.
  for (const id of back) {
    const anchor = i.returning!.get(id) ?? null;
    const at = anchor ? order.indexOf(anchor) : -1;
    if (at >= 0) order.splice(at, 0, id);
    else order.push(id);
  }

  const burst = i.burst ?? DEFAULT_BURST;
  // An empty list has nothing to disturb: what arrives is shown (marked) at once, however many.
  const holdAll = !i.flush && arrivals.length > 0 && order.length > 0 && (!!i.hold || arrivals.length > burst);
  const backMarked = i.markReturning ? back.filter((id) => i.markReturning!(id)) : [];
  if (holdAll) return { order, inserted: backMarked, held: arrivals, lingering, dropped };

  if (i.place === 'end') order.push(...arrivals);
  else {
    // The natural place, robust to a server that re-sorted what is on screen:
    //  - first in the server's order (nothing on screen before it): the top, like a new draft in a newest-first list;
    //  - right after an arrival placed just before it in this merge (arrivals stay together, in the server's order);
    //  - else before the next row on screen the server puts after it; nothing after it: the end.
    const at = new Map(incoming.map((id, n) => [id, n] as const));
    const placed = new Set(order);
    const arrived = new Set<string>();
    let top = 0;
    for (const id of arrivals) {
      const n = at.get(id)!;
      let prev: string | null = null;
      for (let j = n - 1; j >= 0; j--) {
        if (placed.has(incoming[j]!)) {
          prev = incoming[j]!;
          break;
        }
      }
      let next: string | null = null;
      for (let j = n + 1; j < incoming.length; j++) {
        if (placed.has(incoming[j]!)) {
          next = incoming[j]!;
          break;
        }
      }
      if (prev === null) order.splice(top++, 0, id);
      else if (arrived.has(prev)) order.splice(order.indexOf(prev) + 1, 0, id);
      else if (next !== null) order.splice(order.indexOf(next), 0, id);
      else order.push(id);
      placed.add(id);
      arrived.add(id);
    }
  }
  return { order, inserted: [...backMarked, ...arrivals], held: [], lingering, dropped };
}

/** For rows in `prev` missing from `next`: the next surviving id after each (its place if it comes back). */
export function departuresOf(prev: readonly string[], next: readonly string[]): Map<string, string | null> {
  const alive = new Set(next);
  const out = new Map<string, string | null>();
  prev.forEach((id, n) => {
    if (alive.has(id)) return;
    let after: string | null = null;
    for (let j = n + 1; j < prev.length; j++) {
      if (alive.has(prev[j]!)) {
        after = prev[j]!;
        break;
      }
    }
    out.set(id, after);
  });
  return out;
}

/**
 * Where the selection goes when its row left the list: the next row that is still there, else the previous one, else
 * nowhere (null). `null` too when the selected row did not leave (it stays where it is).
 */
export function survivorOf(before: readonly string[], after: readonly string[], selected: string | null | undefined): string | null {
  if (!selected || after.includes(selected) || !before.includes(selected)) return null;
  const alive = new Set(after);
  const i = before.indexOf(selected);
  for (let j = i + 1; j < before.length; j++) if (alive.has(before[j]!)) return before[j]!;
  for (let j = i - 1; j >= 0; j--) if (alive.has(before[j]!)) return before[j]!;
  return null;
}

/**
 * A detail field the user may be editing, against the server's value (docs/UX.md "Live updates"):
 *  - nothing unsaved: take the server's value (fields update in place); a focused field takes it when you leave it;
 *  - unsaved text, and the server moved away from the value the edit started from: keep the user's text and report
 *    a conflict ("Changed elsewhere: keep mine / take theirs");
 *  - the server now agrees with the user: no conflict, and the edit's base moves up.
 */
export interface FieldMergeInput<T> {
  /** The server value the edit started from. */
  base: T;
  /** What the field shows (the user's text while editing). */
  local: T;
  /** The latest server value. */
  server: T;
  editing: boolean;
  equal?: (a: T, b: T) => boolean;
}

export type FieldMerge<T> = { kind: 'same' } | { kind: 'wait' } | { kind: 'adopt'; value: T } | { kind: 'agree'; value: T } | { kind: 'conflict'; mine: T; theirs: T };

export function mergeField<T>({ base, local, server, editing, equal = Object.is }: FieldMergeInput<T>): FieldMerge<T> {
  if (equal(base, server)) return { kind: 'same' };
  if (equal(local, server)) return { kind: 'agree', value: server };
  const dirty = !equal(local, base);
  if (!dirty) return editing ? { kind: 'wait' } : { kind: 'adopt', value: server }; // focused, nothing typed: on blur
  return { kind: 'conflict', mine: local, theirs: server };
}
