/** Test helpers for the VDP lane: a placeholder Claude config and a fake vdp-app-fir MCP endpoint. Placeholders only. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FIX = path.resolve(__dirname, '../fixtures/vdp');
export const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIX, `${name}.json`), 'utf8'));

/** Fake secret values: the tests assert they never appear in an error, a result or a stored row. */
export const PAT_VALUE = 'vdp_pat_PLACEHOLDERxSECRETxTOKENx0000000000000000';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const jwt = (exp: number) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp, sub: 'placeholder' })}.c2lnbmF0dXJlUExBQ0VIT0xERVI`;
export const NOW = Date.parse('2026-11-10T17:00:00Z');

export function claudeJson(o: { cookieExpSec?: number | null; pat?: string | null; url?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdp-test-'));
  const file = path.join(dir, 'claude.json');
  const headers: Record<string, string> = {};
  if (o.pat !== null) headers.Authorization = `Bearer ${o.pat ?? PAT_VALUE}`;
  if (o.cookieExpSec !== null) headers.Cookie = `central_proxy_session=${jwt(o.cookieExpSec ?? NOW / 1000 + 3600)}`;
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { 'vdp-app-fir': { type: 'http', url: o.url ?? 'https://vdp.example.test/api/mcp', headers } } }));
  return file;
}

export const cookieOf = (file: string) => (JSON.parse(fs.readFileSync(file, 'utf8')) as { mcpServers: Record<string, { headers: Record<string, string> }> }).mcpServers['vdp-app-fir']!.headers.Cookie ?? '';

export interface SeenCall {
  tool: string;
  args: Record<string, unknown>;
  headers: Record<string, string>;
}

type Handler = (args: Record<string, unknown>) => unknown;

/** A tool as `tools/list` lists it: its name and its input schema's argument names. */
export const listed = (name: string, args: string[]) => ({ name, description: `Placeholder ${name}`, inputSchema: { type: 'object', properties: Object.fromEntries(args.map((a) => [a, { type: 'string' }])) } });

/**
 * A fetch that answers `tools/call` like vdp-app's stateless MCP route (JSON response, text content), and `tools/list`
 * with `o.tools` (feature detection; recorded as the call `tools/list`).
 */
export function fakeVdp(handlers: Record<string, Handler>, o: { sse?: boolean; structured?: string[]; tools?: unknown[] } = {}) {
  const calls: SeenCall[] = [];
  const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method?: string; params: { name: string; arguments: Record<string, unknown> } };
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    if (body.method === 'tools/list') {
      calls.push({ tool: 'tools/list', args: {}, headers });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: o.tools ?? [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    calls.push({ tool: body.params.name, args: body.params.arguments, headers });
    const h = handlers[body.params.name] as Handler | undefined;
    const value = h ? h(body.params.arguments) : null;
    const result = h
      ? { content: [{ type: 'text', text: JSON.stringify(value) }], ...(o.structured?.includes(body.params.name) ? { structuredContent: value } : {}) }
      : { isError: true, content: [{ type: 'text', text: `Unknown tool ${body.params.name}` }] };
    const msg = { jsonrpc: '2.0', id: body.id, result };
    return o.sse
      ? new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      : new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

/** The recorded fixtures as a fake VDP (my two VDPs plus one that is someone else's). `tools`: what tools/list says. */
export function fixtureVdp(o: { tools?: unknown[]; companies?: Record<string, Array<{ id: string; name: string; slug: string }>> } = {}) {
  return fakeVdp(
    {
      search_vdps: () => fixture('search_vdps'),
      get_vdp: (a) => fixture(a.slug === 'acme-fy27-q4' ? 'get_vdp_acme' : a.slug === 'globex-fy27-q4' ? 'get_vdp_globex' : 'get_vdp_other'),
      get_use_case: (a) => fixture(String(a.id).endsWith('1') ? 'get_use_case_1' : 'get_use_case_2'),
      list_companies: (a) => ({ total: 0, count: 0, companies: o.companies?.[String(a.q)] ?? [] }),
      list_asset_types: () => ({ asset_types: [{ label: 'Deck' }], deliverable_types: [{ label: 'Use Case' }, { label: 'Consumption' }, { label: 'Old', archived: true }] }),
    },
    { structured: ['search_vdps'], ...(o.tools ? { tools: o.tools } : {}) },
  );
}
