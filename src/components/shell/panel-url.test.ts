/**
 * B-073b: the panel's URL mirror must go THROUGH Next's router, not around it. Next patches
 * history.replaceState: a state carrying its `__NA` marker is treated as Next's own write and NOT synced
 * into the router (canonical URL, useSearchParams). PanelUrlSync used to pass `window.history.state`
 * (which carries `__NA`), so Next's next history write (Health's tab switch via router.replace, a refresh,
 * HMR) restored the bare `/health` while the connector panel stayed open.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { replacePanelUrl } from './panel';

/** Next 15's patched replaceState, reduced to its sync rule (app-router.js). */
function nextLikeWindow(href: string) {
  const router = { canonicalUrl: new URL(href).pathname + new URL(href).search };
  const loc = new URL(href);
  const history = {
    state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'] } as Record<string, unknown> | null,
    replaceState(data: Record<string, unknown> | null, _u: string, url: URL | string) {
      const next = new URL(String(url), loc.href);
      if (!data?.__NA) {
        // copyNextJsInternalHistoryState + ACTION_RESTORE: the router adopts the URL.
        data = { ...(data ?? {}), __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: history.state?.__PRIVATE_NEXTJS_INTERNALS_TREE };
        router.canonicalUrl = next.pathname + next.search;
      }
      history.state = data;
      loc.href = next.href;
    },
  };
  /** Next's HistoryUpdater after any router state change: it writes the canonical URL back. */
  const routerWrite = () => history.replaceState({ ...history.state, __NA: true }, '', router.canonicalUrl);
  return { window: { history, location: loc }, router, routerWrite, loc };
}

const g = globalThis as { window?: unknown };
afterEach(() => {
  delete g.window;
});

describe('panel URL mirror (B-073b)', () => {
  it('Next adopts the panel params, so its next history write keeps them', () => {
    const w = nextLikeWindow('http://localhost:4327/health');
    g.window = w.window;
    replacePanelUrl(new URL('http://localhost:4327/health?panel=details&item=slack&kind=connector'));
    expect(w.router.canonicalUrl).toBe('/health?panel=details&item=slack&kind=connector');
    w.routerWrite(); // e.g. router.refresh() or a page's router.replace
    expect(w.loc.pathname + w.loc.search).toBe('/health?panel=details&item=slack&kind=connector');
    expect((w.window.history.state as { __PRIVATE_NEXTJS_INTERNALS_TREE?: unknown }).__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual(['tree']);
  });

  it('the old call (passing window.history.state) is the bug: Next drops the params on its next write', () => {
    const w = nextLikeWindow('http://localhost:4327/health');
    w.window.history.replaceState(w.window.history.state, '', '/health?panel=details&item=slack&kind=connector');
    expect(w.loc.search).toBe('?panel=details&item=slack&kind=connector');
    w.routerWrite();
    expect(w.loc.pathname + w.loc.search).toBe('/health');
  });
});
