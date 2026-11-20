/**
 * Read parity: every read method of the DataSource on the mock and on Postgres, same seed, same clock.
 * Each response validates against the route's contract schema and is equivalent after the documented
 * normalizations (normalize.ts N1–N4); per-method differences are listed in DIFFERENCES.md.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RouteKey } from '../../src/contract';
import type { DbHandle } from '../../src/db/client';
import { DbDataSource } from '../../src/server/datasource/db';
import { interimRanker } from '../../src/server/datasource/db/rank';
import { loadBoth, openTestDb, type Loaded } from './helpers';
import { BE1B } from './helpers';
import { both, byId, dropKeys, sortAt, workOrder, type ParityOptions } from './parity';

let handle: DbHandle;
let L: Loaded;
let db: DbDataSource;

beforeAll(async () => {
  if (!BE1B) return;
  handle = openTestDb();
  L = await loadBoth(handle);
  // D-RANK: parity ranks with the mock's scorer on both sides; ENGINES-core (the default) is tested in tests/integrate1
  db = new DbDataSource({ handle, userId: L.userId, clock: { now: () => L.now }, ranker: interimRanker });
});
afterAll(async () => {
  if (!BE1B) return;
  L?.mock.dispose();
  await db?.dispose();
  await handle?.close();
});

const S = () => L.seed;
const firstItem = (pred: (w: Loaded['seed']['workItems'][number]) => boolean) => S().workItems.find(pred)!.id;

/** Home row ids embed an entity id after a prefix ("gap:connector:<id>", "ini:<id>"); translate the tail on the mock side. */
function homeIds(v: unknown, side: 'mock' | 'db'): unknown {
  if (side === 'db') return v;
  const tr = (id: string) => id.replace(/^((?:gap:connector|ini):)(.+)$/, (_m, p: string, tail: string) => p + (L.idMap.get(tail) ?? tail));
  const walk = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, k === 'id' && typeof y === 'string' ? tr(y) : walk(y)])) : x;
  return walk(v);
}

