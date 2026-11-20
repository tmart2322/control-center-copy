/**
 * "Did I just do that?" Live views treat a change the user made here differently from one that came in from
 * elsewhere (docs/UX.md "Live updates"):
 *  - a row the user approved, accepted or dismissed leaves at once and the open panel moves on to its neighbour;
 *  - a row that left because of something elsewhere (the worker, another tab, autopilot) fades out in place, and an
 *    open panel stays on it and says so ("Applied elsewhere") instead of jumping.
 *
 * Every write the client makes (`api()` with a non-GET route, and every TanStack mutation) notes the ids it names
 * here, so a refetch that drops those ids within LOCAL_ID_MS reads as local. A write right after a pointer or key
 * gesture also opens a short window in which any departure reads as local (an action whose ids live deeper than
 * the input names). Nothing here is persisted; it is per tab.
 */

/** A write that named an id makes that id's departure "local" for this long (approve → undo window → dispatch). */
export const LOCAL_ID_MS = 60_000;
/** Any write within GESTURE_MS of a click or key makes every departure "local" for this long. */
export const LOCAL_ANY_MS = 2_500;
const GESTURE_MS = 1_500;

const byId = new Map<string, number>();
let lastGestureAt = 0;
let lastActionAt = 0;

/** Keys whose string (or string[]) values are entity ids in a write's params or body. */
const ID_KEY = /^(id|ids)$|Ids?$/;

/** The entity ids a write names: every route param, and body fields named id / ids / …Id / …Ids (one level deep). */
export function idsOfInput(input: unknown): string[] {
  const out = new Set<string>();
  const i = (input ?? {}) as { params?: Record<string, unknown>; body?: unknown };
  for (const v of Object.values(i.params ?? {})) if (typeof v === 'string' && v) out.add(v);
  const scan = (o: unknown, depth: number) => {
    if (!o || typeof o !== 'object' || depth > 1) return;
    if (Array.isArray(o)) {
      for (const x of o.slice(0, 200)) scan(x, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (ID_KEY.test(k)) {
        if (typeof v === 'string' && v) out.add(v);
        else if (Array.isArray(v)) for (const x of v.slice(0, 200)) if (typeof x === 'string' && x) out.add(x);
      } else if (v && typeof v === 'object') scan(v, depth + 1);
    }
  };
  scan(i.body, 0);
  return [...out];
}

/** The user clicked, tapped or pressed a key (installed once by the providers). */
export function noteGesture(at = Date.now()): void {
  lastGestureAt = at;
}

/** A write this tab is making (or an optimistic patch about to happen) for these ids. */
export function noteLocalWrite(ids: readonly string[], at = Date.now()): void {
  for (const id of ids) byId.set(id, at);
  if (at - lastGestureAt <= GESTURE_MS) lastActionAt = at;
  if (byId.size > 2000) {
    for (const [k, t] of byId) if (at - t > LOCAL_ID_MS) byId.delete(k);
  }
}

/** True when this id's change (most often: it left a list) is the user's own doing in this tab. */
export function isLocalChange(id: string | null | undefined, at = Date.now()): boolean {
  if (at - lastActionAt <= LOCAL_ANY_MS) return true;
  if (!id) return false;
  const t = byId.get(id);
  return t !== undefined && at - t <= LOCAL_ID_MS;
}

/** Tests only. */
export function resetIntent(): void {
  byId.clear();
  lastGestureAt = 0;
  lastActionAt = 0;
}

let installed = false;
/** Track pointer and key gestures (capture phase, passive). Idempotent. */
export function installGestureTracking(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const on = () => noteGesture();
  window.addEventListener('pointerdown', on, { capture: true, passive: true });
  window.addEventListener('keydown', on, { capture: true, passive: true });
}
