/**
 * Reproduce one scanner window in isolation (fresh scenario DB, live Haiku) and print the run outcomes, e.g. to see
 * why a window keeps ending without cc_finish. Private output only (terminal).
 *   npx tsx scripts/stress/diag-run.ts <connector> <scope> <fromLocal YYYY-MM-DDTHH:MM> <toLocal> [nowLocal]
 */
import { sql } from 'drizzle-orm';

import type { ConnectorId } from '../../src/scanner/types';

import { World } from './driver/world';
import { loadProfile } from './lib/profile';
import { localToUtc } from './lib/time';

const loc = (x: string) => localToUtc(x.slice(0, 10), x.slice(11, 16)).toISOString();

async function main() {
  const [connector, scope, from, to, now] = process.argv.slice(2) as [ConnectorId, string, string, string, string | undefined];
  const w = new World({ scenario: `diag-${connector}`, start: loc(now ?? to), sources: [connector], runner: 'live', profile: loadProfile(), log: (m) => console.log(m) });
  await w.init();
  await w.boot();
  await w.shutdown('diag: no scheduled polls');
  const out = await w.scanning.scanner.runScope({ connector, scope }, 'manual', { from: loc(from), to: loc(to) });
  for (const o of out) console.log(JSON.stringify({ status: o.status, detail: o.detail, cost: o.costUsd }));
  const r = await w.handle.db.execute<{ status: string; n: number; err: string | null }>(sql`select status::text, items_seen as n, error_message as err from scan_runs order by started_at`);
  for (const x of r.rows) console.log(`${x.status} items=${x.n} ${x.err ?? ''}`);
  console.log(`cost $${w.costUsd.toFixed(4)}`);
  await w.close();
}

main().catch((e) => {
  console.error((e as Error).stack);
  process.exit(1);
});
