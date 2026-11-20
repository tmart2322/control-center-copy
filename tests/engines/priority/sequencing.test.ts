/**
 * R-UI-4, Tristan's example: "kick off the long build for the big meeting first, then do the small
 * prep for the easy meeting" — as long as the small prep still fits before its meeting.
 */
import { describe, expect, it } from 'vitest';
import { rankWork } from '@/engines/priority/rank';
import { RULE_TRAININGS_BELOW_CUSTOMER_PREP } from '@/engines/priority/policy';
import { at, inputs, item, meeting, withPolicy } from './fixtures';

const bigDemo = meeting('m-demo', at('14:00'), at('15:00'), { title: 'ACME demo', hasExternalAttendees: true });
const easySync = meeting('m-sync', at('11:00'), at('11:30'), { title: 'Team sync' });

const build = item('build', {
  title: 'Build ACME demo org',
  servesEventId: 'm-demo',
  effort: { youMin: 10, agentMin: 180 },
});
const prep = item('prep', {
  title: 'Prep sync notes',
  servesEventId: 'm-sync',
  effort: { youMin: 15, agentMin: 0 },
});

describe("Tristan's sequencing example (R-UI-4)", () => {
  it('computes start-by from deadline − buffer − agent lead time − your effort', () => {
    const r = rankWork(inputs({ items: [build, prep], meetings: [bigDemo, easySync] }));
    // 14:00 − 15 buffer − 180 agent − 10 you = 10:35
    expect(r.scores.build!.startBy).toBe(at('10:35'));
    // 11:00 − 15 buffer − 15 you = 10:30
    expect(r.scores.prep!.startBy).toBe(at('10:30'));
    expect(r.scores.build!.deadline).toMatchObject({ source: 'meeting', eventId: 'm-demo' });
    expect(r.scores.build!.effort).toEqual({ youMin: 10, agentMin: 180 });
  });

  it('ranks the long build first and still plans the small prep before its meeting', () => {
    const r = rankWork(inputs({ items: [build, prep], meetings: [bigDemo, easySync] }));
    expect(r.top3.slice(0, 2)).toEqual(['build', 'prep']);
    const kick = r.spine.find((s) => s.workItemId === 'build')!;
    expect(kick).toMatchObject({ start: at('09:00'), end: at('09:10'), mode: 'kickoff_background' });
    expect(kick.label).toBe('09:00 ▶ Kick off: Build ACME demo org');
    const prepSlot = r.spine.find((s) => s.workItemId === 'prep')!;
    expect(prepSlot).toMatchObject({ start: at('09:10'), end: at('09:25'), mode: 'meeting_prep' });
    expect(Date.parse(prepSlot.end)).toBeLessThanOrEqual(Date.parse(r.scores.prep!.startBy!) + 15 * 60_000);
    expect(r.capacity.agentMinQueued).toBe(180);
    const step = r.planSteps.find((s) => s.workItemId === 'build')!;
    expect(step.reason).toContain('agent ~3h finishes ~12:10');
  });

  it('kicks off first even when the small prep scores higher (sequencing, not score)', () => {
    // Make the easy meeting's prep outscore the build: no customer boosts, no lead-time weight, a critical prep.
    const policy = withPolicy({
      weights: { ...withPolicy({}).weights, leadTime: 0 },
      rules: [RULE_TRAININGS_BELOW_CUSTOMER_PREP],
    });
    const urgentPrep = { ...prep, importance: 'critical' as const, stakeholders: [{ name: 'Morgan', isManager: true }] };
    const r = rankWork(inputs({ policy, items: [build, urgentPrep], meetings: [bigDemo, easySync] }));
    expect(r.scores.prep!.scoreRank).toBe(1);
    expect(r.scores.build!.scoreRank).toBe(2);
    expect(r.ranked.map((s) => s.workItemId)).toEqual(['build', 'prep']);
    const seq = r.scores.build!.sequencing!;
    expect(seq.movedAbove).toEqual(['prep']);
    expect(seq.reason).toBe(
      "Kick off first: agent ~3h must finish before ACME demo 14:00; 'Prep sync notes' still fits before its start-by 10:30",
    );
    expect(r.scores.build!.reasons[0]!.key).toBe('sequencing');
    expect(r.scores.build!.explanation.startsWith('Kick off first')).toBe(true);
  });

  it('does not jump the small prep when the prep would no longer fit before its meeting', () => {
    const policy = withPolicy({ weights: { ...withPolicy({}).weights, leadTime: 0 }, rules: [] });
    const urgentPrep = { ...prep, importance: 'critical' as const, stakeholders: [{ name: 'Morgan', isManager: true }] };
    // 10:22 + 10 min kick-off = 10:32 > the prep's start-by 10:30.
    const r = rankWork(inputs({ now: at('10:22'), policy, items: [build, urgentPrep], meetings: [bigDemo, easySync] }));
    expect(r.scores.prep!.preempt).toBe(false);
    expect(r.ranked.map((s) => s.workItemId)).toEqual(['prep', 'build']);
    expect(r.scores.build!.sequencing).toBeNull();
  });

  it('never jumps an item that is late unless started now', () => {
    const policy = withPolicy({ weights: { ...withPolicy({}).weights, leadTime: 0 }, rules: [] });
    const urgentPrep = { ...prep, importance: 'critical' as const };
    const r = rankWork(inputs({ now: at('10:28'), policy, items: [build, urgentPrep], meetings: [bigDemo, easySync] }));
    expect(r.scores.prep!.preempt).toBe(true);
    expect(r.ranked[0]!.workItemId).toBe('prep');
  });

  it('does not treat a build whose agent already started as a kick-off', () => {
    const running = { ...build, status: 'in_progress' as const, agentStarted: true };
    const r = rankWork(inputs({ items: [running, prep], meetings: [bigDemo, easySync] }));
    // Only your 10 review minutes remain: 14:00 − 15 − 10 = 13:35.
    expect(r.scores.build!.startBy).toBe(at('13:35'));
    expect(r.scores.build!.sequencing).toBeNull();
    expect(r.planSteps.find((s) => s.workItemId === 'build')!.mode).not.toBe('kickoff_background');
  });

  it('moves start-by into working hours when the hands-on part would land before the day starts', () => {
    const tomorrow = meeting('m-tmrw', at('09:20', '2026-11-06'), at('10:00', '2026-11-06'), { title: 'Globex workshop', hasExternalAttendees: true });
    const longBuild = item('lb', { servesEventId: 'm-tmrw', effort: { youMin: 10, agentMin: 120 } });
    const r = rankWork(inputs({ items: [longBuild], meetings: [tomorrow] }));
    // Raw: Fri 09:20 − 15 − 120 − 10 = Fri 06:55 (outside hours) → Thu 17:50 (last 10 working minutes).
    expect(r.scores.lb!.startBy).toBe(at('17:50'));
  });
});
