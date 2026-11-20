/**
 * WIRE-FAST / ROUTER: a navigation shows the destination's skeleton before React renders the page. The pending store must ignore
 * links that don't leave the page (same pathname, other origins) and every sidebar / `g` destination must have a
 * page-specific skeleton (a new nav item without one would fall back to the neutral frame and jump on load).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NAV_DESTINATIONS, SETTINGS_NAV } from './nav';
import { clearNavPending, getNavPending, markNavPending, normalizePath } from './nav-pending';
import { hasRouteSkeleton } from './RouteSkeleton';

const g = globalThis as unknown as { window?: { location: URL } };

describe('nav-pending', () => {
  beforeEach(() => {
    g.window = { location: new URL('http://localhost:4327/work?tab=done') };
  });
  afterEach(() => {
    clearNavPending();
    delete g.window;
  });

  it('marks a navigation to another pathname, from the current one', () => {
    expect(markNavPending('/today')).toBe(true);
    expect(getNavPending()).toMatchObject({ path: '/today', from: '/work' });
  });

  it('ignores the current pathname (query-only changes keep the page mounted)', () => {
    expect(markNavPending('/work?tab=all_open')).toBe(false);
    expect(markNavPending('http://localhost:4327/work/')).toBe(false);
    expect(getNavPending()).toBeNull();
  });

  it('ignores other origins', () => {
    expect(markNavPending('https://example.com/today')).toBe(false);
    expect(getNavPending()).toBeNull();
  });

  it('drops the query and trailing slash from the destination', () => {
    markNavPending('/agents/tools/?run=x');
    expect(getNavPending()?.path).toBe('/agents/tools');
    expect(normalizePath('/')).toBe('/');
  });

  it('a click back to the current page cancels the pending one (that navigation wins in the router)', () => {
    markNavPending('/today');
    expect(markNavPending('/work')).toBe(false);
    expect(getNavPending()).toBeNull();
  });

  it('back/forward pass the page still on screen (the address bar has already moved)', () => {
    expect(markNavPending('/work', '/today')).toBe(true);
    expect(getNavPending()).toMatchObject({ path: '/work', from: '/today' });
  });

  it('clears', () => {
    markNavPending('/triage');
    clearNavPending();
    expect(getNavPending()).toBeNull();
  });
});

describe('route skeletons', () => {
  it('cover every sidebar and g-chord destination, Settings and the sub-tabs', () => {
    for (const n of [...NAV_DESTINATIONS, SETTINGS_NAV]) expect(hasRouteSkeleton(n.href), n.href).toBe(true);
    expect(hasRouteSkeleton('/deals/missed')).toBe(true);
    expect(hasRouteSkeleton('/agents/tools/')).toBe(true);
    expect(hasRouteSkeleton('/work/abc')).toBe(false);
  });
});
