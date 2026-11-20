/**
 * Time ▸ Ledger (GET /time/ledger) on the mock DataSource: the placeholder seed plus a quarter of history
 * (tests/fixtures/activity-history.ts). The current quarter is the default; its live rows add up by the one count map
 * (in Org62, on its way, suggested, needs input, not in Org62 after all) and its seeded earlier hours stay out of the
 * breakdowns; accounts carry their opportunities (and their rows with none); internal work and rows with no account are
 * lines of their own; every line's rows are GET /time/log with the same filters (the drill-down); weeks are Monday
 * first, clipped to the quarter; a past quarter and every quarter work too. Human hours only. Placeholders only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TimeLedger, type ActivityLogQuery } from '../../src/contract';
import { lineFilters, type LedgerLine } from '../../src/components/time/ledger-derive';
import { createMockDataSource, type MockDataSource } from '../../src/server/datasource/mock';
import { withActivityHistory, type ActivityHistory } from '../fixtures/activity-history';

let ds: MockDataSource;
let H: ActivityHistory;

beforeEach(() => {
  const base = createMockDataSource({ autoplay: false });
  H = withActivityHistory(base.loaded.seed);
  base.dispose();
  ds = createMockDataSource({ seed: H.seed, autoplay: false, delays: { enrichMs: 1e8, reevalMs: 1e8, stepMs: 1e8, verifyMs: 1e8 } });
  ds.clock.freeze(new Date(H.seed.meta.asOf));
  ds.resetStore();
});
afterEach(() => ds.dispose());

const ledger = async (quarter?: string) => TimeLedger.parse(await ds.getTimeLedger({ query: quarter ? { quarter } : {} } as never));
const r2 = (n: number) => Math.round(n * 100) / 100;

describe('GET /time/ledger', () => {
  it('defaults to the current quarter; its live rows add up by the one count map, earlier hours kept apart', async () => {
    const l = await ledger();
    expect(l.quarter).toBe(H.cur.label);
    expect([l.from, l.to]).toEqual([H.cur.start, H.cur.end]);
    const t = l.totals;
    expect(r2(t.loggedH + t.approvedH + t.proposedH + t.needsInputH + t.missingH)).toBe(t.hours);
    expect(t.rows).toBe(t.hours > 0 ? H.seed.activity.filter((e) => e.date >= H.cur.start && e.date <= H.cur.end && e.status !== 'dismissed' && e.status !== 'upcoming').length : 0);
    // the seed's base hours: in the quarter's own number, never in a breakdown
    const q = l.quarters.find((x) => x.current)!;
    expect(t.earlierH).toBe(H.seed.meta.quarter.loggedH);
    expect(q.loggedH).toBe(r2(t.loggedH + t.earlierH));
    expect(t.excludedRows).toBeGreaterThan(0);
    // shares cover every hour once
    expect(r2(l.accounts.reduce((s, a) => s + a.share, 0) + l.internal.share + l.unassigned.share)).toBeCloseTo(1, 2);
    expect(r2(l.types.reduce((s, x) => s + x.share, 0))).toBeCloseTo(1, 2);
  });

  it('accounts carry their opportunities (most hours first, their rows with none last); internal work is its own line', async () => {
    const l = await ledger();
    const hours = l.accounts.map((a) => a.hours);
    expect(hours).toEqual([...hours].sort((a, b) => b - a));
    for (const a of l.accounts) expect(r2(a.opps.reduce((s, o) => s + o.hours, 0))).toBe(a.hours);
    // an account with an opportunity and rows with none: the none line is last, named so
    const mixed = l.accounts.find((a) => a.opps.some((o) => o.oppId === null) && a.opps.some((o) => o.oppId !== null));
    expect(mixed, 'the seed has an account with a no-opp row').toBeTruthy();
    expect(mixed!.opps.at(-1)).toMatchObject({ oppId: null, name: 'No opportunity' });
    // D-64: internal-only rows are never under an account
    const internal = H.seed.activity.filter((e) => e.internal && e.date >= H.cur.start && e.status !== 'dismissed' && e.status !== 'upcoming');
    expect(l.internal).toMatchObject({ rows: internal.length, hours: r2(internal.reduce((s, e) => s + e.durationH, 0)) });
    // no type is the last type line
    expect(l.types.at(-1)?.type ?? null).toBeNull();
  });

  it('every line’s rows are GET /time/log with the same filters: the drill-down says the same hours', async () => {
    const l = await ledger();
    const live = async (f: ReturnType<typeof lineFilters>) => {
      const query: ActivityLogQuery = { from: l.from!, to: l.to! };
      if (f.account) query.account = f.account;
      if (f.opp) query.opp = f.opp;
      if (f.type) query.type = f.type;
      const log = await ds.getActivityLog({ query } as never);
      return log.total.hours;
    };
    const lines: Array<[LedgerLine, number]> = [];
    for (const a of l.accounts) {
      lines.push([{ kind: 'account', account: a.name }, a.hours]);
      for (const o of a.opps) lines.push([{ kind: 'opp', account: a.name, oppId: o.oppId }, o.hours]);
    }
    lines.push([{ kind: 'internal' }, l.internal.hours], [{ kind: 'unassigned' }, l.unassigned.hours]);
    for (const x of l.types) lines.push([{ kind: 'type', type: x.type }, x.hours]);
    for (const [line, hours] of lines) expect(await live(lineFilters(line)), JSON.stringify(line)).toBe(hours);
  });

  it('weeks are Monday first, clipped to the quarter, the empty ones too; they add up to the quarter', async () => {
    const l = await ledger();
    expect(l.periods.kind).toBe('week');
    const w = l.periods.items;
    expect(w[0]!.start).toBe(H.cur.start);
    expect(w.at(-1)!.end).toBe(H.cur.end);
    for (const p of w.slice(1)) expect(new Date(`${p.key}T12:00:00Z`).getUTCDay()).toBe(1);
    expect(r2(w.reduce((s, p) => s + p.hours, 0))).toBe(l.totals.hours);
    expect(w.some((p) => p.rows === 0)).toBe(true);
  });

  it('a past quarter: its own totals (no earlier hours), what Org62 has, excluded rows apart, its accounts', async () => {
    const l = await ledger(H.prev.label);
    expect([l.quarter, l.from, l.to]).toEqual([H.prev.label, H.prev.start, H.prev.end]);
    expect(l.totals).toMatchObject({ loggedH: H.prevLoggedH, verifiedH: 1, earlierH: 0, excludedRows: 1, excludedH: 1, rows: 3 });
    expect(l.quarters.find((q) => q.label === H.prev.label)?.loggedH).toBe(H.prevLoggedH);
    expect(l.accounts.map((a) => [a.name, a.hours, a.loggedH])).toEqual([
      [H.account, 3, 3],
      ['ACCOUNT_HISTORY', 1.5, 1.5],
    ]);
    expect(l.accounts[0]!.opps.map((o) => o.oppId)).toEqual([H.oppId]);
  });

  it('every quarter: one column per quarter, oldest first; a quarter with no rows is still asked for by its label', async () => {
    const all = await ledger('all');
    expect([all.quarter, all.from, all.to, all.periods.kind]).toEqual(['all', null, null, 'quarter']);
    expect(all.periods.items.map((p) => p.key)).toEqual([H.prev.label, H.cur.label]);
    const cur = await ledger();
    const prev = await ledger(H.prev.label);
    expect(all.totals.hours).toBe(r2(cur.totals.hours + prev.totals.hours));
    const empty = await ledger('Q1 FY26');
    expect(empty).toMatchObject({ quarter: 'Q1 FY26', from: '2025-02-01', to: '2025-04-30', totals: { rows: 0, hours: 0 }, accounts: [] });
    expect(empty.periods.items.every((p) => p.rows === 0)).toBe(true);
  });
});
