'use client';
/**
 * Resume hooks (R-UI-7). Everything is keyed by the current route and restored after mount:
 *
 *   const [selected, setSelected] = useResumeSelection('work-list');
 *   const [sheet, setSheet] = useResumeSheet();                 // { id, kind } | null
 *   const [threadId, setThreadId] = useResumeChatThread();
 *   useResumeScroll(panelRef, 'work-list');                     // restores scrollTop, saves on scroll
 *   const [collapsed, setCollapsed] = useResumeExtra('groups', {} as Record<string, boolean>);
 */
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { setRequestHeaders } from '@/client/api';
import { createResumeStore, routeKey, type ResumeStore, type SheetState } from './store';

let singleton: ResumeStore | null = null;
let bootLastActive: number | null | undefined;

export function getResumeStore(): ResumeStore {
  if (!singleton) {
    const storage = typeof window !== 'undefined' ? window.localStorage : null;
    singleton = createResumeStore(storage);
    if (bootLastActive === undefined) bootLastActive = singleton.lastActiveAt();
    // Opening the app is activity: a boot after an absence moves `awaySince` before the first API call goes out.
    if (storage) singleton.touchActive();
  }
  return singleton;
}

/** MIN-27: every API call tells the server when the user last left, so Home, Today and the shell agree. */
export const AWAY_SINCE_HEADER = 'x-cc-away-since';
if (typeof window !== 'undefined') {
  setRequestHeaders((): Record<string, string> => {
    const at = getResumeStore().awaySince();
    return at ? { [AWAY_SINCE_HEADER]: String(at) } : {};
  });
}

/** What a return refreshes: the digests that start from when the user left. */
const SINCE_TOPICS = ['home', 'today', 'since'];

/** lastActiveAt as it was when this tab booted (before this session touched it). */
export function getBootLastActive(): number | null {
  getResumeStore();
  return bootLastActive ?? null;
}

function useRoute(): string {
  return routeKey(usePathname() ?? '/');
}

function useRouteState<T>(read: (s: ResumeStore, route: string) => T, write: (s: ResumeStore, route: string, v: T) => void, initial: T): [T, (v: T) => void] {
  const route = useRoute();
  const [value, setValue] = useState<T>(initial);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    const v = readRef.current(getResumeStore(), route);
    setValue(v === undefined || v === null ? initial : v);
    // initial is a default; re-read only when the route changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);
  const writeRef = useRef(write);
  writeRef.current = write;
  const set = useCallback(
    (v: T) => {
      setValue(v);
      writeRef.current(getResumeStore(), route, v);
    },
    [route],
  );
  return [value, set];
}

export function useResumeSelection(listId = 'main'): [string | null, (id: string | null) => void] {
  return useRouteState<string | null>(
    (s, r) => s.get(r).selection[listId] ?? null,
    (s, r, v) => s.setSelection(r, listId, v),
    null,
  );
}

export function useResumeSheet(): [SheetState | null, (sheet: SheetState | null) => void] {
  return useRouteState<SheetState | null>(
    (s, r) => s.get(r).sheet,
    (s, r, v) => s.setSheet(r, v),
    null,
  );
}

export function useResumeChatThread(): [string | null, (id: string | null) => void] {
  return useRouteState<string | null>(
    (s, r) => s.get(r).chatThreadId,
    (s, r, v) => s.setChatThread(r, v),
    null,
  );
}

export function useResumeExtra<T>(key: string, initial: T): [T, (v: T) => void] {
  return useRouteState<T>(
    (s, r) => (s.get(r).extra[key] as T | undefined) ?? initial,
    (s, r, v) => s.setExtra(r, key, v),
    initial,
  );
}

/**
 * Restore and persist a panel's scrollTop. Restoration retries for ~1.5 s while the panel's
 * content is still loading (so a skeleton → data swap doesn't lose the position).
 */
export function useResumeScroll(ref: RefObject<HTMLElement | null>, panelId: string, opts: { enabled?: boolean } = {}) {
  const route = useRoute();
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const store = getResumeStore();
    const target = store.get(route).scroll[panelId] ?? 0;
    let tries = 0;
    let raf = 0;
    const restore = () => {
      if (!ref.current) return;
      if (target > 0 && ref.current.scrollHeight - ref.current.clientHeight < target && tries++ < 90) {
        raf = requestAnimationFrame(restore);
        return;
      }
      ref.current.scrollTop = target;
    };
    if (target > 0) restore();
    else el.scrollTop = 0;
    let t: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => store.setScroll(route, panelId, el.scrollTop), 150);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      if (t) clearTimeout(t);
      el.removeEventListener('scroll', onScroll);
    };
  }, [ref, route, panelId, enabled]);
}

/** Mount once (AppFrame): remembers the last route and the user's last activity. */
export function useResumeTracker() {
  const route = useRoute();
  const qc = useQueryClient();
  useEffect(() => {
    getResumeStore().setLastRoute(route);
  }, [route]);
  useEffect(() => {
    const store = getResumeStore();
    let last = 0;
    const touch = () => {
      const n = Date.now();
      if (n - last < 30_000) return;
      last = n;
      // Back after an absence (the tab stayed open): refetch the digests, which now send the new awaySince.
      if (store.touchActive(n)) for (const t of SINCE_TOPICS) void qc.invalidateQueries({ queryKey: [t] });
    };
    touch();
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch);
    const onVis = () => document.visibilityState === 'hidden' && store.touchActive();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [qc]);
}
