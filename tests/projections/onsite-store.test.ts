/** Onsite corrections store (onsite lane): pure helpers over `cc.onsite.overrides`. Placeholder ids only. */
import { describe, expect, it } from 'vitest';

import type { OnsiteDay } from '@/contract';
import { addTripOverride, applyOnsiteCorrection, onsiteDaysIn, onsiteWeekKey, overridesForWeek, overridesHash, readOnsiteOverrides } from '@/server/datasource/db/store/onsite';

const NOW = '2026-11-05T18:00:00.000Z';
const chip = (day: string, p: Partial<OnsiteDay> = {}): OnsiteDay => ({
  day,
  status: 'detected',
  accountId: 'acct-acme',
  accountName: 'ACME',
  whatOrg62Id: '006PLACEHOLDER0001',
  whatName: 'ACME - Expansion',
  city: 'CITY',
  timezone: 'America/New_York',
  frame: null,
  hoursLabel: '',
  signals: [],
  trip: { from: '2026-10-27', to: '2026-10-29' },
  locked: false,
  ...p,
});
const what = () => ({ whatId: '006PLACEHOLDER0002', whatName: 'Globex - Rollout' });

describe('onsite corrections', () => {
  it('Confirm freezes what the chip shows; Not onsite and Clear replace it', () => {
    let o = applyOnsiteCorrection({ days: [], trips: [] }, '2026-10-28', { action: 'confirm' }, { current: chip('2026-10-28'), what, now: NOW });
    expect(o.days).toEqual([expect.objectContaining({ day: '2026-10-28', onsite: true, accountKey: 'acct-acme', whatId: '006PLACEHOLDER0001', city: 'CITY', timezone: 'America/New_York' })]);
    o = applyOnsiteCorrection(o, '2026-10-28', { action: 'not_onsite' }, { current: chip('2026-10-28'), what, now: NOW });
    expect(o.days).toEqual([{ day: '2026-10-28', onsite: false, at: NOW }]);
    o = applyOnsiteCorrection(o, '2026-10-28', { action: 'clear' }, { current: null, what, now: NOW });
    expect(o.days).toEqual([]);
  });

  it('Change account moves the whole trip: its other corrected days and a marked trip follow', () => {
    let o = applyOnsiteCorrection({ days: [], trips: [] }, '2026-10-28', { action: 'adjust_hours', start: '09:00', end: '12:00' }, { current: chip('2026-10-28'), what, now: NOW });
    o = addTripOverride(o, { from: '2026-10-27', to: '2026-10-29', accountKey: 'acct-acme' }, NOW);
    o = applyOnsiteCorrection(o, '2026-10-29', { action: 'change_account', accountId: 'acct-globex' }, { current: chip('2026-10-29'), what, now: NOW });
    expect(o.days.map((d) => [d.day, d.accountKey, d.whatId])).toEqual([
      ['2026-10-28', 'acct-globex', '006PLACEHOLDER0002'],
      ['2026-10-29', 'acct-globex', '006PLACEHOLDER0002'],
    ]);
    expect(o.days.find((d) => d.day === '2026-10-28')!.hours).toEqual({ start: '09:00', end: '12:00' }); // the hours stay
    expect(o.trips[0]).toMatchObject({ accountKey: 'acct-globex', whatId: '006PLACEHOLDER0002' });
  });

  it('rejects bad hours and a missing account', () => {
    expect(() => applyOnsiteCorrection({ days: [], trips: [] }, '2026-10-28', { action: 'adjust_hours', start: '12:00', end: '09:00' }, { current: null, what, now: NOW })).toThrow();
    expect(() => applyOnsiteCorrection({ days: [], trips: [] }, '2026-10-28', { action: 'change_account' }, { current: null, what, now: NOW })).toThrow();
  });

  it('Clear on a day of a marked trip drops the trip; a new trip replaces an overlapping one', () => {
    let o = addTripOverride({ days: [], trips: [] }, { from: '2026-11-03', to: '2026-11-04', accountKey: 'acct-acme' }, NOW);
    o = addTripOverride(o, { from: '2026-11-04', to: '2026-11-06', accountKey: 'acct-globex' }, NOW);
    expect(o.trips.map((t) => [t.from, t.to])).toEqual([['2026-11-04', '2026-11-06']]);
    o = applyOnsiteCorrection(o, '2026-11-05', { action: 'clear' }, { current: null, what, now: NOW });
    expect(o.trips).toEqual([]);
  });

  it('hashes only the corrections a week can see, and reads the week records back as chips', () => {
    const o = addTripOverride({ days: [{ day: '2026-10-28', onsite: false, at: NOW }], trips: [] }, { from: '2026-12-01', to: '2026-12-02', accountKey: 'a' }, NOW);
    expect(overridesForWeek(o, '2026-10-26').trips).toEqual([]);
    expect(overridesHash(overridesForWeek(o, '2026-11-30'))).not.toBe(overridesHash(overridesForWeek(o, '2026-10-26')));
    expect(overridesHash({ days: [], trips: [] })).toBe('none');
    const kv = new Map<string, unknown>([
      ['cc.onsite.overrides', o],
      [onsiteWeekKey('2026-10-26'), { version: 1, weekStart: '2026-10-26', overridesHash: 'x', days: [{ day: '2026-10-28', status: 'not_onsite', accountKey: null, accountName: null, whatId: null, whatName: null, city: null, timezone: 'America/Denver', frame: null, hoursLabel: '', signals: [], tripKey: null, tripFrom: null, tripTo: null, locked: true }] }],
    ]);
    expect(readOnsiteOverrides(kv).days).toHaveLength(1);
    expect(onsiteDaysIn(kv, '2026-10-26', '2026-11-01')).toEqual([expect.objectContaining({ day: '2026-10-28', status: 'not_onsite', locked: true, trip: null })]);
    expect(onsiteDaysIn(kv, '2026-11-02', '2026-11-08')).toEqual([]);
  });
});
