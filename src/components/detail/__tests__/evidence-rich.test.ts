// @vitest-environment jsdom
/**
 * Source messages as rich text in the work item's details: the Evidence tab's excerpts and the Why line, against the
 * real mock DataSource (placeholder seed) with fetch bridged in-process to the route handlers (the replying-to.test.ts
 * harness). A Slack snippet renders bold, links, lists and mentions by name (no raw `<@U…>`); an id nobody knows reads
 * "@someone"; script and style never reach the DOM; a plain why stays the same sentence; a long excerpt folds.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement as h, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE, routes, type NbaCard, type RouteKey, type WorkItem } from '@/contract';
import { hasSlackMarkup, renderSourceBody, snippetFormat } from '@/lib/compose';
import { createMockDataSource } from '@/server/datasource/mock';
import { resetDataSourceForTests } from '@/server/datasource';
import { handle } from '@/server/http';
import { $, $$, cleanup, click, render, waitFor } from '../../composer/__tests__/dom';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/work',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) => h('a', { href, ...rest }, children as never),
}));

const { EvidenceTab } = await import('../tabs/EvidenceTab');
const { WhySection } = await import('../panel/sections');
const { SourceText } = await import('../SourceText');

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
  resetDataSourceForTests();
  ds = createMockDataSource({ delays: { enrichMs: 40, reevalMs: 10, stepMs: 20, verifyMs: 20 }, autoplay: false });
  (globalThis as { __ccDataSource?: unknown }).__ccDataSource = ds;
  localStorage.clear();
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
  resetDataSourceForTests();
});

const mount = (el: ReactElement) => render(h(QueryClientProvider, { client: qc }, el));
const NOW = '2026-11-05T16:00:00.000Z';

describe('the Evidence tab', () => {
  it("renders a Slack snippet as Slack shows it: bold, the link, the list, mentions by name; no raw mrkdwn", async () => {
    const { container } = await mount(h(EvidenceTab, { itemId: 'w_dana_reply', active: false, now: NOW, tz: 'UTC' }));
    const quote = await waitFor(() => $('[data-evidence-snippet]', container));
    const body = $('[data-source-text="slack_mrkdwn"]', quote)!;
    expect(body).toBeTruthy();
    expect($('strong', body)!.textContent).toBe('service-agent handoff');
    expect($('.cc-mention', body)!.textContent).toBe('@Raj Mehta');
    const a = $('a', body)!;
    expect(a.getAttribute('href')).toBe('https://example.com/acme/phase-2');
    expect(a.textContent).toBe('the Phase 2 plan');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect($$('li', body).map((li) => li.textContent)).toEqual(['Agenda for 13:00', 'demo-env access for the whole team']);
    expect($('code', body)!.textContent).toBe('demo-env');
    expect($('em', body)!.textContent).toBe('the whole team');
    expect(body.textContent).toContain(':eyes:'); // emoji shortcodes stay text
    for (const raw of ['<@U0RAJ>', '<https://', '|the Phase 2 plan>', '*service-agent handoff*']) expect(body.textContent).not.toContain(raw);
    expect(container.innerHTML).not.toContain('U0RAJ');
  });

  it('the payload carries the names its mentions need, and only those', async () => {
    const p = await ds.getItemEvidence({ params: { id: 'w_dana_reply' } });
    expect(p.mentions).toEqual({ U0RAJ: 'Raj Mehta' });
    const none = await ds.getItemEvidence({ params: { id: 'w_globex_legal' } });
    expect(none.mentions).toEqual({});
  });
});

describe('SourceText', () => {
  it('an id nobody knows reads "@someone", never the raw id', async () => {
    const { container } = await mount(h(SourceText, { text: 'ping <@U0NOBODY> and <@U0RAJ>', format: 'slack_mrkdwn', mentions: { U0RAJ: 'Raj Mehta' } }));
    expect($$('.cc-mention', container).map((m) => m.textContent)).toEqual(['@someone', '@Raj Mehta']);
    expect(container.textContent).not.toContain('U0NOBODY');
  });

  it('refuses script and style: an email body loses them, a Slack body shows them as text', async () => {
    const evil = '<p onclick="window.__pwned=1">Hi</p><script>window.__pwned=1</script><style>p{display:none}</style><img src=x onerror="window.__pwned=1"><a href="javascript:alert(1)">x</a>';
    expect(renderSourceBody(evil, 'html').html).not.toMatch(/<script|<style|display:none|onclick|onerror|javascript:/i);
    const email = await mount(h(SourceText, { text: evil, format: 'html' }));
    const e = $('[data-source-text="html"]', email.container)!;
    expect(e.querySelector('script, style, img, [onclick], [onerror]')).toBeNull();
    expect(e.innerHTML).not.toMatch(/javascript:|display:none/);
    expect(e.textContent).toContain('Hi');
    await cleanup();
    const slack = await mount(h(SourceText, { text: '<script>window.__pwned=1</script><style>p{}</style> *hi*', format: 'slack_mrkdwn' }));
    const s = $('[data-source-text="slack_mrkdwn"]', slack.container)!;
    expect(s.querySelector('script, style')).toBeNull();
    expect(s.textContent).toContain('<script>window.__pwned=1</script>');
    expect($('strong', s)!.textContent).toBe('hi');
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('a long excerpt folds behind "Show all"', async () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const { container } = await mount(h(SourceText, { text, format: 'plain', fold: true }));
    const body = $('[data-source-text="plain"]', container)!;
    expect(body.className).toContain('max-h-40');
    const btn = $('button', container)!;
    expect(btn.textContent).toBe('Show all');
    await click(btn);
    expect(body.className).not.toContain('max-h-40');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('the Why section', () => {
  const item = (why: string, whyDetail: string | null = null) => ({ id: 'w_x', why, whyDetail, sources: [] }) as unknown as WorkItem;

  it('a why line holding Slack mrkdwn renders bold, links and mentions by name', async () => {
    const why = '<@U0DANA> asked for the *demo* link: <https://example.com/demo|the demo> in <#C0ACME|acme-ext>';
    const { container } = await mount(h(WhySection, { item: item(why), nba: null, heading: 'Why', mentions: { U0DANA: 'Dana Reyes' } }));
    const line = $('[data-why-section] [data-source-text]', container)!;
    expect(line).toBeTruthy();
    expect(line.textContent).toBe('@Dana Reyes asked for the demo link: the demo in #acme-ext');
    expect($('strong', line)!.textContent).toBe('demo');
    expect($('a', line)!.getAttribute('href')).toBe('https://example.com/demo');
    expect(line.innerHTML).not.toContain('U0DANA');
  });

  it("the NBA's why and its full reasoning render the same way", async () => {
    const nba = { why: 'Reply to <@U0DANA>', whyDetail: '<@U0RAJ> said *pricing* might move' } as unknown as NbaCard;
    const { container } = await mount(h(WhySection, { item: item('plain'), nba, heading: 'Why', mentions: { U0DANA: 'Dana Reyes', U0RAJ: 'Raj Mehta' } }));
    expect($('[data-source-text]', container)!.textContent).toBe('Reply to @Dana Reyes');
    await click($('button[aria-expanded]', container));
    const detail = $$('[data-source-text]', container)[1]!;
    expect(detail.textContent).toBe('@Raj Mehta said pricing might move');
  });

  it('a plain why stays the same sentence (no list, quote or emphasis by accident)', async () => {
    const why = '1. Update file_name_v2 and 3*4=12 > the old plan';
    const { container } = await mount(h(WhySection, { item: item(why), nba: null, heading: 'Why' }));
    expect($('[data-source-text]', container)).toBeNull();
    expect($('[data-why-section] p', container)!.textContent).toBe(why);
  });
});

describe('formats', () => {
  it('a Slack snippet is mrkdwn, an HTML email is HTML, everything else plain', () => {
    expect(snippetFormat('slack', 'hi')).toBe('slack_mrkdwn');
    expect(snippetFormat('gmail', '<p>Hi</p>')).toBe('html');
    expect(snippetFormat('gmail', 'Hi, 3 < 4')).toBe('plain');
    expect(snippetFormat('gemini', '<p>x</p>')).toBe('plain');
  });
  it('Slack markup is told from plain sentences', () => {
    for (const t of ['<@U0DANA> asked', 'see <https://example.com|x>', 'the *demo* link', '`code` here', 'in <#C0ACME|acme-ext>']) expect(hasSlackMarkup(t)).toBe(true);
    for (const t of ['Dana asked in #acme-ext', 'file_name_v2 and 3*4=12', 'a < b > c', 'email dana@example.com']) expect(hasSlackMarkup(t)).toBe(false);
  });
});
