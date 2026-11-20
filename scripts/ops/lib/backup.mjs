// pg_dump backups with retention (D-7: nightly, keep 7) and restore. Always uses the PG17 binaries:
// the psql on PATH is v16 and a v16 pg_dump refuses a v17 server.
//
// Copy folder (audit 2026-11-13, lane E: E2): set CC_BACKUP_COPY_DIR in the env file (or the environment) and every
// backup is also written there, keeping the newest 7 too: an external disk or another local folder, so a lost or
// wiped Mac isn't the end of your data. A cloud-synced folder (iCloud Drive, OneDrive, Google Drive, Dropbox) is
// refused: it would take customer data off this Mac (tenet: Local data, privacy-safe logs).
import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { pg17Bin } from './brew.mjs';
import { readEnvFile } from './envfile.mjs';

const exec = promisify(execFile);
export const PG17_BIN = pg17Bin();
export const DEFAULT_DB = 'control_center';
export const DEFAULT_KEEP = 7;

/** @param {Record<string, string | undefined>} [env] */
const stateDirOf = (env = process.env) => env.CC_STATE_DIR ?? join(homedir(), 'Library', 'Application Support', 'control-center');
/** @param {Record<string, string | undefined>} [env] */
export const defaultBackupDir = (env = process.env) => join(stateDirOf(env), 'backups');

/**
 * A setting from the environment, else from the state folder's env file (scripts run from a shell don't load it).
 * @param {string} key
 * @param {Record<string, string | undefined>} [env]
 */
export function envSetting(key, env = process.env) {
  if (env[key] !== undefined) return env[key] || null;
  return readEnvFile(join(stateDirOf(env), 'env'))?.[key] || null;
}

/**
 * The database the services use: DATABASE_URL (environment, else env file), else CC_DB_NAME, else control_center.
 * @param {Record<string, string | undefined>} [env]
 */
export function configuredDbName(env = process.env) {
  const url = envSetting('DATABASE_URL', env);
  if (url) {
    try {
      const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
      if (name) return assertDbName(name);
    } catch {
      /* fall through */
    }
  }
  return env.CC_DB_NAME ?? DEFAULT_DB;
}

/** Folders a sync client uploads (iCloud Drive, File Provider clients such as OneDrive and Google Drive, Dropbox). */
export function cloudSyncedReason(dir, home = homedir()) {
  const p = resolve(dir);
  const under = (rel) => {
    const base = join(home, rel);
    return p === base || p.startsWith(`${base}/`);
  };
  if (under('Library/Mobile Documents')) return 'iCloud Drive';
  if (under('Library/CloudStorage')) return 'a cloud-synced folder (OneDrive, Google Drive, Dropbox, Box)';
  const top = p.startsWith(`${home}/`) ? p.slice(home.length + 1).split('/')[0] : '';
  if (/^OneDrive\b/.test(top)) return 'OneDrive';
  if (/^(Dropbox|Google Drive|Box|Box Sync|iCloud Drive)$/.test(top)) return top;
  return null;
}

/**
 * The copy folder (CC_BACKUP_COPY_DIR, `~/` expanded) or null when none is set. `refused` names why a set folder is
 * not used (a cloud-synced folder).
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [home]
 * @returns {{ dir: string | null, refused: string | null }}
 */
export function backupCopyDir(env = process.env, home = env.HOME ?? homedir()) {
  const raw = envSetting('CC_BACKUP_COPY_DIR', env);
  if (!raw) return { dir: null, refused: null };
  const dir = resolve(raw.replace(/^~(?=\/|$)/, home));
  const cloud = cloudSyncedReason(dir, home);
  return cloud ? { dir, refused: `${cloud} would take your data off this Mac` } : { dir, refused: null };
}

const SAFE_DB = /^[a-z_][a-z0-9_]{0,62}$/;
export function assertDbName(db) {
  if (!SAFE_DB.test(db)) throw new Error(`unsafe database name: ${JSON.stringify(db)}`);
  return db;
}

const pad = (n) => String(n).padStart(2, '0');
export function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
export const backupName = (db, d = new Date()) => `${assertDbName(db)}-${stamp(d)}.dump`;

