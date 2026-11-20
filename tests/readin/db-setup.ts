/**
 * BE-READIN integration database: control_center_readin_<CC_TEST_DB_SUFFIX> (dropped and recreated per run with the
 * Postgres 17 binaries, migrated from empty, loaded with the placeholder example seed). Refuses any other name.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createDb, type DbHandle } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';
import { seedFromMock } from '../../src/server/datasource/db/from-mock';
import { loadSeedIntoDb } from '../../src/server/datasource/db/seed';
import { createMockDataSource } from '../../src/server/datasource/mock';
import { loadSeed } from '../../src/server/datasource/mock/seed-loader';

const PG_BIN = process.env.PG17_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const SUFFIX = (process.env.CC_TEST_DB_SUFFIX ?? 'main').replace(/[^a-z0-9]/g, '');
export const READIN_TEST_URL = `postgres://localhost:5432/control_center_readin_${SUFFIX}`;

export async function freshReadInDb(): Promise<{ handle: DbHandle; userId: string }> {
  const u = new URL(READIN_TEST_URL);
  const name = decodeURIComponent(u.pathname.slice(1));
  if (!/^control_center_readin_[a-z0-9]+$/.test(name)) throw new Error(`read-in tests only run against control_center_readin_*, not "${name}"`);
  const conn = ['--host', u.hostname || 'localhost', '--port', u.port || '5432'];
  const t0 = Date.now();
  const phase = (p: string) => process.env.READIN_TEST_DEBUG && console.log(`[readin-db] ${p} +${Math.round((Date.now() - t0) / 1000)}s`);
  // Create once and reuse: CREATE DATABASE serializes on template1 while other lanes create theirs. Every run then
  // migrates (a no-op when current) and reloads the seed with reset (truncate), so each run starts from the same state.
  // async: a blocked event loop would trip vitest's worker RPC timeout.
  const run = promisify(execFile);
  const exists = await run(`${PG_BIN}/psql`, [...conn, '-d', 'postgres', '-Atc', `select 1 from pg_database where datname = '${name}'`]).then((r) => r.stdout.trim() === '1');
  if (!exists || process.env.READIN_TEST_RECREATE === '1') {
    await run(`${PG_BIN}/dropdb`, [...conn, '--if-exists', '--force', name]);
    await run(`${PG_BIN}/createdb`, [...conn, name]);
  }
  phase('database');
  await runMigrations({ url: READIN_TEST_URL, log: () => {} });
  phase('migrated');
  const handle = createDb({ url: READIN_TEST_URL, max: 6, applicationName: 'readin-test' });
  const mock = createMockDataSource({ seed: seedInThePast(), autoplay: false, delays: { enrichMs: 1e8, stepMs: 1e8, chatTokenMs: 0, verifyMs: 1e8, reevalMs: 1e8 } });
  const { seed, rankedAt } = seedFromMock(mock);
  mock.dispose();
  const res = await loadSeedIntoDb(seed, { db: handle.db, rankedAt, reset: true });
  // reset truncates every public table, so jobs, spend and read-ins from a previous run are gone too.
  phase('seeded');
  return { handle, userId: res.userId };
}

/**
 * The seed is authored around meta.asOf (09:02 local) and rebased onto today by whole days. These tests run on the
 * wall clock (Postgres now(), Date.now()), so before 09:02 half the evidence would sit in the future: a fresh read-in
 * looks stale at once ("new since") and a future-created item counts as a brand-new direct ask. Anchor on yesterday
 * then, so the seed's "now" is never ahead of the real one.
 */
function seedInThePast() {
  const today = loadSeed();
  if (Date.parse(today.seed.meta.asOf) <= Date.now()) return today.seed;
  return loadSeed({ today: new Date(Date.now() - 86_400_000) }).seed;
}
