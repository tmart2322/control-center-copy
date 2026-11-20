#!/usr/bin/env node
// Nightly pg_dump into ~/Library/Application Support/control-center/backups/, keeping the newest 7 (D-7).
//   npm run backup [-- --db control_center] [-- --dir <path>] [-- --keep 7] [-- --if-due]
// --if-due: skip when a backup newer than 24 h exists (the worker calls this on schedule and after downtime).
// The copy folder (CC_BACKUP_COPY_DIR in the env file) gets a copy too; a cloud-synced folder is refused (README).
import { backupCopyDir, backupDue, configuredDbName, DEFAULT_KEEP, defaultBackupDir, runBackup } from './lib/backup.mjs';

const argv = process.argv.slice(2);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const db = val('--db', configuredDbName());
const dir = val('--dir', defaultBackupDir());
const keep = Number(val('--keep', String(DEFAULT_KEEP)));

try {
  if (argv.includes('--if-due') && !backupDue(dir, db)) {
    console.log('A backup newer than 24 h exists; nothing to do.');
    process.exit(0);
  }
  const r = await runBackup({ db, dir, keep });
  console.log(`backup written: ${r.file} (${(r.bytes / 1024).toFixed(0)} KB)${r.pruned.length ? `; pruned ${r.pruned.length} old` : ''}`);
  if (r.copy?.file) console.log(`copied to: ${r.copy.file}`);
  else if (r.copy?.error === 'refused_cloud_synced') console.log(`not copied: ${backupCopyDir().refused} (CC_BACKUP_COPY_DIR); use an external disk or another local folder`);
  else if (r.copy?.error) console.log(`copy failed (${r.copy.error}): is ${r.copy.dir} there and writable?`);
} catch (e) {
  console.error(`backup failed: ${String(e.stderr ?? e.message).split('\n')[0]}`);
  process.exit(1);
}
