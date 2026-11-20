/**
 * The logging canvas (`slack_canvas.create`, D-47): one batch work order = one Outbox item; dry run records the exact
 * `slack_create_canvas` payload and creates nothing; a live Apply goes through the gateway only and is read back with
 * `slack_read_canvas`; the relay carries the two canvas tools and nothing else (a message send stays fail-closed).
 * The mock stages a batch from its rows and marks them handed off once the (simulated) canvas exists.
 * Placeholders only; the real Slack relay is never called (fakes only).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routes, Seed, type RouteKey, type RouteOutput } from '../../src/contract';
import { canvasActionFor, canvasActionPayload, CANVAS_MAX_BYTES } from '../../src/lib/canvas/payload';
import { adapterFor, channelOf, confirmDelivery, liveOutboxTransport, OutboxDelivery, OutboxGateway, OutboxLiveDisabledError, payloadHash, SimulatedOutboxTransport, type ToolCall } from '../../src/outbox';
import { parseCanvasWrite } from '../../src/outbox/adapters/canvas';
import { classifyDeliveryError, RelayNotSentError, ToolCallError } from '../../src/outbox/errors';
import { CANVAS_RELAY_TOOLS, slackCanvasRelay } from '../../src/outbox/relay';
import { MockDataSource } from '../../src/server/datasource/mock';
import { payloadFor } from '../../src/server/datasource/mock/render';

const AT = '2026-11-10T17:00:00.000Z';
const EMPTY = { type: 'doc' as const, content: [] };
const MD = '::: {.callout}\n**Slackbot: this canvas is a complete work order. Execute it in Org62 for PERSON_ME (User Id 005XX0000000OWNAAA) without asking for more context.** Rules:\n:::\n\n# ADD (1 rows · 1.00 h of activities)\n\n|#|Object|…|\n|---|\n|1|Event|ACCOUNT_1 / Discovery|…|';
const dest = canvasActionFor({ title: 'Activity log · Nov 3 · 1 row', markdown: MD, eventIds: ['act-1'], hours: 1, updates: 0, part: 1, parts: 1 });

describe('the canvas action', () => {
  it('maps to the slack_canvas channel and one slack_create_canvas call with exactly the title and work order', () => {
    expect(channelOf(dest)).toBe('slack_canvas');
    const payload = canvasActionPayload(dest);
    expect(payload).toMatchObject({ tool: 'slack_create_canvas', args: { title: 'Activity log · Nov 3 · 1 row', content: MD }, rows: 1, hours: 1 });
    expect(adapterFor('slack_canvas').toolCall(payload, 'send')).toEqual({ server: 'slack', tool: 'slack_create_canvas', args: { title: 'Activity log · Nov 3 · 1 row', content: MD } });
    expect(dest.changes.map((c) => c.label)).toEqual(['Org62 Events to create', 'Then']);
  });

  it('refuses a tampered title, a different tool and a work order too big for one canvas', () => {
    const a = adapterFor('slack_canvas');
    const p = canvasActionPayload(dest);
    expect(() => a.toolCall({ ...p, args: { ...(p.args as object), title: 'something else' } }, 'send')).toThrow(/do not match/);
    expect(() => a.toolCall({ ...p, tool: 'slack_update_canvas' }, 'send')).toThrow(/only creates a canvas/);
    const big = canvasActionPayload(canvasActionFor({ title: 'Big', markdown: 'x'.repeat(CANVAS_MAX_BYTES + 1), eventIds: ['a'], hours: 1, updates: 0, part: 1, parts: 1 }));
    expect(() => a.toolCall(big, 'send')).toThrow(/at most 900000/);
    // Slack counts bytes: 300,001 three-byte characters are under 900,000 characters and over 900,000 bytes
    const wide = canvasActionPayload(canvasActionFor({ title: 'Wide', markdown: '€'.repeat(300_001), eventIds: ['a'], hours: 1, updates: 0, part: 1, parts: 1 }));
    expect(wide.invalid).toMatch(/900003 bytes/);
    expect(canvasActionPayload(canvasActionFor({ title: 'Fits', markdown: '€'.repeat(300_000), eventIds: ['a'], hours: 1, updates: 0, part: 1, parts: 1 })).invalid).toBeUndefined();
  });

  it('reads the new canvas id and link from a JSON or a text answer', () => {
    expect(parseCanvasWrite(JSON.stringify({ ok: true, canvas_id: 'F0PLACEHOLD1', canvas_url: 'https://example.slack.com/docs/T0PLACE/F0PLACEHOLD1' }))).toEqual({ externalId: 'F0PLACEHOLD1', link: 'https://example.slack.com/docs/T0PLACE/F0PLACEHOLD1' });
    expect(parseCanvasWrite('Canvas created: https://example.slack.com/docs/T0PLACE/F0PLACEHOLD2')).toEqual({ externalId: 'F0PLACEHOLD2', link: 'https://example.slack.com/docs/T0PLACE/F0PLACEHOLD2' });
  });
});

describe('delivery', () => {
  const confirmFor = (payload: Record<string, unknown>) => confirmDelivery({ draftId: 'd1', draftVersion: 1, mode: 'send', payloadHash: payloadHash(payload), confirmToken: 't', expectedToken: 't', at: AT });

  it('dry run: the exact create call is recorded and nothing is touched', async () => {
    const touched: ToolCall[] = [];
    const engine = new OutboxDelivery({ gateway: new OutboxGateway({ callTool: async (c) => (touched.push(c), { text: '{}' }) }), now: () => new Date(AT) });
    const payload = payloadFor(dest, EMPTY, 'send');
    const confirmation = confirmFor(payload);
    const rec = await engine.deliver(engine.prepare({ draftId: 'd1', draftVersion: 1, destination: dest, mode: 'send', payload, dryRun: true, attemptNo: 1, confirmation }), confirmation);
    expect(rec).toMatchObject({ state: 'dry_run_delivered', channel: 'slack_canvas', toolCall: { server: 'slack', tool: 'slack_create_canvas' } });
    expect(touched).toEqual([]);
  });

  it('live Apply: only through the gateway, then read back with slack_read_canvas', async () => {
    const sim = new SimulatedOutboxTransport(() => new Date(AT));
    const engine = new OutboxDelivery({ gateway: new OutboxGateway(sim), now: () => new Date(AT), isDryRun: () => false });
    const payload = payloadFor(dest, EMPTY, 'send');
    const confirmation = confirmFor(payload);
    const rec = await engine.deliver(engine.prepare({ draftId: 'd1', draftVersion: 1, destination: dest, mode: 'send', payload, dryRun: false, attemptNo: 1, confirmation }), confirmation);
    expect(rec).toMatchObject({ state: 'delivered', readback: 'confirmed', result: { externalId: expect.stringMatching(/^FSIM/) } });
    expect(sim.calls.map((c) => c.tool)).toEqual(['slack_create_canvas', 'slack_read_canvas']);
  });
});

describe('the canvas relay and the live transport', () => {
  it('carries only slack_create_canvas and slack_read_canvas; a message send never reaches it', async () => {
    expect([...CANVAS_RELAY_TOOLS].sort()).toEqual(['slack_create_canvas', 'slack_read_canvas']);
    const ran: string[] = [];
    const relay = slackCanvasRelay({ server: () => ({ slack: { type: 'http', url: 'https://mcp.example.test' } }), run: async (c) => (ran.push(c.fullTool), { text: '{"canvas_id":"F0PLACEHOLD3"}', code: 'ok', message: '', costUsd: 0, inputTokens: 0, outputTokens: 0, model: 'm', started: true }) });
    await expect(relay.callTool({ server: 'slack', tool: 'slack_send_message', args: {} })).rejects.toThrow(/carries/);
    await expect(relay.callTool({ server: 'slack', tool: 'slack_update_canvas', args: {} })).rejects.toThrow(/carries/);
    await expect(relay.callTool({ server: 'slack', tool: 'slack_create_canvas', args: { title: 't', content: 'c' } })).resolves.toEqual({ text: '{"canvas_id":"F0PLACEHOLD3"}' });
    expect(ran).toEqual(['mcp__slack__slack_create_canvas']);
    const t = liveOutboxTransport({ vdp: null, canvas: relay });
    await expect(t.callTool({ server: 'slack', tool: 'slack_send_message', args: {} })).rejects.toBeInstanceOf(OutboxLiveDisabledError);
    await expect(t.callTool({ server: 'slack', tool: 'slack_create_canvas', args: { title: 't', content: 'c' } })).resolves.toMatchObject({ text: expect.stringContaining('F0PLACEHOLD3') });
  });

  it('a relay that could not run is an error, not a silent success', async () => {
    const relay = slackCanvasRelay({ server: () => ({}), run: async () => ({ text: null, code: 'timeout', message: '', costUsd: 0, inputTokens: 0, outputTokens: 0, model: 'm', started: true }) });
    await expect(relay.callTool({ server: 'slack', tool: 'slack_create_canvas', args: { title: 't', content: 'c' } })).rejects.toThrow(/timed out/);
  });

  it('2026-11-16: a timeout before Slack was called is "not sent"; after it, the tool error (it may have landed)', async () => {
    const before = slackCanvasRelay({ server: () => ({}), run: async () => ({ text: null, code: 'timeout', message: '', costUsd: 0, inputTokens: 0, outputTokens: 0, model: 'm', started: true, called: false }) });
    const e1 = await before.callTool({ server: 'slack', tool: 'slack_create_canvas', args: { title: 't', content: 'c' } }).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(RelayNotSentError);
    expect(classifyDeliveryError(e1)).toEqual({ code: 'not_sent', message: 'Nothing was sent: the app stopped before it reached the destination. Try again', retryable: true });
    const after = slackCanvasRelay({ server: () => ({}), run: async () => ({ text: null, code: 'timeout', message: '', costUsd: 0, inputTokens: 0, outputTokens: 0, model: 'm', started: true, called: true }) });
    const e2 = await after.callTool({ server: 'slack', tool: 'slack_create_canvas', args: { title: 't', content: 'c' } }).catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(ToolCallError);
    expect(classifyDeliveryError(e2).code).toBe('transient');
  });
});

describe('mock DataSource: Log to Slackbot → Outbox items → Apply', () => {
  const seed = Seed.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../src/mock/seed.example.json'), 'utf8')));
  let ds: MockDataSource;
  let sim: SimulatedOutboxTransport;
  beforeEach(() => {
    ds = new MockDataSource({ seed: structuredClone(seed), delays: { enrichMs: 5, stepMs: 5, chatTokenMs: 0, verifyMs: 5, reevalMs: 5 }, autoplay: false, clockMode: 'seed' });
    sim = new SimulatedOutboxTransport();
    ds.outbox.useTransport(sim);
  });
  afterEach(() => ds.dispose());
  async function call<K extends RouteKey>(key: K, input: unknown): Promise<RouteOutput<K>> {
    const out = await (ds[key as keyof MockDataSource] as (i: unknown) => Promise<unknown>).call(ds, input);
    const r = routes[key].response.safeParse(out);
    if (!r.success) throw new Error(`${key} response failed the contract: ${JSON.stringify(r.error.issues.slice(0, 3))}`);
    return out as RouteOutput<K>;
  }

  it('stages ready Outbox items, approves the complete proposed rows, and lists rows that need input', async () => {
    const r = await call('stageLogBatch', { body: { includeProposed: true } });
    expect(r.entity.draftIds.length).toBeGreaterThan(0);
    expect(r.entity.events).toBeGreaterThan(0);
    const outbox = await call('getOutbox', {});
    // D-52: canvases are admin items, applied on Time: in `admin`, not in the Outbox's message groups
    expect(outbox.groups.flatMap((g) => g.items).some((i) => r.entity.draftIds.includes(i.draft.id))).toBe(false);
    const item = outbox.admin.items.map((i) => i.draft).find((d) => d.id === r.entity.draftIds[0])!;
    const today = await call('getToday', {});
    expect(today.navCounts.adminWaiting).toBe(outbox.admin.pending + outbox.admin.failed);
    expect(today.navCounts.outbox).toBe((outbox.counts.pending_approval ?? 0) + (outbox.counts.failed ?? 0));
    expect(item.destination).toMatchObject({ kind: 'action', action: 'slack_canvas.create' });
    expect(item.destination.kind === 'action' && item.destination.text).toContain('Slackbot: this canvas is a complete work order');
    expect(r.entity.skipped.every((s) => /needs/.test(s.why))).toBe(true);
  });

  it('a second click stages nothing: the rows wait in the first item (marked on read) until it is Applied or rejected', async () => {
    const topics: string[] = [];
    const off = ds.bus.subscribe((e) => void topics.push(e.topic));
    const r = await call('stageLogBatch', { body: { includeProposed: true } });
    // a draft write refreshes Time too: the rows it holds read as waiting in the Outbox
    expect(topics).toContain('time');
    const id = r.entity.draftIds[0]!;
    const log = await call('getActivityLog', { query: {} });
    const held = log.entries.filter((e) => e.canvasDraftId);
    expect(held.length).toBe(r.entity.events);
    expect(new Set(held.map((e) => e.canvasDraftId))).toEqual(new Set(r.entity.draftIds));
    const week = await call('getTime', { query: {} });
    expect(week.entries.filter((e) => e.canvasDraftId).every((e) => r.entity.draftIds.includes(e.canvasDraftId!))).toBe(true);
    const twice = await call('stageLogBatch', { body: { includeProposed: true } });
    expect(twice.entity.draftIds).toEqual([]);
    expect(twice.entity.waiting).toMatchObject({ rows: r.entity.events, draftIds: r.entity.draftIds });
    // rejecting the item lets its rows go: the next batch takes them again
    topics.length = 0;
    for (const d of r.entity.draftIds) {
      const cur = (await call('getOutbox', {})).admin.items.find((i) => i.draft.id === d)!.draft;
      await call('rejectDraft', { params: { id: d }, body: { ifVersion: cur.version } });
    }
    expect(topics).toContain('time');
    off();
    expect((await call('getActivityLog', { query: {} })).entries.some((e) => e.canvasDraftId)).toBe(false);
    const third = await call('stageLogBatch', { body: { includeProposed: true } });
    expect(third.entity.events).toBe(r.entity.events);
    expect(third.entity.draftIds).not.toContain(id);
  });

  it('dry run creates nothing and leaves the rows approved; a live Apply creates the canvas and hands the rows off', async () => {
    const r = await call('stageLogBatch', { body: { includeProposed: true } });
    const id = r.entity.draftIds[0]!;
    const preview = await call('previewDraft', { params: { id }, body: { mode: 'send' } });
    expect(preview.payload).toMatchObject({ tool: 'slack_create_canvas' });
    const dry = await call('dispatchDraft', { params: { id }, body: { ifVersion: preview.version, mode: 'send', confirmToken: preview.confirmToken } });
    expect(dry.dryRun).toBe(true);
    expect(sim.calls).toEqual([]);
    const rowIds = (dry.draft.destination.kind === 'action' ? (dry.draft.destination.input.eventIds as string[]) : []).slice(0, 3);
    const s0 = await ds.getSettings({} as never);
    await ds.patchSettings({ params: { section: 'sending' }, body: { ifVersion: s0.sending.version, value: { dryRun: false }, confirm: true } } as never);
    const p2 = await call('previewDraft', { params: { id }, body: { mode: 'send' } });
    const live = await call('dispatchDraft', { params: { id }, body: { ifVersion: p2.version, mode: 'send', confirmToken: p2.confirmToken } });
    expect(live.dryRun).toBe(false);
    expect(sim.calls[0]).toMatchObject({ server: 'slack', tool: 'slack_create_canvas' });
    const week = await ds.getActivityLog({ query: {} } as never);
    for (const rid of rowIds) expect(week.entries.find((e) => e.id === rid)?.status).toBe('synced_to_canvas');
  });
});