export function listBackups(dir, db = DEFAULT_DB) {
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^${assertDbName(db)}-\\d{8}-\\d{6}\\.dump$`);
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .sort() // timestamped names sort chronologically
    .map((f) => ({ file: join(dir, f), name: f, bytes: statSync(join(dir, f)).size }));
}

/** Delete all but the newest `keep` backups for this database. Returns the removed names. */
export function pruneBackups(dir, db = DEFAULT_DB, keep = DEFAULT_KEEP) {
  const all = listBackups(dir, db);
  const doomed = all.slice(0, Math.max(0, all.length - keep));
  for (const b of doomed) unlinkSync(b.file);
  return doomed.map((b) => b.name);
}

/** True when there is no backup newer than `maxAgeMs` (the worker can call this to catch up after downtime). */
export function backupDue(dir, db = DEFAULT_DB, maxAgeMs = 24 * 3600_000, now = Date.now()) {
  const last = listBackups(dir, db).at(-1);
  return !last || now - statSync(last.file).mtimeMs > maxAgeMs;
}

/**
 * Copy one finished backup into `dir` (tmp + rename, mode 600) and keep the newest `keep` there. Never throws: a copy
 * folder on a disk that isn't plugged in must not fail the backup itself. Returns the copy, or why there is none.
 */
export function copyBackup(file, dir, { db = DEFAULT_DB, keep = DEFAULT_KEEP } = {}) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const to = join(dir, file.split('/').pop());
    const tmp = `${to}.partial`;
    copyFileSync(file, tmp);
    chmodSync(tmp, 0o600);
    renameSync(tmp, to);
    return { file: to, pruned: pruneBackups(dir, db, keep) };
  } catch (e) {
    return { error: e?.code ?? e?.name ?? 'copy_failed' };
  }
}

/**
 * @param {{ db?: string, dir?: string, keep?: number, pgBin?: string, host?: string, now?: Date, copyDir?: string | null }} [opts]
 *   `copyDir`: undefined = CC_BACKUP_COPY_DIR, null = no copy, a path = that folder
 */
export async function runBackup({ db = DEFAULT_DB, dir = defaultBackupDir(), keep = DEFAULT_KEEP, pgBin = PG17_BIN, host = 'localhost', now = new Date(), copyDir } = {}) {
  assertDbName(db);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, backupName(db, now));
  const tmp = `${file}.partial`;
  // Custom format (-Fc): compressed, and pg_restore can restore selectively.
  await exec(join(pgBin, 'pg_dump'), ['-h', host, '-Fc', '--no-owner', '-f', tmp, db], { timeout: 10 * 60_000 });
  const { rename } = await import('node:fs/promises');
  await rename(tmp, file); // a half-written dump never looks like a backup
  chmodSync(file, 0o600);
  const pruned = pruneBackups(dir, db, keep);
  // the copy folder: an explicit `copyDir` (null = none), else CC_BACKUP_COPY_DIR; a cloud-synced one is refused
  const c = copyDir === undefined ? backupCopyDir() : { dir: copyDir, refused: copyDir ? (cloudSyncedReason(copyDir) ? 'cloud-synced' : null) : null };
  const copy = !c.dir ? null : c.refused ? { error: 'refused_cloud_synced', dir: c.dir } : { ...copyBackup(file, c.dir, { db, keep }), dir: c.dir };
  return { file, bytes: statSync(file).size, pruned, copy };
}

const psql = (pgBin, host, db, sql) => exec(join(pgBin, 'psql'), ['-h', host, '-d', db, '-X', '-Atc', sql]);

export async function dbExists(db, { pgBin = PG17_BIN, host = 'localhost' } = {}) {
  const { stdout } = await psql(pgBin, host, 'postgres', `SELECT 1 FROM pg_database WHERE datname='${assertDbName(db)}'`);
  return stdout.trim() === '1';
}

/**
 * Restore `file` into `into`. Creates the target; if it exists, `replace` must be true (drops it first).
 * Never defaults to the live database: callers choose the target explicitly.
 */
export async function runRestore({ file, into, replace = false, pgBin = PG17_BIN, host = 'localhost' }) {
  assertDbName(into);
  if (!existsSync(file)) throw new Error(`backup file not found: ${file}`);
  if (await dbExists(into, { pgBin, host })) {
    if (!replace) throw new Error(`database ${into} already exists; pass replace to drop and recreate it`);
    await psql(pgBin, host, 'postgres', `DROP DATABASE IF EXISTS ${into} WITH (FORCE)`); // IF EXISTS: it can vanish between the check and the drop
  }
  await exec(join(pgBin, 'createdb'), ['-h', host, into]);
  try {
    await exec(join(pgBin, 'pg_restore'), ['-h', host, '--no-owner', '--exit-on-error', '-d', into, file], { timeout: 10 * 60_000 });
  } catch (e) {
    await psql(pgBin, host, 'postgres', `DROP DATABASE IF EXISTS ${into} WITH (FORCE)`).catch(() => undefined);
    throw new Error(`pg_restore failed: ${String(e.stderr ?? e.message).split('\n')[0]}`);
  }
  return { into };
}

export async function dropDb(db, { pgBin = PG17_BIN, host = 'localhost' } = {}) {
  await psql(pgBin, host, 'postgres', `DROP DATABASE IF EXISTS ${assertDbName(db)} WITH (FORCE)`);
}
