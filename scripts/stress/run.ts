/**
 * Scenario runner. Each scenario gets its own DB (control_center_stress_<name>), state dir and artifacts under
 * <stress>/runs/<name>/ (private). Prints invariant results and counts only.
 *   npx tsx scripts/stress/run.ts <scenario> [--keep]
 */
import { SCENARIOS } from './scenarios';
import { privDir, writePriv } from './lib/paths';
import { spendSummary } from './lib/ledger';
import path from 'node:path';

async function main() {
  const name = process.argv[2];
  const s = SCENARIOS[name ?? ''];
  if (!s) {
    console.log(`scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(name ? 1 : 0);
  }
  const t0 = Date.now();
  const res = await s.run({ log: (m) => console.log(m) });
  const ms = Date.now() - t0;
  const dir = privDir('runs', name!);
  writePriv(path.join(dir, 'result.json'), JSON.stringify({ ...res, ms }, null, 1));
  const bad = res.invariants.filter((i) => !i.ok && !i.info);
  for (const i of res.invariants) console.log(`${i.ok ? 'PASS' : i.info ? 'INFO' : 'FAIL'} ${i.name}: ${i.detail}`);
  console.log(`checks: ${JSON.stringify(res.checks ?? {})}`);
  console.log(`replay: ${JSON.stringify(res.replay)}`);
  console.log(`scenario ${name}: ${bad.length ? `${bad.length} FAILED` : 'all invariants pass'} in ${(ms / 1000).toFixed(0)} s; cost $${res.costUsd.toFixed(4)}; campaign $${spendSummary().totalUsd.toFixed(2)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('scenario failed', e instanceof Error ? e.stack : e);
  process.exit(1);
});
