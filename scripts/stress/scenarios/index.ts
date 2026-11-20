/** Scenario registry. */
import { sql } from 'drizzle-orm';

import { catchUpOrder, CursorMonitor } from '../invariants';
import { localToUtc } from '../lib/time';

import { finish, makeWorld, type Scenario } from './common';
import { MECHANICS } from './mechanics';
import { ACCURACY } from './accuracy';
import { LIVE } from './live';

export const SCENARIOS: Record<string, Scenario> = {
  ...MECHANICS,
  ...ACCURACY,
  ...LIVE,
  smoke: {
    description: 'scripted runner, Slack inbox + Gmail + Calendar, cold start Mon 09:00, 3 h at live cadence',
    async run(ctx) {
      const w = await makeWorld(ctx, { scenario: 'smoke', start: localToUtc('2026-10-12', '09:00').toISOString(), sources: ['slack', 'gmail', 'calendar'], runner: 'scripted', channels: [] });
      await w.boot();
      const mon = new CursorMonitor();
      await w.runUntil(localToUtc('2026-10-12', '12:00').toISOString(), { onStep: async (x) => mon.observe(x.handle.db) });
      return finish(w, { coverageQuestion: { scope: 'slack:inbox', from: localToUtc('2026-10-12', '10:00').toISOString(), to: localToUtc('2026-10-12', '11:00').toISOString() } }, [], {}, mon);
    },
  },
  'done-smoke': {
    description: 'live Haiku, Slack inbox only, cold start Wed 10:00 with the CMP-1 completion pass + reevaluate on: the pass sees the items',
    async run(ctx) {
      const w = await makeWorld(ctx, { scenario: 'done-smoke', start: localToUtc('2026-11-04', '10:00').toISOString(), sources: ['slack'], runner: 'live', channels: [], completion: true });
      await w.boot();
      const mon = new CursorMonitor();
      await w.runUntil(localToUtc('2026-11-04', '10:05').toISOString(), { onStep: async (x) => mon.observe(x.handle.db) });
      const r = await w.handle.db.execute<{ n: string; items: string | null; with_c: string | null; calls: string | null }>(sql`
        select count(*)::text as n, max((result->>'items')::int)::text as items, sum((result->>'withCandidates')::int)::text as with_c, sum((result->>'calls')::int)::text as calls
          from jobs where kind = 'completion.check' and status = 'succeeded'`);
      const x = r.rows[0]!;
      return finish(w, {}, [{ name: 'D1 completion checks saw open items', ok: Number(x.items ?? 0) > 0, detail: `checks=${x.n} maxItems=${x.items} withCandidates=${x.with_c} calls=${x.calls}` }], {}, mon);
    },
  },
  'live-smoke': {
    description: 'live Haiku, Slack inbox only, cold start Wed 10:00 (head + backfill of the 24 h lookback)',
    async run(ctx) {
      const w = await makeWorld(ctx, { scenario: 'live-smoke', start: localToUtc('2026-11-04', '10:00').toISOString(), sources: ['slack'], runner: 'live', channels: [] });
      await w.boot();
      const mon = new CursorMonitor();
      await w.runUntil(localToUtc('2026-11-04', '10:05').toISOString(), { onStep: async (x) => mon.observe(x.handle.db) });
      return finish(w, {}, [await catchUpOrder(w.handle.db, 'slack:inbox', '2026-01-01T00:00:00Z')], {}, mon);
    },
  },
};
