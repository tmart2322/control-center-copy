// @vitest-environment jsdom
/**
 * Activity ▸ Org62 ▸ Log it, Needs you and Weeks (<TimePage>, Log it is the SE's default) against the real mock
 * DataSource, fetch bridged in-process to the route handlers (the log-view.test.ts harness; placeholder seed). Log it is
 * only logging (docs/ui/time-redesign.md, D-60 tab shell, D-70): the quarter header with what waits on you, Ready to log
 * (rows and use cases) with one filled button and the guide anchor, the logging runs, a link to what waits under Needs
 * you. Needs you (?view=needs, its count on the tab) is only what needs you: the rows grouped by what is missing with an
 * inline fix that saves through PATCH /activity/:id. Weeks (?view=weeks, or any ?week=) holds the week: its picker,
 * Suggested, Week at a glance behind its disclosure, and the week's rows that wrap (no fixed-width table).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement as h } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, routes, type RouteKey } from '@/contract';
import { createMockDataSource } from '@/server/datasource/mock';
import { resetDataSourceForTests } from '@/server/datasource';
import { handle } from '@/server/http';
import { $, $$, cleanup, click, render, waitFor } from '../../composer/__tests__/dom';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/activity',
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => h('a', { href, ...rest }, children as never),
}));

const { TimePage } = await import('../TimePage');

type Ds = ReturnType<typeof createMockDataSource>;
let ds: Ds;
let qc: QueryClient;

function matchRoute(method: string, pathname: string): { key: RouteKey; params: Record<string, string> } | null {
  for (const [key, def] of Object.entries(routes)) {
    if (def.method !== method || (def as { stream?: boolean }).stream) continue;
    const names = [...def.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1]!);
    const re = new RegExp(`^${API_BASE}${def.path.replace(/:[a-zA-Z]+/g, '([^/]+)')}$`);
    const m = re.exec(pathname);
    if (m) return { key: key as RouteKey, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)])) };
  }
  return null;
}

beforeEach(() => {
  search = '';
  resetDataSourceForTests();
  ds = createMockDataSource({ autoplay: false, delays: { enrichMs: 1e8, reevalMs: 1e8, stepMs: 1e8, verifyMs: 1e8 } });
  ds.resetStore();
  (globalThis as { __ccDataSource?: unknown }).__ccDataSource = ds;
  localStorage.clear();
  sessionStorage.clear();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const m = matchRoute(method, url.pathname);
    if (!m) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'no route', retryable: false } }), { status: 404 });
    return handle(m.key)(new Request(url, { method, headers: init?.headers, body: init?.body }), { params: Promise.resolve(m.params) });
  });
});

afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
  ds.dispose();
  resetDataSourceForTests();
});

const mount = () => render(h(QueryClientProvider, { client: qc }, h(TimePage)));

async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Activity ▸ Org62 ▸ Log it, Needs you and Weeks', () => {
  it('Log it: the quarter, then Log it with a link to what waits on you; no week on it', async () => {
    const { container } = await mount();
    const header = await waitFor(() => $('[data-testid="q4-log"]', container));
    await waitFor(() => $('[data-guide="log-steps"]', container) && $('[data-ready-row]', container));

    // two main tabs (Org62 · VDP) and Org62's sub-tabs; Log it is selected, Needs you carries its count
    expect($('[aria-label="Org62 or VDP"] [role="tab"][aria-selected="true"]', container)?.textContent).toMatch(/^Org62\d*$/);
    expect($('[aria-label="Org62 views"] [role="tab"][aria-selected="true"]', container)?.textContent).toMatch(/^Log it\d*$/);
    expect($$('[aria-label="Org62 views"] [role="tab"]', container).map((t) => t.textContent?.replace(/\d+$/, ''))).toEqual(['Log it', 'Needs you', 'Weeks', 'Ledger', 'Use cases']);
    expect($$('[aria-label="Org62 views"] [role="tab"]', container)[1]?.textContent).toMatch(/^Needs you\d+$/);

    // the quarter header: logged in Org62 against the target, and what waits on you this quarter
    const label = ds.loaded.seed.meta.quarter.label;
    expect(header.textContent).toContain(label);
    expect($('[data-testid="q4-logged"]', header)?.textContent).toMatch(/h\s*logged in Org62 of \d+ h/);
    expect($('[data-testid="q4-waiting"]', header)?.textContent).toContain('Waiting on you this quarter');
    expect(header.textContent).toContain('Human hours only');

    // only logging: Log it (with its quiet Internal group, D-64); the fix-ups are on Needs you, the week on Weeks
    const order = $$('section[id^="time-"]', container).map((s) => s.id);
    expect(order.filter((x) => x !== 'time-use-cases')).toEqual(['time-logit', 'time-internal']);
    expect($('[data-testid="needs-groups"]', container)).toBeNull();
    expect($('#time-rows', container)).toBeNull();
    expect($('[data-testid="time-suggested"]', container)).toBeNull();

    // Log it: Ready to log (its rows listed, the button naming them), then the logging runs; what waits on you, one click away
    const steps = $('[data-guide="log-steps"]', container)!;
    expect($$('[data-step]', steps).map((el) => el.dataset.step)).toEqual(['ready', 'runs']);
    expect($('[data-testid="stage-count-ready"]', steps)?.textContent).toMatch(/row|Nothing ready/);
    const ready = $$('[data-ready-row]', steps).map((li) => li.dataset.readyRow);
    expect(ready.length).toBeGreaterThan(0);
    // D-70: the VDP use cases ready for Org62 are rows of their own, and the button names them
    await waitFor(() => $('[data-ready-use-case]', steps));
    const ucs = $$('[data-ready-use-case]', steps);
    expect(ucs.length).toBeGreaterThan(0);
    expect($('[data-testid="q4-submit"]', steps)?.textContent).toMatch(new RegExp(`^Log ${ready.length} rows? and ${ucs.length} use cases? to Slackbot · `));
    expect($('[data-testid="time-needs-link"]', container)?.textContent).toMatch(/h more waiting on you →$/);
  });

  it('Weeks: the week picker, what the app found, Week at a glance, then the week’s rows that wrap', async () => {
    search = 'view=weeks';
    const { container } = await mount();
    await waitFor(() => $('[data-testid="weeks-picker"] [role="radio"]', container) && $('[data-testid="suggested-total"]', container) && $('#time-rows [data-activity-id]', container));
    expect($('[aria-label="Org62 views"] [role="tab"][aria-selected="true"]', container)?.textContent).toMatch(/^Weeks/);
    expect($$('section[id^="time-"]', container).map((s) => s.id)).toEqual(['time-suggested', 'time-rows']);
    // the picker: the quarter's weeks (and the one before), this week marked and picked
    const on = $('[data-testid="weeks-picker"] [aria-checked="true"]', container)!;
    expect(on.textContent).toContain('this week');
    expect($('[data-guide="log-steps"]', container)).toBeNull();
    // the week's rows wrap to their width: no fixed-width table, the description wraps (a textarea)
    expect(container.innerHTML).not.toContain('min-w-[72rem]');
    expect($('#time-rows textarea[aria-label="Description"]', container)).not.toBeNull();
    expect($('#time-glance', container)).toBeNull();
    await click($('[data-testid="week-glance-toggle"]', container));
    await waitFor(() => $('#time-glance', container));
    expect(localStorage.getItem('cc:time:week-at-a-glance')).toBe('1');
  });

  it('an old ?week= link opens Weeks on that week', async () => {
    search = 'view=week&week=2026-11-02';
    const { container } = await mount();
    await waitFor(() => $('[data-testid="weeks-picker"]', container));
    expect($('[aria-label="Org62 views"] [role="tab"][aria-selected="true"]', container)?.textContent).toMatch(/^Weeks/);
  });

  it('Needs you: only what needs you, grouped by what is missing; an inline fix saves', async () => {
    search = 'view=needs';
    const { container } = await mount();
    await waitFor(() => $('[data-testid="needs-groups"]', container));
    expect($('[aria-label="Org62 views"] [role="tab"][aria-selected="true"]', container)?.textContent).toMatch(/^Needs you\d+$/);
    expect($$('section[id^="time-"]', container).map((s) => s.id).filter((x) => x !== 'time-needs-ucs')).toEqual(['time-needs']);
    expect($('[data-testid="suggested-total"]', container)).toBeNull();
    expect($('#time-rows', container)).toBeNull();
    expect($('[data-guide="log-steps"]', container)).toBeNull();

    // the seed's held row has no opportunity (and no type): it is in the opportunity group, with both fixes
    const opp = $('[data-need="opp"]', container)!;
    expect($('[data-testid="opp-picker"]', $('[data-need-row="ac_wed_hooli"]', opp)!)).not.toBeNull();
    const row = await waitFor(() => $('[data-need-row="ac_wed_hooli"]', container));
    expect($('select[aria-label="Task type"]', row)).not.toBeNull();
    // the type picker offers the persona's real SE Task Types (D-64: the taxonomy, not a stale list)
    await choose($('select[aria-label="Task type"]', row) as HTMLSelectElement, 'Customer Discovery');
    await waitFor(() => ds.store.get('activity', 'ac_wed_hooli')?.taskType === 'Customer Discovery');
    // still no opportunity: it stays in Needs you, in the opportunity group
    await waitFor(() => $('[data-need="opp"] [data-need-row="ac_wed_hooli"]', container));
    expect(ds.store.get('activity', 'ac_wed_hooli')?.status).toBe('needs_input');
  });

  it('D-64: Log it ▸ Internal (no opportunity) lists the internal rows quietly; Log approves one, Dismiss sets one aside', async () => {
    const { container } = await mount();
    const group = await waitFor(() => $('[data-testid="time-internal"]', container));
    expect($$('[data-internal-row]', group).map((li) => li.dataset.internalRow).sort()).toEqual(['ac_mon_cert', 'ac_tue_repo', 'ac_wed_docs']);
    // quiet: never a warning color, and never counted as needing you
    expect(group.innerHTML).not.toMatch(/warning-/);
    expect($('[aria-label="Org62 views"] [role="tab"][aria-selected="false"]', container)?.textContent).toBe('Needs you6'); // + the seed's 2 rows not in Org62 (D-65) and its 3 rows the engine could not place
    // the type picker offers the internal types
    const types = $$('option', $('[data-internal-row="ac_tue_repo"] select[aria-label="Task type"]', group)!).map((o) => o.textContent);
    expect(types).toEqual(expect.arrayContaining(['Asset Creation', 'Personal Development', 'Sales Enablement', 'Travel']));
    await click($('[data-internal-row="ac_tue_repo"] [data-testid="internal-log"]', group));
    await waitFor(() => ds.store.get('activity', 'ac_tue_repo')?.status === 'approved');
    await click($('[data-internal-row="ac_wed_docs"] [data-testid="internal-dismiss"]', group));
    await waitFor(() => ds.store.get('activity', 'ac_wed_docs')?.status === 'dismissed');
    await waitFor(() => $$('[data-internal-row]', container).length === 1);
  });

  it('D-64: Needs you ▸ the opportunity picker offers "Internal (no opportunity)": the row becomes internal and moves to Ready to log', async () => {
    search = 'view=needs';
    const { container } = await mount();
    const row = await waitFor(() => $('[data-need-row="ac_wed_hooli"]', container));
    await click($('[data-testid="opp-picker"]', row));
    const option = await waitFor(() => $$('[role="option"]', document.body).find((o) => o.textContent?.startsWith('Internal (no opportunity)')));
    await click(option);
    await waitFor(() => ds.store.get('activity', 'ac_wed_hooli')?.internal === true);
    expect(ds.store.get('activity', 'ac_wed_hooli')).toMatchObject({ status: 'approved', oppId: null, accountName: null });
    // it leaves Needs you; what stays is the seed's rows not in Org62 after all (D-65: Log again / Leave out) and the
    // ones the engine could not place
    await waitFor(() => !$('[data-need-row="ac_wed_hooli"]', container));
    expect($$('[data-need]', container).map((s) => s.dataset.need)).toEqual(['org62', 'opp']);
    expect($$('[data-testid="relog-actions"]', container)).toHaveLength(2);
  });

  it('Needs you: plain English, the suggestion with one-click Accept, and how a row came in', async () => {
    search = 'view=needs';
    const { container } = await mount();
    const slack = await waitFor(() => $('[data-need-row="ac_tue_slack_initech"]', container));
    // the engine's canvas notes never show as they are
    expect(container.textContent).not.toMatch(/NEEDS WhatId|=> 006|=> skip|CF forced/);
    expect(slack.textContent).toContain('Slack work with no account: which opportunity, or internal?');
    expect($('[data-need-row="ac_wed_roadmap"]', container)!.textContent).toContain('Someone from globex.example was there, so it counts as customer-facing (Customer Discovery). Check the type.');
    // the suggestion, the AI color, and Accept: the row takes the opp and moves to Log it
    const s = $('[data-testid="row-suggestion"]', slack)!;
    expect(s.textContent).toContain('Initech · D360 Pilot');
    expect(s.textContent).toContain('#initech-pilot reads as Initech’s channel');
    expect(s.innerHTML).toMatch(/text-ai-700/);
    // expand: how it came in, with the source's link
    await click($('[data-testid="need-expand"]', slack));
    const details = await waitFor(() => $('[data-testid="need-details"]', slack));
    expect($('[data-testid="source-link"]', details)?.getAttribute('href')).toMatch(/^https:\/\/example\.slack\.com\//);
    expect(details.textContent).toContain('Slack · #initech-pilot');
    await click($('[data-testid="accept-suggestion"]', slack));
    await waitFor(() => ds.store.get('activity', 'ac_tue_slack_initech')?.oppId === 'opp_initech_pilot');
    expect(ds.store.get('activity', 'ac_tue_slack_initech')?.status).toBe('approved');
    await waitFor(() => !$('[data-need-row="ac_tue_slack_initech"]', container));
  });

  it('Needs you: select several, then one action names how many rows it acts on', async () => {
    search = 'view=needs';
    const { container } = await mount();
    await waitFor(() => $('[data-need-row="ac_mon_claude_model"]', container));
    await click($('[data-testid="select-suggested"]', container));
    const bar = await waitFor(() => $('[data-testid="needs-selected"]', container) && $('[data-testid="needs-bulk"]', container));
    expect($('[data-testid="needs-selected"]', bar)!.textContent).toMatch(/^3 rows selected/);
    expect($('[data-testid="bulk-accept"]', bar)!.textContent).toBe('Accept 3 suggestions');
    await click($('[data-testid="bulk-accept"]', bar));
    await waitFor(() => ds.store.get('activity', 'ac_wed_hooli')?.oppId === 'opp_hooli_nce' && ds.store.get('activity', 'ac_tue_slack_initech')?.oppId === 'opp_initech_pilot' && !!ds.store.get('activity', 'ac_wed_roadmap')?.oppId);
    // the row with nothing to go on: tick it, mark it internal (the button names the one row)
    const claude = await waitFor(() => $('[data-need-row="ac_mon_claude_model"]', container));
    await click($('[data-testid="need-check"]', claude));
    const one = await waitFor(() => $('[data-testid="bulk-internal"]', container));
    expect(one.textContent).toBe('Mark 1 row internal');
    await click(one);
    await waitFor(() => ds.store.get('activity', 'ac_mon_claude_model')?.internal === true);
  });
});
