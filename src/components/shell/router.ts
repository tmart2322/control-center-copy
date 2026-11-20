'use client';
/**
 * Client-side navigation (ROUTER). Every in-frame page is a client route served by one catch-all page
 * (`app/(app)/`: the client router in its layout, route table in routes.ts), so a tab switch is:
 *
 *   1. history.pushState: the address bar changes at once, within a millisecond of the click (Next's patched History
 *      API copies its router state into the entry and updates usePathname / useSearchParams, with no server request);
 *   2. the destination's wireframe: the pending skeleton (nav-pending.ts) or, while the page's chunk loads, the
 *      client router's Suspense fallback (both RouteSkeleton.tsx);
 *   3. the page (its chunk preloads on hover, focus and idle). It renders in the click's own task, with cached data
 *      at once, and shows fresh data when its queries resolve.
 *
 *   navigate(href, { replace? })   the one way to navigate in code (keys, ⌘K, rows, buttons)
 *   <AppLink href>                  the one way to link (AppLink.tsx): a real <a>, so ⌘/Ctrl/middle-click and
 *                                   "copy link" behave like the browser's
 *   preloadPath(pathname)           warm a route's chunk (AppLink does it on hover and focus)
 *
 * Paths the catch-all does not serve (/onboarding, /dev/kit) and pages without the client router mounted (a kit
 * page) fall back to Next's router (a server navigation), and other origins to the browser.
 */
import { markNavPending } from './nav-pending';
import { isClientPath, matchRoute, type RouteKey } from './routes';

export interface NavigateOptions {
  /** Replace the current history entry (filters, tabs kept in the query) instead of pushing one. */
  replace?: boolean;
}

/** What the last client navigation was, for focus handling after it commits (the client router reads it). */
export type NavKind = 'push' | 'replace' | 'pop';

interface FallbackRouter {
  push(href: string): void;
  replace(href: string): void;
}

let mounted = 0;
let fallback: FallbackRouter | null = null;
let lastKind: NavKind | null = null;
let preloader: ((key: RouteKey) => void) | null = null;

/** The client router is on screen (catch-all page mounted). Returns the unmount. StrictMode-safe (a count). */
export function registerClientRouter(preload: (key: RouteKey) => void): () => void {
  mounted += 1;
  preloader = preload;
  return () => {
    mounted = Math.max(0, mounted - 1);
  };
}

/** Next's router, for paths the catch-all does not serve (the frame registers it). */
export function registerFallbackRouter(r: FallbackRouter | null): void {
  fallback = r;
}

/** The kind of the latest navigation, consumed once (the client router moves focus after a push). */
export function takeNavKind(): NavKind | null {
  const k = lastKind;
  lastKind = null;
  return k;
}

export function noteNavKind(kind: NavKind): void {
  lastKind = kind;
}

/** Warm the chunk of the page at `pathname` (no-op off the client router or for own routes). */
export function preloadPath(pathname: string): void {
  if (!preloader || !isClientPath(pathname)) return;
  const { key } = matchRoute(pathname);
  if (key !== 'notFound') preloader(key);
}

function resolve(href: string): URL | null {
  try {
    return new URL(href, window.location.href);
  } catch {
    return null;
  }
}

/** True when this URL is handled in-page by navigate() (same origin, client route, client router mounted). */
export function isClientNavigable(href: string): boolean {
  if (typeof window === 'undefined') return false;
  const url = resolve(href);
  return !!url && url.origin === window.location.origin && mounted > 0 && isClientPath(url.pathname);
}

/**
 * A newer build is deployed than the one this tab runs (BuildWatch.tsx): its code chunks may be gone, so a client-side
 * navigation could silently fail. From then on every in-app navigation is a full page load, which picks up the new build.
 */
let staleBuild = false;
export function markStaleBuild(): void {
  staleBuild = true;
}
export const isStaleBuild = (): boolean => staleBuild;

/** Navigate to an in-app URL: client-side for every frame page, Next's router or the browser otherwise. */
export function navigate(href: string, opts: NavigateOptions = {}): void {
  if (typeof window === 'undefined') return;
  const url = resolve(href);
  if (!url) return;
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  const rel = `${url.pathname}${url.search}${url.hash}`;
  if (staleBuild) {
    if (opts.replace) window.location.replace(rel);
    else window.location.assign(rel);
    return;
  }
  if (!isClientNavigable(url.href)) {
    markNavPending(url.href);
    if (fallback) {
      if (opts.replace) fallback.replace(rel);
      else fallback.push(rel);
    } else if (opts.replace) window.location.replace(rel);
    else window.location.assign(rel);
    return;
  }
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (rel === here) return;
  preloadPath(url.pathname);
  markNavPending(url.href);
  noteNavKind(opts.replace ? 'replace' : 'push');
  // Next 15 patches the History API: it keeps its router state in the entry (so back/forward restore in place)
  // and syncs usePathname / useSearchParams to the new URL, all without a request.
  if (opts.replace) window.history.replaceState(null, '', rel);
  else window.history.pushState(null, '', rel);
}

/**
 * Should this click on an `<a href>` navigate in-page? Plain primary clicks only: ⌘/Ctrl/Shift/Alt-click, middle
 * click, `target` other than _self and `download` links are the browser's.
 */
export function isPlainLinkClick(e: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>, a: Pick<HTMLAnchorElement, 'target' | 'hasAttribute'>): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (a.target && a.target !== '_self') return false;
  return !a.hasAttribute('download');
}
