/**
 * ROUTER: the route table the catch-all page and the client router share, the legacy redirect, the titles, and the
 * click and navigate rules (a tab switch is a history.pushState: no server request, the URL changes at once).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAV_DESTINATIONS, SETTINGS_NAV } from './nav';
import { clearNavPending, getNavPending } from './nav-pending';
import { isClientNavigable, isPlainLinkClick, navigate, registerClientRouter, registerFallbackRouter, takeNavKind } from './router';
import { documentTitleFor, isClientPath, matchRoute, pageTitleFor, queryFromRecord, redirectFor, ROUTES } from './routes';

describe('route table', () => {
  it('matches every tab and sub-tab, with decoded params', () => {
    expect(matchRoute('/')).toEqual({ key: 'home', params: {}, path: '/' });
    expect(matchRoute('/today/').key).toBe('today');
    expect(matchRoute('/deals/missed').key).toBe('missed');
    expect(matchRoute('/deals/acc_1?panel=details&item=w1')).toEqual({ key: 'account', params: { accountId: 'acc_1' }, path: '/deals/acc_1' });
    expect(matchRoute('/work/w%2F1').params).toEqual({ id: 'w/1' });
    expect(matchRoute('/agents/tools#run').key).toBe('tools');
    expect(matchRoute('/initiatives/ini_1').key).toBe('initiative');
  });

  it('sends unknown paths to the not-found view', () => {
    expect(matchRoute('/nope').key).toBe('notFound');
    expect(matchRoute('/work/a/b').key).toBe('notFound');
    expect(matchRoute('/deals/').key).toBe('deals');
  });

  it('serves every sidebar and g-chord destination client-side', () => {
    for (const n of [...NAV_DESTINATIONS, SETTINGS_NAV]) {
      expect(isClientPath(n.href), n.href).toBe(true);
      expect(matchRoute(n.href).key, n.href).not.toBe('notFound');
    }
  });

  it('leaves the own routes to Next (onboarding, the kit, the API)', () => {
    expect(isClientPath('/onboarding')).toBe(false);
    expect(isClientPath('/dev/kit/ui')).toBe(false);
    expect(isClientPath('/api/v1/today')).toBe(false);
    expect(isClientPath('/developer')).toBe(true);
  });

  it('every route has a title, and the browser tab reads "<title> · Command Center"', () => {
    for (const r of ROUTES) expect(pageTitleFor(r.pattern.replace(/:\w+/g, 'x'))).toBe(r.title);
    expect(documentTitleFor('Deals')).toBe('Deals · Command Center');
    expect(documentTitleFor('Home')).toBe('Command Center');
  });

  it('redirects the legacy /agents?tab=tools link', () => {
    expect(redirectFor('/agents', new URLSearchParams('tab=tools&tool=t 1'))).toBe('/agents/tools?run=t%201');
    expect(redirectFor('/agents/', queryFromRecord({ tab: ['tools'] }))).toBe('/agents/tools');
    expect(redirectFor('/agents', new URLSearchParams('tab=runs'))).toBeNull();
  });
});

describe('isPlainLinkClick', () => {
  const a = (attrs: Record<string, string> = {}) => ({ target: attrs.target ?? '', hasAttribute: (n: string) => n in attrs });
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  it('takes plain primary clicks only', () => {
    expect(isPlainLinkClick(click, a())).toBe(true);
    expect(isPlainLinkClick({ ...click, metaKey: true }, a())).toBe(false);
    expect(isPlainLinkClick({ ...click, ctrlKey: true }, a())).toBe(false);
    expect(isPlainLinkClick({ ...click, shiftKey: true }, a())).toBe(false);
    expect(isPlainLinkClick({ ...click, button: 1 }, a())).toBe(false);
    expect(isPlainLinkClick({ ...click, defaultPrevented: true }, a())).toBe(false);
    expect(isPlainLinkClick(click, a({ target: '_blank' }))).toBe(false);
    expect(isPlainLinkClick(click, a({ download: '' }))).toBe(false);
    expect(isPlainLinkClick(click, a({ target: '_self' }))).toBe(true);
  });
});

describe('navigate', () => {
  const g = globalThis as unknown as { window?: unknown };
  let loc: URL;
  let history: { pushState: ReturnType<typeof vi.fn>; replaceState: ReturnType<typeof vi.fn> };
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    loc = new URL('http://localhost:4327/work?tab=done');
    const setUrl = (_s: unknown, _t: string, url: string) => {
      loc = new URL(url, loc);
    };
    history = { pushState: vi.fn(setUrl), replaceState: vi.fn(setUrl) };
    g.window = {
      get location() {
        return Object.assign(loc, { assign: vi.fn(), replace: vi.fn() });
      },
      history,
    };
  });
  afterEach(() => {
    unregister?.();
    unregister = null;
    registerFallbackRouter(null);
    clearNavPending();
    takeNavKind();
    delete g.window;
  });

  it('pushes a client route with no server navigation, marks it pending and warms its chunk', () => {
    const preload = vi.fn();
    unregister = registerClientRouter(preload);
    expect(isClientNavigable('/deals/acc_1')).toBe(true);
    navigate('/deals/acc_1?panel=details&item=w1');
    expect(history.pushState).toHaveBeenCalledWith(null, '', '/deals/acc_1?panel=details&item=w1');
    expect(getNavPending()).toMatchObject({ path: '/deals/acc_1', from: '/work' });
    expect(preload).toHaveBeenCalledWith('account');
    expect(takeNavKind()).toBe('push');
  });

  it('replaces for query-only changes and skips the current URL', () => {
    unregister = registerClientRouter(vi.fn());
    navigate('/work?tab=all_open', { replace: true });
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/work?tab=all_open');
    expect(getNavPending()).toBeNull();
    navigate('/work?tab=all_open');
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it('hands own routes, and pages without the client router, to Next', () => {
    const push = vi.fn();
    registerFallbackRouter({ push, replace: vi.fn() });
    unregister = registerClientRouter(vi.fn());
    navigate('/onboarding');
    expect(push).toHaveBeenCalledWith('/onboarding');
    unregister();
    unregister = null;
    navigate('/today');
    expect(push).toHaveBeenLastCalledWith('/today');
    expect(history.pushState).not.toHaveBeenCalled();
  });
});
