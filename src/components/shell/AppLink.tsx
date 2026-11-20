'use client';
/**
 * <AppLink href>: the app's link (ROUTER). A real `<a href>`, so ⌘/Ctrl-click, middle-click, "open in new tab"
 * and "copy link" are the browser's; a plain left click navigates client-side (router.ts `navigate`): the URL
 * changes in the same frame, the destination's wireframe paints, then the page renders. Hover and focus warm the
 * destination's chunk.
 *
 * Drop-in for next/link's common props: `href` (string), `replace`, and any anchor attribute. `onClick` runs first;
 * calling `preventDefault()` in it skips the navigation.
 */
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { isPlainLinkClick, navigate, preloadPath } from './router';

export interface AppLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Replace the current history entry instead of pushing one. */
  replace?: boolean;
}

function warm(href: string) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin) preloadPath(url.pathname);
  } catch {
    /* not a URL: nothing to warm */
  }
}

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink({ href, replace, onClick, onPointerEnter, onFocus, ...rest }, ref) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (!isPlainLinkClick(e, e.currentTarget)) return;
    const url = new URL(e.currentTarget.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    e.preventDefault();
    navigate(href, { replace });
  };
  return (
    <a
      ref={ref}
      href={href}
      onClick={handleClick}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        warm(href);
      }}
      onFocus={(e) => {
        onFocus?.(e);
        warm(href);
      }}
      {...rest}
    />
  );
});
