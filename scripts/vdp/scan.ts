/**
 * `npm run vdp:scan` — one read of my VDPs into the mirror (vdp_records), the same fetcher and sink `scan.vdp` uses,
 * outside the worker. Reads only: search_vdps, get_vdp, get_use_case (VdpClient refuses anything else). Prints
 * counts and codes, never names, ids or values. `--dry` reads VDP but writes nothing. Needs a valid Okta cookie
 * (`python3 ~/.claude/scripts/refresh_vdp_fir_cookie.py`) and the corporate network. DATABASE_URL as the app.
 */
import { sql } from 'drizzle-orm';

import { VdpClient, VdpError } from '../../src/connectors/vdp/client';
import { VdpFetcher } from '../../src/connectors/vdp/fetcher';
import type { VdpMirrorBatch } from '../../src/lib/vdp/types';
import { computeVdpGaps } from '../../src/engines/vdp/gaps';
import { dbVdpSink, loadGapEntities } from '../../src/server/datasource/db/store/vdp';
import { has, main, open } from '../scan/lib';

main(async (argv) => {
  const dry = has(argv, '--dry');
  const { handle, db, userId, dbName } = await open();
  try {
    const me = await db.execute<{ email: string }>(sql`select email from users where id = ${userId}`);
    const aliases = (process.env.CC_ME_ALIASES ?? '').split(',').map((s) => s.trim()).filter((s) => s.includes('@'));
    const client = new VdpClient();
    const h = client.health();
    console.log(`[vdp:scan] db ${dbName} · VDP ${h.state}${h.detail ? ` (${h.detail.split(':')[0]})` : ''}${dry ? ' · dry (no writes)' : ''}`);
    const real = dbVdpSink(db, userId);
    let batch: VdpMirrorBatch | null = null;
    const sink = { known: () => real.known(), save: async (b: VdpMirrorBatch) => ((batch = b), dry ? { written: 0, removed: 0 } : real.save(b)) };
    const f = new VdpFetcher({ client, sink, myEmails: [me.rows[0]?.email ?? '', ...aliases].filter(Boolean) });
    const now = new Date();
    const t0 = Date.now();
    try {
      const r = await f.fetch('mine', null, { from: new Date(now.getTime() - 30 * 60_000).toISOString(), to: now.toISOString() }, { signal: new AbortController().signal });
      const b = batch as VdpMirrorBatch | null;
      const snaps = b?.snapshots ?? [];
      const ents = await loadGapEntities(db, userId);
      const gaps = computeVdpGaps({ vdps: snaps, accounts: ents.accounts, opps: ents.opps, me: { name: '', email: null }, vdpBaseUrl: null });
      const by = new Map<string, number>();
      for (const g of [...gaps.vdps.flatMap((v) => v.gaps), ...gaps.unlinked]) by.set(g.code, (by.get(g.code) ?? 0) + 1);
      console.log(`[vdp:scan] VDPs ${snaps.length} (complete ${b?.complete ?? false}) · use cases ${snaps.reduce((a, s) => a + s.useCases.length, 0)} (full detail ${snaps.reduce((a, s) => a + s.useCases.filter((u) => u.detailLoaded).length, 0)}) · stakeholders ${snaps.reduce((a, s) => a + s.stakeholders.length, 0)} · assets ${snaps.reduce((a, s) => a + s.assets.length, 0)} · linked to an opp ${gaps.vdps.filter((v) => v.opportunityId).length} · items ${r.items.length} · ${Date.now() - t0} ms`);
      console.log(`[vdp:scan] gaps ${gaps.counts.gaps} (app ${gaps.counts.appFixable}, handoff ${gaps.counts.handoffs}): ${[...by].map(([k, n]) => `${k}=${n}`).join(' ') || 'none'}`);
      if (!dry) {
        const n = await db.execute<{ n: number }>(sql`select count(*)::int as n from vdp_records where owner_user_id = ${userId} and gone_at is null`);
        console.log(`[vdp:scan] vdp_records (live) ${n.rows[0]?.n ?? 0}`);
      }
    } catch (e) {
      console.error(`[vdp:scan] failed: ${e instanceof VdpError ? e.message : (e as Error).name}`);
      return 1;
    }
  } finally {
    await handle.close();
  }
});
