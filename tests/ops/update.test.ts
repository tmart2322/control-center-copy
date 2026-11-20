/**
 * `npm run update` (lane E, E1): the order of the steps and every failure path, over fakes (no git, npm, launchd or
 * database). The rules: build before migrating (a failed build leaves the schema alone), back up before migrating,
 * both LaunchAgents stopped while it installs, builds and migrates, and a major release asks before anything changes.
 */
import { describe, expect, it } from 'vitest';

import { majorOf, runUpdate } from '../../scripts/ops/lib/update.mjs';

const WEB = 'com.controlcenter.web';
const WORKER = 'com.controlcenter.worker';
const CHANGELOG = '# Changelog\n\n## [2.0.0] - 2026-12-01\n### Changed\n- Run the new step.\n\n## [1.2.0] - 2026-11-20\n### Added\n- A feature.\n\n## [1.1.0] - 2026-11-13\n';

interface FakeOpts {
  from?: string;
  to?: string;
  incoming?: number;
  running?: string[];
  confirm?: boolean;
  fail?: Partial<Record<'fetch' | 'merge' | 'install' | 'build' | 'migrate' | 'backup' | 'stop' | 'start', boolean>>;
  hasBuild?: boolean;
  elsewhere?: string[];
}

function fake(o: FakeOpts = {}) {
  const log: string[] = [];
  const lines: string[] = [];
  let merged = false;
  const step = (name: string, ok = true) => {
    log.push(name);
    return ok;
  };
  const deps = {
    say: (m: string) => void lines.push(m),
    version: () => (merged ? (o.to ?? '1.2.0') : (o.from ?? '1.1.0')),
    runningVersion: async () => o.from ?? '1.1.0',
    git: {
      sha: () => (merged ? 'bbbbbbb' : 'aaaaaaa'),
      hasUpstream: () => true,
      fetch: async () => step('fetch', !o.fail?.fetch),
      incoming: () => o.incoming ?? 3,
      upstreamFile: (p: string) => (p === 'package.json' ? JSON.stringify({ version: o.to ?? '1.2.0' }) : p === 'CHANGELOG.md' ? CHANGELOG : null),
      mergeFfOnly: async () => {
        merged = !o.fail?.merge;
        return step('merge', !o.fail?.merge);
      },
    },
    changelog: (text: string, from: string, to: string) => (text.includes(`## [${to}]`) ? [`## [${to}] (from ${from})`] : []),
    readLocal: () => CHANGELOG,
    confirm: async (q: string) => {
      log.push(`confirm:${q}`);
      return o.confirm ?? false;
    },
    agents: {
      elsewhere: () => o.elsewhere ?? [],
      running: () => o.running ?? [WEB, WORKER],
      stop: async (l: string) => step(`stop:${l}`, !o.fail?.stop),
      start: async (l: string) => step(`start:${l}`, !o.fail?.start),
    },
    install: async () => step('install', !o.fail?.install),
    build: async () => step('build', !o.fail?.build),
    migrate: async () => step('migrate', !o.fail?.migrate),
    snapshot: async () => (step('snapshot'), o.hasBuild === false ? null : 'snap'),
    restore: async (h: string) => void step(`restore:${h}`),
    drop: async (h: string) => void step(`drop:${h}`),
    backup: async () => {
      step('backup');
      if (o.fail?.backup) throw new Error('pg_dump: connection refused');
      return { name: 'control_center-20261114-020000.dump', bytes: 4096, copied: null };
    },
  };
  return { deps, log, lines };
}

