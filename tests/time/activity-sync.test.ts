/**
 * `activity.sync` (daily 17:30): in automatic logging mode on a weekday it stages the batch for Apply (once a day);
 * on demand, on a weekend, or with a batch already waiting, it stages nothing. Fakes only.
 */
import { describe, expect, it } from 'vitest';

import { activitySyncHandler } from '@/jobs/handlers/activity-sync';
import type { JobContext } from '@/jobs/types';

function ctx(o: { mode?: string; staged?: number; at: string }): JobContext {
  return {
    userId: 'u1',
    clock: () => new Date(o.at),
    log: () => undefined,
    db: { execute: async () => ({ rows: [{ time: o.mode ? { logging: { mode: o.mode } } : null, profile: { timezone: 'America/Denver' }, staged: o.staged ?? 0 }] }) },
  } as unknown as JobContext;
}

describe('activity.sync', () => {
  const stage = () => {
    const calls: string[] = [];
    return { calls, fn: async (u: string) => (calls.push(u), { draftIds: ['d1'], events: 4, hours: 3.5 }) };
  };

  it('on demand stages nothing', async () => {
    const s = stage();
    expect(await activitySyncHandler({ handle: {} as never, stage: s.fn })(ctx({ mode: 'on_demand', at: '2026-11-10T00:30:00Z' }))).toEqual({ skipped: 'on_demand' });
    expect(await activitySyncHandler({ handle: {} as never, stage: s.fn })(ctx({ at: '2026-11-10T00:30:00Z' }))).toEqual({ skipped: 'on_demand' });
    expect(s.calls).toEqual([]);
  });

  it('automatic stages the weekday batch once, never on a weekend', async () => {
    const s = stage();
    // Tue 2026-11-10 17:30 MT = 00:30Z on the 11th
    expect(await activitySyncHandler({ handle: {} as never, stage: s.fn })(ctx({ mode: 'automatic', at: '2026-11-11T00:30:00Z' }))).toEqual({ staged: 1, rows: 4, hours: 3.5 });
    expect(await activitySyncHandler({ handle: {} as never, stage: s.fn })(ctx({ mode: 'automatic', staged: 1, at: '2026-11-11T00:30:00Z' }))).toEqual({ skipped: 'already_staged' });
    // Sat 2026-11-14 17:30 MT
    expect(await activitySyncHandler({ handle: {} as never, stage: s.fn })(ctx({ mode: 'automatic', at: '2026-11-15T00:30:00Z' }))).toEqual({ skipped: 'weekend' });
    expect(s.calls).toEqual(['u1']);
  });
});
