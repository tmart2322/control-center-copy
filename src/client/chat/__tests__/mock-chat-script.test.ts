/**
 * The scripted mock responder (src/mock/chat-script.ts): every demo prompt streams contract-valid events,
 * and every receipt line is a real change that POST /audit/:id/undo reverts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatSseEvent, Seed, type Receipt } from '@/contract';
import { MockDataSource } from '@/server/datasource/mock';
import { pickChatScript } from '@/mock/chat-script';

const seed = Seed.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../../mock/seed.example.json'), 'utf8')));
const fast = { enrichMs: 5, stepMs: 5, chatTokenMs: 0, verifyMs: 5, reevalMs: 5 };
type G = { __ccDataSource?: unknown };

let ds: MockDataSource;
beforeEach(() => {
  ds = new MockDataSource({ seed: structuredClone(seed), delays: fast, autoplay: false, clockMode: 'seed' });
  (globalThis as G).__ccDataSource = ds; // what getDataSource() does in the running app
});
afterEach(() => {
  delete (globalThis as G).__ccDataSource;
  ds.dispose();
});

async function ask(text: string, context: { type: string; id: string; label: string }[] = []) {
  const events: ChatSseEvent[] = [];
  for await (const ev of ds.chat({ body: { text, context }, signal: new AbortController().signal })) {
    const r = ChatSseEvent.safeParse(ev);
    expect(r.success, JSON.stringify(ev)).toBe(true);
    events.push(ev);
  }
  return events;
}
const of = <T extends ChatSseEvent['type']>(evs: ChatSseEvent[], t: T) => evs.filter((e): e is Extract<ChatSseEvent, { type: T }> => e.type === t);
const textOf = (evs: ChatSseEvent[]) => of(evs, 'text-delta').map((e) => e.delta).join('');

describe('mock chat script demos', () => {
  it('routes the demo prompts to their scripts (loose keyword matching)', () => {
    const ctx = { text: '', context: [], threadId: 't', now: new Date(), ops: {} as never };
    const id = (t: string) => pickChatScript(t, { ...ctx, text: t }).id;
    expect(id('move Globex prep after lunch and find the deck I made for them')).toBe('move-after-lunch');
    expect(id('Push the Initech prep until after lunch')).toBe('move-after-lunch');
    expect(id('why is the ACME build first?')).toBe('why');
    expect(id('/why')).toBe('why');
    expect(id('prioritize customer-facing over internal today')).toBe('prioritize-customer');
    expect(id('/rescan slack 2d')).toBe('rescan');
    expect(id('what did I promise Ravi?')).toBe('promises');
    expect(id('/error')).toBe('error');
    expect(id('/log last meeting')).toBe('log');
    expect(id('/capture Send Dana the SSO doc')).toBe('capture');
    // existing W0 demos keep their routes
    expect(id('do the Initech prep first')).toBe('reprioritize');
    expect(id('find the ACME deck')).toBe('find');
    expect(id('customer work matters more, change my policy')).toBe('policy');
    expect(id('good morning')).toBe('default');
  });

  it('"move Globex prep after lunch and find the deck…" → 2 undoable changes + a resource', async () => {
    const evs = await ask('move Globex prep after lunch and find the deck I made for them');
    expect(evs.at(-1)?.type).toBe('done');
    const [receipt] = of(evs, 'receipt').map((e) => e.receipt);
    expect(receipt.changes).toHaveLength(2);
    const [start, note] = receipt.changes;
    expect(start.field).toBe('startBy');
    expect(note.field).toBe('notes');
    expect(start.auditId).not.toBe(note.auditId);
    const itemId = start.entity.id;
    expect((await ds.getItem({ params: { id: itemId } })).item.refs.account?.label).toBe('Globex');
    expect(of(evs, 'resource').some((r) => r.resource.kind === 'asset')).toBe(true);
    expect(textOf(evs)).toMatch(/Globex/);

    // per-line undo: the start time reverts, the note stays
    await ds.undoAudit({ params: { id: start.auditId }, body: {} });
    let item = (await ds.getItem({ params: { id: itemId } })).item;
    expect(item.startBy).toBe(start.before);
    expect(item.notes).toContain('after-lunch block');
    await ds.undoAudit({ params: { id: note.auditId }, body: {} });
    item = (await ds.getItem({ params: { id: itemId } })).item;
    expect(item.notes).not.toContain('after-lunch block');
  });

  it('"why is the ACME build first?" cites the policy and the calendar, changes nothing', async () => {
    const evs = await ask('why is the ACME build first?');
    expect(of(evs, 'receipt')).toHaveLength(0);
    expect(of(evs, 'tool-start').map((t) => t.name)).toEqual(['priority.explain', 'policy.read', 'calendar.today']);
    const kinds = of(evs, 'resource').map((r) => r.resource.kind);
    expect(kinds).toContain('policy');
    expect(kinds).toContain('calendar_event');
    expect(textOf(evs)).toMatch(/ACME.*build/i);
    expect(textOf(evs)).toMatch(/policy \(v\d+\)/);
  });

  it('"prioritize customer-facing over internal today" → a policy proposal that Apply commits and Undo reverts', async () => {
    const before = (await ds.getSettings({} as never)).policy;
    const evs = await ask('prioritize customer-facing over internal today');
    const [p] = of(evs, 'proposal');
    expect(p.proposal.entity.type).toBe('policy');
    expect((await ds.getSettings({} as never)).policy.version).toBe(before.version); // staged only
    const applied = await ds.applyProposal({ params: { id: p.id }, body: {} });
    const after = (await ds.getSettings({} as never)).policy;
    expect(after.version).toBe(before.version + 1);
    expect(after.weights.customer_facing).toBe(before.weights.customer_facing + 3);
    await ds.undoAudit({ params: { id: applied.auditId! }, body: {} });
    expect((await ds.getSettings({} as never)).policy.weights.customer_facing).toBe(before.weights.customer_facing);
  });

  it('"/rescan slack 2d" → tool rows, then a receipt whose lines undo', async () => {
    const evs = await ask('/rescan slack 2d');
    const tools = of(evs, 'tool-start').map((t) => t.name);
    expect(tools[0]).toBe('slack.scan');
    expect(tools).toContain('linker.match');
    const receipt = of(evs, 'receipt')[0]?.receipt as Receipt;
    expect(receipt.changes.length).toBeGreaterThan(0);
    const firstTool = evs.findIndex((e) => e.type === 'tool-start');
    const receiptAt = evs.findIndex((e) => e.type === 'receipt');
    expect(firstTool).toBeLessThan(receiptAt);
    const c = receipt.changes[0];
    await ds.undoAudit({ params: { id: c.auditId }, body: {} });
    expect((await ds.getItem({ params: { id: c.entity.id } })).item.notes).toBe(c.before ?? '');
  });

  it('"what did I promise Ravi?" → a resource to the background promise', async () => {
    const evs = await ask('what did I promise Ravi?');
    const res = of(evs, 'resource').map((r) => r.resource);
    expect(res[0]).toMatchObject({ kind: 'work_item', id: 'w_promise_beacon' });
    expect(textOf(evs)).toMatch(/Ravi/);
  });

  it('"/error" streams tool rows then exactly one error, no done', async () => {
    const evs = await ask('/error');
    expect(evs.at(-1)?.type).toBe('error');
    expect(of(evs, 'done')).toHaveLength(0);
    expect(of(evs, 'tool-result')[0].ok).toBe(false);
  });

  it('writes only through ctx.ops: the store the chat runs on, never the process DataSource (CONTRACT-1)', async () => {
    const other = new MockDataSource({ seed: structuredClone(seed), delays: fast, autoplay: false, clockMode: 'seed' });
    (globalThis as G).__ccDataSource = other; // identical data, different store
    const evs = await ask('move Globex prep after lunch');
    const receipt = of(evs, 'receipt')[0].receipt;
    expect(receipt.changes.map((c) => c.field)).toEqual(['startBy']);
    const id = receipt.changes[0].entity.id;
    expect((await ds.getItem({ params: { id } })).item.startBy).toBe(receipt.changes[0].after);
    expect((await other.getItem({ params: { id } })).item.startBy).toBe(receipt.changes[0].before);
    other.dispose();
  });
});