describe('npm run update (E1)', () => {
  it('a minor update: fetch, merge, stop both agents, install, build, back up, migrate, start them again', async () => {
    const f = fake();
    const r = await runUpdate(f.deps, {});
    expect(r).toMatchObject({ status: 'updated', fromV: '1.1.0', toV: '1.2.0' });
    expect(f.log).toEqual(['fetch', 'merge', `stop:${WEB}`, `stop:${WORKER}`, 'install', 'snapshot', 'build', 'backup', 'migrate', 'drop:snap', `start:${WEB}`, `start:${WORKER}`]);
    expect(f.lines.join('\n')).toMatch(/v1\.1\.0 · aaaaaaa → v1\.2\.0 · bbbbbbb/);
  });

  it('builds before it migrates, and backs up in between', () => {
    const f = fake();
    return runUpdate(f.deps, {}).then(() => {
      expect(f.log.indexOf('build')).toBeLessThan(f.log.indexOf('backup'));
      expect(f.log.indexOf('backup')).toBeLessThan(f.log.indexOf('migrate'));
      // nothing serves or claims jobs while it installs, builds and migrates
      expect(f.log.indexOf(`stop:${WORKER}`)).toBeLessThan(f.log.indexOf('install'));
      expect(f.log.indexOf(`start:${WORKER}`)).toBeGreaterThan(f.log.indexOf('migrate'));
    });
  });

  it('a failed build never migrates: the previous build goes back and the agents start again', async () => {
    const f = fake({ fail: { build: true } });
    const r = await runUpdate(f.deps, {});
    expect(r).toMatchObject({ status: 'failed', failedAt: 'build' });
    expect(f.log).not.toContain('migrate');
    expect(f.log).not.toContain('backup');
    expect(f.log.slice(-3)).toEqual(['restore:snap', `start:${WEB}`, `start:${WORKER}`]);
    expect(f.lines.join('\n')).toMatch(/build failed\. The database was not migrated, and the previous build is back in place\..*git reset --keep aaaaaaa/s);
  });

  it('a failed backup never migrates', async () => {
    const f = fake({ fail: { backup: true } });
    const r = await runUpdate(f.deps, {});
    expect(r).toMatchObject({ status: 'failed', failedAt: 'backup' });
    expect(f.log).not.toContain('migrate');
    expect(f.log).toContain('restore:snap');
    expect(f.lines.join('\n')).toMatch(/backup failed: pg_dump: connection refused/);
  });

  it('a failed migration puts the build back and starts the app again (the migration rolled back)', async () => {
    const f = fake({ fail: { migrate: true } });
    const r = await runUpdate(f.deps, {});
    expect(r).toMatchObject({ status: 'failed', failedAt: 'migrate' });
    expect(f.log.slice(-3)).toEqual(['restore:snap', `start:${WEB}`, `start:${WORKER}`]);
    expect(f.lines.join('\n')).toMatch(/one transaction, so the database is as it was/);
  });

  it('a failed install starts the agents again without touching the build', async () => {
    const f = fake({ fail: { install: true } });
    const r = await runUpdate(f.deps, {});
    expect(r).toMatchObject({ status: 'failed', failedAt: 'install' });
    expect(f.log).not.toContain('build');
    expect(f.log).not.toContain('snapshot');
    expect(f.log.slice(-2)).toEqual([`start:${WEB}`, `start:${WORKER}`]);
  });

  it('a failed fetch or merge changes nothing and stops no agent', async () => {
    for (const step of ['fetch', 'merge'] as const) {
      const f = fake({ fail: { [step]: true } });
      const r = await runUpdate(f.deps, {});
      expect(r).toMatchObject({ status: 'failed', failedAt: step });
      expect(f.log.some((l) => l.startsWith('stop:'))).toBe(false);
      expect(f.lines.join('\n')).toMatch(/Nothing changed/);
    }
  });

  it('only restarts the agents that were running', async () => {
    const f = fake({ running: [WORKER] });
    await runUpdate(f.deps, {});
    expect(f.log.filter((l) => l.startsWith('stop:') || l.startsWith('start:'))).toEqual([`stop:${WORKER}`, `start:${WORKER}`]);
  });

  it('a major update prints its changelog and asks before anything changes; no means nothing changed', async () => {
    const f = fake({ to: '2.0.0', confirm: false });
    const r = await runUpdate(f.deps, {});
    expect(r.status).toBe('declined');
    expect(f.log).toEqual(['fetch', 'confirm:Update to v2.0.0 and migrate the database now?']);
    expect(f.lines.join('\n')).toMatch(/MAJOR update[\s\S]*## \[2\.0\.0\]/);
    expect(f.lines.join('\n')).toMatch(/Nothing changed/);
  });

  it('a major update goes ahead on yes, or with --yes without asking', async () => {
    const yes = fake({ to: '2.0.0', confirm: true });
    expect((await runUpdate(yes.deps, {})).status).toBe('updated');
    expect(yes.log.indexOf('confirm:Update to v2.0.0 and migrate the database now?')).toBeLessThan(yes.log.indexOf('merge'));
    expect(yes.log).toContain('migrate');
    const flagged = fake({ to: '2.0.0' });
    expect((await runUpdate(flagged.deps, { yes: true })).status).toBe('updated');
    expect(flagged.log.some((l) => l.startsWith('confirm:'))).toBe(false);
  });

  it('--no-restart leaves the agents alone; --no-backup skips the backup; --dry changes nothing', async () => {
    const nr = fake();
    await runUpdate(nr.deps, { restart: false });
    expect(nr.log.some((l) => l.startsWith('stop:') || l.startsWith('start:'))).toBe(false);
    const nb = fake();
    await runUpdate(nb.deps, { backup: false });
    expect(nb.log).not.toContain('backup');
    expect(nb.log).toContain('migrate');
    const dry = fake();
    const r = await runUpdate(dry.deps, { dry: true });
    expect(r.status).toBe('up_to_date');
    expect(dry.log).toEqual([]);
  });

  it('with nothing new it still installs, builds and migrates (a --no-pull after a manual merge) and says so', async () => {
    const f = fake({ incoming: 0, to: '1.1.0' });
    const r = await runUpdate(f.deps, {});
    expect(r.status).toBe('up_to_date');
    expect(f.log).not.toContain('merge');
    expect(f.log).toContain('migrate');
    expect(f.lines.join('\n')).toMatch(/already up to date/);
  });

  it('refuses when the installed agents run another checkout: nothing changes, no agent stops', async () => {
    const f = fake({ elsewhere: ['/Users/me/Projects/control-center'] });
    const r = await runUpdate(f.deps, {});
    expect(r).toMatchObject({ status: 'failed', failedAt: 'elsewhere' });
    expect(f.log).toEqual([]); // before anything: no fetch, no stop, no migrate
    expect(f.lines.join('\n')).toMatch(/LaunchAgents run \/Users\/me\/Projects\/control-center, not this checkout: run npm run update there/);
  });

  it('majorOf reads the major number', () => {
    expect(majorOf('2.0.1')).toBe(2);
    expect(majorOf('v1.9.0')).toBe(1);
    expect(majorOf(undefined)).toBe(0);
  });
});
