/**
 * Stress campaign CLI (private outputs only).
 *   npx tsx scripts/stress/cli.ts template            rebuild the migrated template DB
 *   npx tsx scripts/stress/cli.ts claude-index A B     index transcripts touched in [A, B]
 *   npx tsx scripts/stress/cli.ts spend               campaign spend so far
 */
import { buildTemplate } from './lib/db';
import { spendSummary } from './lib/ledger';
import { buildTranscriptIndex, writeTranscriptIndex } from './replay/claude';

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'template') {
    await buildTemplate();
    console.log('template ready');
  } else if (cmd === 'claude-index') {
    const ix = buildTranscriptIndex({ since: a ?? '2026-10-01', until: b ?? '2026-11-06', excludeDirs: /scanner-cwd/ });
    writeTranscriptIndex(ix);
    console.log(`indexed ${ix.files.length} transcripts, ${(ix.files.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(0)} MB`);
  } else if (cmd === 'spend') {
    console.log(JSON.stringify(spendSummary(), null, 1));
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
