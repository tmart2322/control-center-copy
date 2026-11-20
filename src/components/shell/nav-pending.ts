'use client';
/**
 * Pending navigation: the frame shows the destination's skeleton in the frame a navigation starts, before React
 * has rendered the destination page.
 *
 * Client routes (router.ts) commit through Next's history integration. In Next 15.5 that update lands in the same task
 * as a click or key (and a frame later from ⌘K), so the page usually replaces this skeleton before the browser paints;
 * a page whose chunk is still loading suspends to the same skeleton (ClientRouter). The store is the guarantee for the
 * rest: the few own routes the catch-all does not serve (/onboarding, /dev/kit) go through Next's router, a real
 * server navigation, and any client navigation React defers to a transition still paints its wireframe at once.
 *
 *   markNavPending(href, from?)  navigate() and back/forward mark it (same-pathname hrefs are ignored)
 *   usePendingPath()             the destination pathname while it is pending, else null (the sidebar highlight, the
 *                                topbar title and #cc-main's skeleton read it)
 *
 * A pending navigation ends when the pathname changes (the new route committed, or something else won), or after
 * SAFETY_MS (a navigation that never lands puts the old page back).
 */
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { normalizePath } from './routes';

export { normalizePath };

export interface NavPending {
  /** Destination pathname (no query). */
  path: string;
  /** Pathname when the navigation started; the skeleton shows only while the route is still this one. */
  from: string;
  at: number;
}

/** A navigation still pending after this long is treated as abandoned (a first dev compile of an own route takes ~2–12 s). */
export const SAFETY_MS = 30_000;

let pending: NavPending | null = null;
let safety: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => pending;
const serverSnapshot = () => null;

/**
 * Mark a navigation to `href` as pending. `from` is the pathname still on screen (default: the address bar's; back
 * and forward pass the committed one, since the address bar has already moved). Returns false for other origins
 * and for the current pathname (a link back to the page still showing also ends any pending navigation).
 */
export function markNavPending(href: string, from?: string): boolean {
  if (typeof window === 'undefined') return false;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  const path = normalizePath(url.pathname);
  const start = normalizePath(from ?? window.location.pathname);
  if (path === start) {
    // Back to the page that is still showing: that navigation supersedes the pending one.
    clearNavPending();
    return false;
  }
  if (pending && pending.path === path && pending.from === start) return true;
  pending = { path, from: start, at: performance.now() };
  if (safety) clearTimeout(safety);
  safety = setTimeout(clearNavPending, SAFETY_MS);
  emit();
  return true;
}

export function clearNavPending(): void {
  if (safety) clearTimeout(safety);
  safety = null;
  if (!pending) return;
  pending = null;
  emit();
}

export function getNavPending(): NavPending | null {
  return pending;
}

/** The raw pending navigation (also when it no longer applies to the current route). */
export function useNavPending(): NavPending | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** The destination pathname while a navigation away from the current route is pending, else null. */
export function usePendingPath(): string | null {
  const p = useNavPending();
  const pathname = normalizePath(usePathname() ?? '/');
  return p && p.from === pathname ? p.path : null;
}

/**
 * The frame's half (AppFrame mounts it once): end a pending navigation when the route commits, and give back and
 * forward the same instant skeleton as a click (the address bar has moved; the committed page is still showing).
 */
export function useNavPendingSync(): void {
  const pathname = normalizePath(usePathname() ?? '/');
  const committed = useRef(pathname);
  committed.current = pathname;
  const p = useNavPending();
  useEffect(() => {
    if (p && p.from !== pathname) clearNavPending();
  }, [p, pathname]);
  useEffect(() => {
    const onPop = () => markNavPending(window.location.href, committed.current);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}
