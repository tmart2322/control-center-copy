/**
 * Resume store (R-UI-7, UI-SPEC §10): selection, open sheet, scroll positions and the chat thread,
 * per route, in localStorage. Pure over a Storage-like object so it can be tested in Node.
 */

export interface SheetState {
  id: string;
  kind?: string;
}

export interface RouteResume {
  /** Selected row per list id. */
  selection: Record<string, string | null>;
  sheet: SheetState | null;
  /** scrollTop per panel id. */
  scroll: Record<string, number>;
  chatThreadId: string | null;
  /** Free-form per-route UI state (expanded groups, tabs). */
  extra: Record<string, unknown>;
  at: number;
}

export interface ResumeData {
  v: 1;
  routes: Record<string, RouteResume>;
  lastRoute: string | null;
  /** Last time the user interacted (ms). */
  lastActiveAt: number | null;
  /**
   * MIN-27: when the user last left (ms): the last input before a gap of AWAY_MS or more. "Since you left" starts
   * here; the browser sends it with every API call and the server moves its own start to it (never back).
   */
  awaySince?: number | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const RESUME_KEY = 'cc:resume:v1';
/** MIN-27: no input (or the tab hidden) for this long means the user left; the next input is a return. */
export const AWAY_MS = 30 * 60_000;
export const MAX_ROUTES = 60;

const empty = (): ResumeData => ({ v: 1, routes: {}, lastRoute: null, lastActiveAt: null, awaySince: null });
const emptyRoute = (): RouteResume => ({ selection: {}, sheet: null, scroll: {}, chatThreadId: null, extra: {}, at: 0 });

/** Normalise a pathname into a resume key (query and trailing slash dropped). */
export function routeKey(pathname: string): string {
  const p = pathname.split('?')[0]!.split('#')[0]!;
  return p.length > 1 ? p.replace(/\/+$/, '') : '/';
}

export function createResumeStore(storage: StorageLike | null, now: () => number = Date.now) {
  let cache: ResumeData | null = null;

  const read = (): ResumeData => {
    if (cache) return cache;
    try {
      const raw = storage?.getItem(RESUME_KEY);
      const parsed = raw ? (JSON.parse(raw) as ResumeData) : null;
      cache = parsed && parsed.v === 1 && parsed.routes ? parsed : empty();
    } catch {
      cache = empty();
    }
    return cache;
  };

  const write = (data: ResumeData) => {
    // LRU: keep the most recently touched routes.
    const entries = Object.entries(data.routes);
    if (entries.length > MAX_ROUTES) {
      entries.sort((a, b) => b[1].at - a[1].at);
      data = { ...data, routes: Object.fromEntries(entries.slice(0, MAX_ROUTES)) };
    }
    cache = data;
    try {
      storage?.setItem(RESUME_KEY, JSON.stringify(data));
    } catch {
      /* quota or private mode: resume is best-effort */
    }
  };

  const get = (route: string): RouteResume => ({ ...emptyRoute(), ...read().routes[routeKey(route)] });

  const patch = (route: string, p: Partial<Omit<RouteResume, 'at'>>) => {
    const data = read();
    const key = routeKey(route);
    const cur = { ...emptyRoute(), ...data.routes[key] };
    const next: RouteResume = {
      ...cur,
      ...p,
      selection: p.selection ? { ...cur.selection, ...p.selection } : cur.selection,
      scroll: p.scroll ? { ...cur.scroll, ...p.scroll } : cur.scroll,
      extra: p.extra ? { ...cur.extra, ...p.extra } : cur.extra,
      at: now(),
    };
    write({ ...data, routes: { ...data.routes, [key]: next } });
    return next;
  };

  return {
    get,
    patch,
    setSelection: (route: string, list: string, id: string | null) => patch(route, { selection: { [list]: id } }),
    setSheet: (route: string, sheet: SheetState | null) => patch(route, { sheet }),
    setScroll: (route: string, panel: string, top: number) => patch(route, { scroll: { [panel]: Math.max(0, Math.round(top)) } }),
    setChatThread: (route: string, id: string | null) => patch(route, { chatThreadId: id }),
    setExtra: (route: string, key: string, value: unknown) => patch(route, { extra: { [key]: value } }),
    lastRoute: () => read().lastRoute,
    setLastRoute: (route: string) => write({ ...read(), lastRoute: routeKey(route) }),
    lastActiveAt: () => read().lastActiveAt,
    awaySince: () => read().awaySince ?? null,
    /**
     * Record input at `at`. Returns true when it ends an absence (AWAY_MS or more since the last input): `awaySince`
     * then moves to that last input. A fresh browser knows no absence yet (null: the server keeps its own start);
     * data from before MIN-27 (a last input, no `awaySince` key) starts at that last input.
     */
    touchActive: (at = now()): boolean => {
      const d = read();
      const prev = d.lastActiveAt;
      const returned = prev !== null && at - prev >= AWAY_MS;
      const awaySince = returned ? prev : d.awaySince === undefined ? prev : d.awaySince;
      write({ ...d, lastActiveAt: prev !== null ? Math.max(prev, at) : at, awaySince });
      return returned;
    },
    clear: () => {
      cache = empty();
      try {
        storage?.removeItem(RESUME_KEY);
      } catch {
        /* ignore */
      }
    },
    /** Drop the in-memory copy (another tab wrote). */
    invalidate: () => {
      cache = null;
    },
  };
}

export type ResumeStore = ReturnType<typeof createResumeStore>;
