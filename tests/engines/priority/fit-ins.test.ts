/** R-UI-2 trainings as fit-ins ("fits your 11:30 gap"), gaps, spine slots and the capacity bar. */
import { describe, expect, it } from 'vitest';
import { rankWork } from '@/engines/priority/rank';
import { at, inputs, item, meeting } from './fixtures';

const workshop = meeting('m-ws', at('10:00'), at('11:30'), { title: 'ACME workshop', hasExternalAttendees: true });
const onsite = meeting('m-onsite', at('12:00'), at('17:30'), { title: 'Globex onsite', hasExternalAttendees: true });

const agenda = item('agenda', { title: 'Prep workshop agenda', servesEventId: 'm-ws', effort: { youMin: 45, agentMin: 0 } });
const reply = item('reply', {
  title: 'Reply to Dana',
  kind: 'ask',
  due: at('12:00'),
  effort: { youMin: 15, agentMin: 0 },
  stakeholders: [{ name: 'Dana', isExternal: true }],
});
const training = item('cert', {
  title: 'Agentforce cert maintenance',
  kind: 'training',
  effort: { youMin: 25, agentMin: 0 },
  training: { mandatory: true, requiredBy: at('17:00', '2026-11-08') },
});

describe('fit-ins (R-UI-2)', () => {
  const r = rankWork(inputs({ items: [agenda, reply, training], meetings: [workshop, onsite] }));

  it('finds the gaps between meetings inside working hours', () => {
    expect(r.gaps).toEqual([
      { start: at('09:00'), end: at('10:00'), minutes: 60 },
      { start: at('11:30'), end: at('12:00'), minutes: 30 },
      { start: at('17:30'), end: at('18:00'), minutes: 30 },
    ]);
    expect(r.capacity.focusMinLeft).toBe(120);
  });

  it('plans the Top 3 work into the first gap', () => {
    expect(r.top3).toEqual(['agenda', 'reply']);
    expect(r.spine.filter((s) => s.kind === 'work').map((s) => [s.workItemId, s.start, s.end])).toEqual([
      ['agenda', at('09:00'), at('09:45')],
      ['reply', at('09:45'), at('10:00')],
    ]);
  });

  it('shelves the overdue-ish mandatory training into a specific gap', () => {
    expect(r.fitIns).toHaveLength(1);
    expect(r.fitIns[0]).toMatchObject({
      workItemId: 'cert',
      hint: 'fits your 11:30 gap',
      plannedStart: at('11:30'),
      plannedEnd: at('11:55'),
      gap: { start: at('11:30'), end: at('12:00'), minutes: 30 },
      action: { verb: 'start' },
    });
    const slot = r.spine.find((s) => s.kind === 'fit_in')!;
    expect(slot.label).toBe('11:30 30m gap: fits Agentforce cert maintenance');
  });

  it("keeps the training in Today (its floor rule) but out of the Top 3 and below customer prep", () => {
    const cert = r.scores.cert!;
    expect(cert.lane).toBe('now');
    expect(cert.top3Eligible).toBe(false);
    expect(cert.rank!).toBeGreaterThan(r.scores.agenda!.rank!);
    expect(cert.ruleHits.map((h) => h.ruleKey)).toContain('mandatory_trainings_today');
    // Capacity counts today-scoped hands-on work only: the training is a fit-in suggestion, not load.
    expect(r.capacity.todayItemIds).toEqual(['agenda', 'reply']);
    expect(r.capacity.youMinToday).toBe(45 + 15);
    expect(r.capacity.plannedMin).toBe(60);
    expect(r.capacity.overByMin).toBe(60 - 120);
    expect(r.capacity).toMatchObject({ freeMin: 120, openMin: 60, fits: true });
  });

  it('labels the leftover gap and promotes a training into the Top 3 only when due within 48h', () => {
    expect(r.spine.find((s) => s.kind === 'gap')!.label).toBe('17:30 30m gap');
    const dueSoon = { ...training, training: { mandatory: true, requiredBy: at('17:00', '2026-11-06') } };
    const r2 = rankWork(inputs({ items: [agenda, reply, dueSoon], meetings: [workshop, onsite] }));
    expect(r2.scores.cert!.top3Eligible).toBe(true);
    expect(r2.top3).toContain('cert');
    // …and the policy still never ranks it above customer prep.
    expect(r2.scores.cert!.rank!).toBeGreaterThan(r2.scores.agenda!.rank!);
    expect(r2.scores.cert!.rank!).toBeGreaterThan(r2.scores.reply!.rank!);
  });

  it('reports a fit-in candidate with no gap left as overflow', () => {
    const big = { ...training, effort: { youMin: 30, agentMin: 0 } };
    const second = item('cert2', { title: 'Security awareness', kind: 'training', effort: { youMin: 30, agentMin: 0 }, training: { mandatory: true, requiredBy: at('17:00', '2026-11-09') } });
    const third = item('cert3', { title: 'Privacy refresher', kind: 'training', effort: { youMin: 30, agentMin: 0 }, training: { mandatory: true, requiredBy: at('17:00', '2026-11-10') } });
    const r3 = rankWork(inputs({ items: [agenda, reply, big, second, third], meetings: [workshop, onsite] }));
    expect(r3.fitIns.map((f) => f.hint)).toEqual(['fits your 11:30 gap', 'fits your 17:30 gap']);
    expect(r3.fitInOverflow).toHaveLength(1);
  });

  it('formats labels in the local timezone', () => {
    const pt = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], utcOffsetMinutes: -480 };
    // 17:00Z = 09:00 PT.
    const ws = meeting('m-ws', at('18:00'), at('19:30'), { title: 'ACME workshop', hasExternalAttendees: true });
    const r4 = rankWork(inputs({ now: at('17:00'), workingHours: pt, items: [{ ...training }], meetings: [ws] }));
    expect(r4.fitIns[0]!.hint).toBe('fits your 09:00 gap');
  });
});
