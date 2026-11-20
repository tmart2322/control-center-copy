/**
 * Opening things outside the app. Only ever called from an explicit click or key press (never on a live
 * event): a claude:// deep link hands off to Claude Code; http(s) sources open in a new tab.
 *
 * Test seam: when `window.__ccOpenExternal` is defined (Playwright init script), it receives the URL
 * instead, so smoke tests never launch a real app.
 */
export function openExternal(url: string): void {
  if (typeof window === 'undefined' || !url) return;
  const hook = (window as { __ccOpenExternal?: (u: string) => void }).__ccOpenExternal;
  if (hook) {
    hook(url);
    return;
  }
  if (/^(claude|slack|mailto):/i.test(url)) window.location.assign(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** `?fail=1` on the page forces every Today mutation to fail (rollback testing, UI-SPEC §15). */
export function failFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('fail') === '1';
}
