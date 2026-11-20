/**
 * Lane E (E1): the worker claims jobs only on the schema it was built for. It waits (never exits, so launchd can't
 * crash-loop it), keeps its heartbeat fresh as `blocked`, says why once, opens one Health event and resolves it when
 * the two agree. While running, the runtime holds claims and every hook but the heartbeat and the schema check.
 */
import { describe, expect, it } from 'vitest';

import type { Db } from '../../src/db/client';
import type { JournalEntry } from '../../src/db/migration-state';
import { JobRegistry } from '../../src/jobs/registry';
import { WorkerRuntime } from '../../src/worker/runtime';
import { SchemaGuard, SCHEMA_EVENT_FINGERPRINT } from '../../src/worker/schema-guard';

const JOURNAL: JournalEntry[] = [
  { idx: 0, when: 100, tag: '0000_a' },
  { idx: 1, when: 200, tag: '0001_b' },
];

/** A Db that records the SQL it is given (only the guard's event writes reach it). */
function fakeDb() {
  const queries: string[] = [];
  const db = {
    execute: async (q: { queryChunks?: unknown[] }) => {
      queries.push(JSON.stringify(q.queryChunks ?? q));
      return { rows: [] };
    },
  } as unknown as Db;
  return { db, queries };
}

describe('SchemaGuard', () => {
  it('waits while the database is behind, beating blocked, then returns once migrated', async () => {
    const { db, queries } = fakeDb();
    const logs: string[] = [];
    let applied = [100];
    const guard = new SchemaGuard({ db, journal: JOURNAL, readApplied: async () => applied, log: (m) => void logs.push(m), ownerUserId: async () => 'user-1' });
    let beats = 0;
    let sleeps = 0;
    const ok = await guard.waitForMatch({
      stopping: () => false,
      onBlocked: (s) => {
        beats++;
        expect(s?.state).toBe('behind');
      },
      sleep: async () => {
        if (++sleeps === 3) applied = [100, 200]; // someone ran npm run db:migrate
      },
      intervalMs: 30,
      beatMs: 15,
    });
    expect(ok).toBe(true);
    expect(beats).toBeGreaterThanOrEqual(3); // the heartbeat stays fresh while it waits
    // said once, not every check
    expect(logs.filter((l) => l.startsWith('waiting:'))).toHaveLength(1);
    expect(logs).toContain('database schema matches this build again; claiming jobs');
    // one Health event opened, then resolved
    expect(queries.filter((q) => q.includes('insert into app_events'))).toHaveLength(1);
    expect(queries.some((q) => q.includes('schema_mismatch') && q.includes(SCHEMA_EVENT_FINGERPRINT))).toBe(true);
    expect(queries.at(-1)).toContain('resolved_at = now()');
  });

  it('a database newer than the build, and one with a skipped migration, block too', async () => {
    const { db } = fakeDb();
    for (const [applied, state] of [
      [[100, 200, 300], 'ahead'],
      [[200], 'skipped'],
      [[], 'empty'],
    ] as const) {
      const guard = new SchemaGuard({ db, journal: JOURNAL, readApplied: async () => [...applied], log: () => {} });
      expect((await guard.check())?.state).toBe(state);
    }
  });

  it('stops waiting when the worker is told to stop (no exit, no loop)', async () => {
    const { db } = fakeDb();
    let stop = false;
    const guard = new SchemaGuard({ db, journal: JOURNAL, readApplied: async () => [100], log: () => {} });
    const ok = await guard.waitForMatch({ stopping: () => stop, onBlocked: () => void (stop = true), sleep: async () => {}, intervalMs: 10, beatMs: 10 });
    expect(ok).toBe(false);
  });

  it('a failed read is no verdict: it keeps waiting and asks again', async () => {
    const { db } = fakeDb();
    let n = 0;
    const logs: string[] = [];
    const guard = new SchemaGuard({
      db,
      journal: JOURNAL,
      readApplied: async () => {
        if (n++ === 0) throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
        return [100, 200];
      },
      log: (m) => void logs.push(m),
    });
    expect(await guard.waitForMatch({ stopping: () => false, onBlocked: () => {}, sleep: async () => {}, intervalMs: 10, beatMs: 10 })).toBe(true);
    expect(logs[0]).toMatch(/schema check failed/);
  });

  it('a match at the first check writes nothing', async () => {
    const { db, queries } = fakeDb();
    const guard = new SchemaGuard({ db, journal: JOURNAL, readApplied: async () => [100, 200], log: () => {} });
    expect((await guard.check())?.state).toBe('match');
    expect(queries.filter((q) => q.includes('insert into'))).toHaveLength(0);
  });
});

describe('WorkerRuntime.hold', () => {
  it('claims nothing and runs only whileHeld hooks until released', async () => {
    const ran: string[] = [];
    const rt = new WorkerRuntime({
      db: {} as Db, // a held poll never reaches the database
      userId: 'u',
      workerId: 'w',
      registry: new JobRegistry(),
      services: {},
      listenUrl: null,
      log: () => {},
      hooks: [
        { name: 'heartbeat', everyMs: 1000, whileHeld: true, run: async () => void ran.push('heartbeat') },
        { name: 'plan', everyMs: 1000, run: async () => void ran.push('plan') },
      ],
    });
    rt.hold('schema_mismatch');
    expect(rt.held).toBe('schema_mismatch');
    await rt.runHooks();
    expect(ran).toEqual(['heartbeat']);
    expect(await rt.pollOnce()).toBe(0);
    rt.release();
    await rt.runHooks();
    expect(ran).toEqual(['heartbeat', 'heartbeat', 'plan']);
  });
});
