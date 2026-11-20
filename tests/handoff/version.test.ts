/** D-57: GET /version's shape, the web ↔ worker mismatch flag, the migration tag, and how the footer reads it. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { routes, Seed, VersionPayload } from '@/contract';
import journal from '@/db/migrations/meta/_journal.json';
import { versionLine, versionWarning } from '@/lib/version-line';
import { personaOf } from '@/personas';
import { MockDataSource } from '@/server/datasource/mock';
import { buildInfo, bundledMigration, coreVersion, migrationTagFor, versionPayload } from '@/server/version';
import { versionReport } from '@/components/settings/AboutSection';

const seed = Seed.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../src/mock/seed.example.json'), 'utf8')));
const entries = (journal as { entries: Array<{ idx: number; when: number; tag: string }> }).entries;
const last = entries.at(-1)!;
const se = personaOf({ profile: { role: 'se_ic' } });
const build = { version: '1.2.0', sha: 'abc1234', builtAt: '2026-11-11T10:00:00.000Z' };

describe('GET /version', () => {
  let ds: MockDataSource;
  beforeEach(() => {
    ds = new MockDataSource({ seed: structuredClone(seed), delays: { enrichMs: 5, stepMs: 5, chatTokenMs: 0, verifyMs: 5, reevalMs: 5 }, autoplay: false, clockMode: 'seed' });
  });
  afterEach(() => ds.dispose());

  it('is a GET /version route whose mock answer matches the schema', async () => {
    expect(routes.getVersion).toMatchObject({ method: 'GET', path: '/version' });
    const v = await ds.getVersion({} as never);
    expect(VersionPayload.parse(v)).toEqual(v);
    expect(v).toMatchObject({ dataSource: 'mock', migration: null, workerVersion: null, mismatch: false, migrationPending: false, persona: { id: 'se' } });
    expect(Object.keys(v).sort()).toEqual(['builtAt', 'bundledMigration', 'dataSource', 'migration', 'mismatch', 'migrationPending', 'persona', 'sha', 'version', 'workerVersion'].sort());
  });

  it('flags a worker on another version, ignoring build metadata and a v prefix', () => {
    const at = (workerVersion: string | null) => versionPayload({ build, migration: last.tag, persona: se, workerVersion, dataSource: 'db' });
    expect(at('1.1.0').mismatch).toBe(true);
    expect(at('1.2.0').mismatch).toBe(false);
    expect(at('v1.2.0+abc1234').mismatch).toBe(false);
    expect(at(null).mismatch).toBe(false); // no worker running is not a mismatch
    expect(coreVersion('v2.0.1+deadbee')).toBe('2.0.1');
  });

  it('names the applied migration from drizzle created_at and flags a pending one', () => {
    expect(bundledMigration()).toBe(last.tag);
    expect(migrationTagFor(last.when)).toBe(last.tag);
    expect(migrationTagFor(entries[0]!.when)).toBe(entries[0]!.tag);
    expect(migrationTagFor(last.when + 1)).toBe('newer than this build');
    expect(migrationTagFor(null)).toBeNull();
    const behind = versionPayload({ build, migration: entries.at(-2)!.tag, persona: se, workerVersion: '1.2.0', dataSource: 'db' });
    expect(behind.migrationPending).toBe(true);
    expect(versionPayload({ build, migration: last.tag, persona: se, workerVersion: '1.2.0', dataSource: 'db' }).migrationPending).toBe(false);
  });

  it('reads the embedded build env, else package.json with no sha', () => {
    expect(buildInfo({ CC_APP_VERSION: '3.1.4', CC_GIT_SHA: 'f00ba12', CC_BUILT_AT: '2026-11-11T09:00:00Z' })).toEqual({ version: '3.1.4', sha: 'f00ba12', builtAt: '2026-11-11T09:00:00.000Z' });
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { version: string };
    expect(buildInfo({})).toEqual({ version: pkg.version, sha: null, builtAt: null });
  });

  it('the footer reads "v1.2.0 · abc1234" and warns with what to run', () => {
    const ok = versionPayload({ build, migration: last.tag, persona: se, workerVersion: '1.2.0', dataSource: 'db' });
    expect(versionLine(ok)).toEqual({ text: 'v1.2.0 · abc1234', warn: null, action: null });
    const off = versionPayload({ build, migration: last.tag, persona: se, workerVersion: '1.1.0', dataSource: 'db' });
    expect(versionLine(off).action).toBe('restart');
    expect(versionWarning(off)).toMatch(/worker runs v1\.1\.0.*npm run update/);
    expect(versionReport(off)).toBe(`Control Center v1.2.0 (abc1234) built 2026-11-11 10:00Z · migration ${last.tag} · worker v1.1.0 · persona se/ic`);
  });
});