/** Read calls: [route, input, options]. Inputs use seed ids; the harness translates them for the db side. */
const READS: [RouteKey, () => Record<string, unknown>, ParityOptions?][] = [
  ['getToday', () => ({})],
  ['getHome', () => ({ query: {} }), { shape: homeIds }],
  ['getHome', () => ({ query: { wide: '1' } }), { shape: homeIds }],
  // planning the next working day: the same day, capacity and carried work on both sides
  ['getHome', () => ({ query: { day: 'next' } }), { shape: homeIds }],
  ['listItems', () => ({ query: {} }), { shape: sortAt(['items'], workOrder) }],
  ['listItems', () => ({ query: { tab: 'done' } })],
  ['listItems', () => ({ query: { tab: 'promises' } })],
  ['listItems', () => ({ query: { tab: 'snoozed' } })],
  ['listItems', () => ({ query: { tab: 'asked_of_me', q: 'a' } })],
  ['listItems', () => ({ query: { account: S().accounts[0]!.id } })],
  ['listItems', () => ({ query: { source: 'slack' } }), { shape: sortAt(['items'], workOrder) }],
  ['getItem', () => ({ params: { id: firstItem((w) => !!w.nbaId && !!w.initiativeId) } }), { shape: sortAt(['siblings'], byId) }],
  ['getItem', () => ({ params: { id: firstItem((w) => w.state === 'done') } }), { shape: sortAt(['siblings'], byId) }],
  ['getItemEvidence', () => ({ params: { id: S().evidence[0]!.workItemId } })],
  // a Slack snippet in mrkdwn: the same mention names on both sides (the people directory)
  ['getItemEvidence', () => ({ params: { id: 'w_dana_reply' } })],
  ['getItem', () => ({ params: { id: 'w_dana_reply' } }), { shape: sortAt(['siblings'], byId) }],
  ['getItemNba', () => ({ params: { id: firstItem((w) => !!w.nbaId) } })],
  ['getInitiative', () => ({ params: { id: S().initiatives[0]!.id } })],
  ['getDraft', () => ({ params: { id: S().drafts[0]!.id } })],
  ['previewDraft', () => ({ params: { id: S().drafts[0]!.id }, body: {} })],
  // the message a draft replies to (thread context + evidence on both sides; db reads the thread's source items too)
  ...(['dr_dana', 'dr_nudge_globex', 'dr_globex_sow', 'dr_sent_sso', 'dr_onepager', 'dr_priya', 'dr_chat_initech'] as const).map((id): [RouteKey, () => Record<string, unknown>] => ['getDraftSource', () => ({ params: { id } })]),
  ['getOutbox', () => ({})],
  ['getCalendar', () => ({ query: {} })],
  ['getAgents', () => ({})],
  ['getTools', () => ({})],
  ['getToolRun', () => ({ params: { id: S().toolRuns[0]!.id } })],
  ['getTime', () => ({ query: {} })],
  ['getDeals', () => ({})],
  ['getMissed', () => ({})],
  ['getAccount', () => ({ params: { accountId: S().accounts[0]!.id } }), { shape: (v) => sortAt(['runs'], byId)(sortAt(['items'], byId)(v)) }],
  ['getBriefs', () => ({})],
  ['listWatches', () => ({})],
  ['getTriage', () => ({})],
  ['getHealth', () => ({}), { shape: (v) => dropKeys(v, ['worker']) }],
  ['getScans', () => ({ query: {} })],
  ['getJobs', () => ({})],
  ['getEventLog', () => ({})],
  ['getSettings', () => ({})],
  ['previewPolicy', () => ({ body: {} })],
  ['previewPolicy', () => ({ body: { weights: { ...S().settings.policy.weights, customer_facing: 0, due_urgency: 10 } } })],
  ['getPolicyVersions', () => ({})],
  ['search', () => ({ query: { q: 'acme' } })],
  ['search', () => ({ query: { q: 'demo deck' } })],
  ['getSince', () => ({ query: {} })],
  ['listChatThreads', () => ({})],
  ['getChatThread', () => ({ params: { id: S().chatThreads[0]!.thread.id } })],
  // CONTRACT-1 additions
  ['getChatThread', () => ({ params: { id: S().chatThreads[S().chatThreads.length - 1]!.thread.id } })],
  ['getPeople', () => ({ query: {} })],
  ['getPeople', () => ({ query: { q: 'da' } })],
  ['getPeople', () => ({ query: { q: 'acme', limit: 5 } })],
  ['getPeople', () => ({ query: { slack: 'true' } })],
  ['getPeople', () => ({ query: { account: S().accounts[0]!.id } })],
  ['previewDraft', () => ({ params: { id: S().drafts[S().drafts.length - 1]!.id }, body: { mode: 'send' } })],
  // D-HIST: history `changes` come from audit row images (every column the change set wrote)
  ['getItemHistory', () => ({ params: { id: firstItem((w) => w.state === 'done' && w.doneBy === 'engine') } }), { shape: (v) => dropKeys(v, ['changes']) }],
  ['getBrief', () => ({ params: { id: S().briefs[0]!.id } })],
  // DB-UI: the reads the v2 pages and Details renderers make that the list above did not cover
  ['getCalendar', () => ({ query: wideWindow() })], // EventPanel: ±30 days, day-rounded
  ['getTime', () => ({ query: { week: isoDay(L.now.getTime() - 7 * 86_400_000) } })], // Time: the week before
  ['listItems', () => ({ query: { tab: 'all_open' } }), { shape: sortAt(['items'], workOrder) }], // EventPanel, Agents, Start in Claude
  ['listItems', () => ({ query: { tab: 'said_by_me' } }), { shape: sortAt(['items'], workOrder) }],
  ['listItems', () => ({ query: { tab: 'trainings' } }), { shape: sortAt(['items'], workOrder) }],
  ['getReadIn', () => ({ params: { type: 'work_item', id: S().workItems[0]!.id } })], // Details: the read-in section
  ['getReadIn', () => ({ params: { type: 'calendar_event', id: S().calendar.events[0]!.id } })],
  // MEETING-HOVER: the hover card and the meeting panel (agenda, organizer, answers, attachments, prep, names)
  ...['ev_acme_demo', 'ev_umbrella', 'ev_standup', 'ev_initech', 'ev_globex_pricing', 'ev_retro'].map((id): [RouteKey, () => Record<string, unknown>] => ['getCalendarEvent', () => ({ params: { id } })]),
  // jsonb sorts object keys, but these records are shown in key order: the Tools run form (manifest properties),
  // tool-run inputs (Tools rows, run panels) and NBA tool inputs (the NBA card)
  ['getTools', () => ({}), { shape: keyOrders }],
  ['getToolRun', () => ({ params: { id: S().toolRuns.find((t) => Object.keys(t.inputs).length > 1)!.id } }), { shape: keyOrders }],
  ['getItemNba', () => ({ params: { id: S().nbas.find((n) => Object.keys(n.toolInputs ?? {}).length > 2)!.workItemId } }), { shape: keyOrders }], // customer, name, eventId ≠ jsonb's name, eventId, customer
  // the Account page and panel list opps, initiatives, assets and briefs in payload order
  ...[1, 2, 3, 4].map((i): [RouteKey, () => Record<string, unknown>, ParityOptions] => ['getAccount', () => ({ params: { accountId: S().accounts[i]!.id } }), { shape: (v) => sortAt(['runs'], byId)(sortAt(['items'], byId)(v)) }]),
];

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function wideWindow(): { from: string; to: string } {
  const n = L.now;
  const day = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return { from: new Date(day - 30 * 86_400_000).toISOString(), to: new Date(day + 31 * 86_400_000 - 1).toISOString() };
}
/** Adds the key order of every `properties` / `inputs` / `toolInputs` object as an array (diffPaths compares objects by key only). */
function keyOrders(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(keyOrders);
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = keyOrders(x);
    if (['properties', 'inputs', 'toolInputs'].includes(k) && x && typeof x === 'object' && !Array.isArray(x)) out[`${k}KeyOrder`] = Object.keys(x);
  }
  return out;
}

