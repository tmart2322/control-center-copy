#!/usr/bin/env node
// Restore a backup into a database. Safe by default: restores into a NEW database (control_center_restore),
// so you can inspect it before swapping.
//   npm run restore -- [file] [--into control_center_restore] [--replace]
//   file defaults to the newest backup.
// Replacing the live database: stop the agents first (node scripts/ops/uninstall-agents.mjs), then
//   npm run restore -- --into control_center --replace --yes
import { createInterface } from 'node:readline/promises';
import { DEFAULT_DB, defaultBackupDir, listBackups, runRestore } from './lib/backup.mjs';

const argv = process.argv.slice(2);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const db = process.env.CC_DB_NAME ?? DEFAULT_DB;
const positional = argv.find((a, i) => !a.startsWith('--') && !['--into'].includes(argv[i - 1]));
const file = positional ?? listBackups(defaultBackupDir(), db).at(-1)?.file;
const into = val('--into', `${db}_restore`);
const replace = argv.includes('--replace');

if (!file) {
  console.error('No backup found. Run: npm run backup');
  process.exit(1);
}
if (replace && into === db && !argv.includes('--yes')) {
  if (!process.stdin.isTTY) {
    console.error('Refusing to replace the live database without --yes.');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`This DROPS ${db} and restores ${file}. Agents must be stopped. Type "${db}" to continue: `);
  rl.close();
  if (a.trim() !== db) {
    console.log('Aborted.');
    process.exit(1);
  }
}
try {
  await runRestore({ file, into, replace });
  console.log(`restored ${file} into ${into}`);
} catch (e) {
  console.error(`restore failed: ${e.message}`);
  process.exit(1);
}
