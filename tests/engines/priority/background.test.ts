/** R-UI-8 background promises: old, low-priority commitments, oldest first, with "Kick off ▸". */
import { describe, expect, it } from 'vitest';
import { rankWork } from '@/engines/priority/rank';
import { at, inputs, item } from './fixtures';

// "Package up the Beacon app for Ravi" was promised 2026-08-27: 70 days before Thu 11/05.
const ravi = item('beacon', {
  title: 'Package Beacon app for Ravi',
  kind: 'commitment',
  createdAt: '2026-08-27T09:00:00.000Z',
  effort: { youMin: 15, agentMin: 120 },
  stakeholders: [{ name: 'Ravi', tier: 'teammate' }],
});
const newer = item('deck', {
  title: 'Share the D360 sizing deck with Kim',
  kind: 'commitment',
  createdAt: '2026-10-06T09:00:00.000Z',
  effort: { youMin: 10, agentMin: 0 },
  stakeholders: [{ name: 'Kim', tier: 'teammate' }],
});
const todayWork = item('today', { title: 'Reply to Dana', kind: 'ask', due: at('12:00'), effort: { youMin: 10, agentMin: 0 } });

describe('background promises (R-UI-8)', () => {
  const r = rankWork(inputs({ items: [todayWork, newer, ravi] }));

  it('lands the 70-day Ravi promise in the background lane, not the ranking', () => {
    expect(r.lanes.background).toContain('beacon');
    expect(r.ranked.map((s) => s.workItemId)).not.toContain('beacon');
    expect(r.top3).not.toContain('beacon');
    const entry = r.background.find((b) => b.workItemId === 'beacon')!;
    expect(entry).toMatchObject({
      ageDays: 70,
      hint: 'promised 70d ago',
      action: { label: 'Kick off', verb: 'kick_off' },
      policyVersion: 1,
    });
    expect(entry.score).toBeLessThan(30);
    expect(r.scores.beacon!.lane).toBe('background');
    expect(r.scores.beacon!.rank).toBeNull();
  });

  it('orders the background lane oldest first, and offers Renegotiate when nothing can run in the background', () => {
    expect(r.background.map((b) => b.workItemId)).toEqual(['beacon', 'deck']);
    expect(r.background[1]).toMatchObject({ ageDays: 30, action: { verb: 'renegotiate' } });
  });

  it('keeps an old commitment in view when it has a near deadline or is still important', () => {
    const due = { ...ravi, id: 'beacon-due', due: at('17:00', '2026-11-06') };
    const important = { ...ravi, id: 'beacon-vip', importance: 'critical' as const, stakeholders: [{ name: 'Pat', tier: 'leader' as const }] };
    const young = { ...ravi, id: 'beacon-young', createdAt: '2026-10-29T09:00:00.000Z' };
    const r2 = rankWork(inputs({ items: [due, important, young] }));
    expect(r2.lanes.background).toEqual([]);
    expect(r2.scores['beacon-due']!.lane).not.toBe('background');
    expect(r2.scores['beacon-vip']!.total).toBeGreaterThanOrEqual(30);
  });

  it('honours an explicit isBackground flag (W0 `isBackground`) on any kind', () => {
    const flagged = item('flagged', { kind: 'task', isBackground: true, createdAt: at('08:00', '2026-11-01') });
    const r3 = rankWork(inputs({ items: [flagged] }));
    expect(r3.lanes.background).toEqual(['flagged']);
    expect(r3.background[0]!.hint).toBe('4d old');
  });
});
