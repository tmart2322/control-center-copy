'use client';
/**
 * Page titles for the topbar. The route map (routes.ts `pageTitleFor`) covers every page; a page that knows better
 * (a work item, an account) calls `usePageTitle('Acme')` while mounted. The hook always returns the resolved title,
 * and the client router mirrors it into document.title.
 */
import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { pageTitleFor } from './routes';

export { pageTitleFor };

// ── Override store (one page at a time) ─────────────────────────────────────────────────────

interface Override {
  path: string;
  title: string;
  token: number;
}

let override: Override | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => override;

/**
 * The topbar title for the current route. Pass a title to override the route map while the calling
 * component is mounted (null/undefined keeps the map).
 */
export function usePageTitle(title?: string | null): string {
  const pathname = usePathname() ?? '/';
  const current = useSyncExternalStore(subscribe, snapshot, () => null);
  useEffect(() => {
    if (!title) return;
    const token = ++seq;
    override = { path: pathname, title, token };
    emit();
    return () => {
      if (override?.token === token) {
        override = null;
        emit();
      }
    };
  }, [title, pathname]);
  if (title) return title;
  return current && current.path === pathname ? current.title : pageTitleFor(pathname);
}