describe.runIf(BE1B)('read parity: mock ↔ db on the same seed', () => {
  for (const [key, input, opts] of READS) {
    it(`${key} ${JSON.stringify(input.toString().slice(6, 80))}`, async () => {
      const r = await both(L, db, key, input(), opts);
      expect(r.diffs, r.diffs.join('\n')).toEqual([]);
    });
  }

  it('getDeals: the summary and pipeline by fiscal quarter are the same on both, and not empty', async () => {
    const r = await both(L, db, 'getDeals', {});
    expect(r.diffs, r.diffs.join('\n')).toEqual([]);
    const p = (r.raw.db as { pipeline: { basis: string; categoryBasis: string; amountField: { field: string }; summary: { open: { count: number } }; quarters: unknown[]; rows: Array<{ via: string }> } }).pipeline;
    expect(p).toMatchObject({ basis: 'team_or_dc', categoryBasis: 'forecast', amountField: { field: 'Opportunity.Amount' } });
    expect(p.quarters).toHaveLength(5);
    // the seed's team or DC opps only (the two swept ones are on my accounts but not mine)
    const mine = S().opps.filter((o) => o.isOpen && (o.isMine || o.dcAssigned)).length;
    expect(p.summary.open.count).toBe(mine);
    expect(p.rows.every((x) => x.via !== 'forecast')).toBe(true);
  });
});

/**
 * DB-UI: the same reads after every table's rows were rewritten in reverse order. An UPDATE moves a row to the
 * end of its heap, so a fresh database returns unordered SELECTs in insertion order only by accident; a seeded
 * database that has seen re-ranks and edits does not (the Account page listed Renewal before Expansion, and its
 * order changed after the next write). Every read must order explicitly.
 */
describe.runIf(BE1B)('read parity after rows move in the heap (updated in place, reverse order)', () => {
  let shuffled: DbDataSource;
  beforeAll(async () => {
    await reverseHeapOrder(handle);
    shuffled = new DbDataSource({ handle, userId: L.userId, clock: { now: () => L.now }, ranker: interimRanker });
  });
  afterAll(async () => {
    await shuffled?.dispose();
  });
  for (const [key, input, opts] of READS) {
    it(`${key} ${JSON.stringify(input.toString().slice(6, 80))}`, async () => {
      const r = await both(L, shuffled, key, input(), opts);
      expect(r.diffs, r.diffs.join('\n')).toEqual([]);
    });
  }
});

/** Rewrites every row of every app table, last row first (a no-op SET on the first column; triggers off for the session). */
async function reverseHeapOrder(h: DbHandle): Promise<void> {
  await h.db.execute(sql`
    DO $$
    DECLARE t record; r record;
    BEGIN
      PERFORM set_config('session_replication_role', 'replica', true);
      FOR t IN
        SELECT c.relname AS tbl, a.attname AS col
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = 1
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT LIKE '%drizzle%'
      LOOP
        FOR r IN EXECUTE format('SELECT ctid AS c FROM %I ORDER BY ctid DESC', t.tbl) LOOP
          EXECUTE format('UPDATE %I SET %I = %I WHERE ctid = $1', t.tbl, t.col, t.col) USING r.c;
        END LOOP;
      END LOOP;
    END $$;
  `);
}
