/** UI-SPEC §1.7: nothing moves under the cursor. "Re-rank ready · n" unless you act, apply, or it's urgent. */
import { describe, expect, it } from 'vitest';
import { rankWork } from '@/engines/priority/rank';
import { rerank } from '@/engines/priority/stability';
import { at, inputs, item } from './fixtures';

const a = item('a', { title: 'A: reply to Dana', kind: 'ask', due: at('12:00'), effort: { youMin: 15, agentMin: 0 }, stakeholders: [{ name: 'Dana', isExternal: true }] });
const b = item('b', { title: 'B: SOW redlines', due: at('13:00'), effort: { youMin: 30, agentMin: 0 }, stakeholders: [{ name: 'Lee', isExternal: true }] });
const c = item('c', { title: 'C: demo script', due: at('15:00'), effort: { youMin: 30, agentMin: 0 } });
// D: due at 11:00 with 30 minutes of work. Fine at 09:00; late unless started by 10:15.
const d = item('d', { title: 'D: pricing to Globex', due: at('11:00'), dueKind: 'soft', effort: { youMin: 30, agentMin: 0 }, importance: 'low' });

describe('rerank (rank stability)', () => {
  const first = rankWork(inputs({ items: [a, b, c, d] }));
  const shown = first.top3;

  it('first render takes the ranking as-is', () => {
    const r = rerank([], first);
    expect(r.top3).toEqual(first.top3);
    expect(r.rerankReady).toBe(0);
  });

  it('keeps positions when new info would reorder, and announces it', () => {
    // New info: C became customer-facing and due sooner.
    const next = rankWork(inputs({ now: at('09:05'), items: [a, b, { ...c, due: at('10:30'), stakeholders: [{ name: 'Dana', isExternal: true }] }, d] }));
    expect(next.top3[0]).toBe('c');
    const r = rerank(shown, next);
    expect(r.applied).toBe(false);
    expect(r.top3).toEqual(shown);
    expect(r.rerankReady).toBeGreaterThan(0);
    expect(r.diff.find((m) => m.workItemId === 'c')).toMatchObject({ to: 1 });
    expect(r.preempted).toEqual([]);
  });

  it('applies when the user explicitly asks (r / ↻)', () => {
    const next = rankWork(inputs({ now: at('09:05'), items: [a, b, { ...c, due: at('10:30') }, d] }));
    const r = rerank(shown, next, { explicitApply: true });
    expect(r).toMatchObject({ applied: true, rerankReady: 0, top3: next.top3 });
  });

  it('fills only the slot the user freed; the other positions stay put', () => {
    const next = rankWork(inputs({ now: at('09:05'), items: [{ ...a, status: 'done' }, b, c, d] }));
    const actedOn = shown[0]!;
    const r = rerank(shown, next, { actedOn: [actedOn] });
    expect(r.top3[1]).toBe(shown[1]);
    expect(r.top3[2]).toBe(shown[2]);
    expect(r.top3[0]).not.toBe(actedOn);
    expect(r.filled).toEqual([r.top3[0]]);
  });

  it('lets an urgent pre-emption through: "now late unless started"', () => {
    // Three asks hold the Top 3 at 09:00; D (5h of work due 16:00) is 4th until it is late unless started.
    const ask = (id: string) => item(id, { kind: 'ask', importance: 'high', due: at('17:00'), effort: { youMin: 20, agentMin: 0 } });
    const big = item('d', { title: 'D: Globex RFP answers', due: at('16:00'), effort: { youMin: 300, agentMin: 0 } });
    const morning = rankWork(inputs({ items: [ask('a'), ask('b'), ask('c'), big] }));
    expect(morning.top3).toEqual(['a', 'b', 'c']);
    expect(morning.scores.d!.preempt).toBe(false);

    const late = rankWork(inputs({ now: at('10:42'), items: [ask('a'), ask('b'), ask('c'), big] }));
    expect(late.scores.d!.startBy).toBe(at('10:45'));
    expect(late.scores.d!.preempt).toBe(true);
    expect(late.top3).toEqual(['d', 'a', 'b']);

    const r = rerank(morning.top3, late);
    expect(r.applied).toBe(false);
    expect(r.preempted).toEqual([{ workItemId: 'd', reason: '↑ moved up: now late unless started (start by 10:45)' }]);
    expect(r.top3).toEqual(['d', 'a', 'b']);
    expect(r.rerankReady).toBe(0);

    // Without the pre-emption the same reorder would only light the pill.
    const calm = { ...late, ranked: late.ranked.map((x) => ({ ...x, preempt: false })) };
    const r2 = rerank(morning.top3, calm);
    expect(r2.top3).toEqual(['a', 'b', 'c']);
    expect(r2.rerankReady).toBe(3);
  });

  it('drops an item that left the ranking (closed for you) and fills from the new order', () => {
    const next = rankWork(inputs({ now: at('09:05'), items: [a, { ...b, status: 'done' }, c, d] }));
    const r = rerank(shown, next);
    expect(r.top3).not.toContain('b');
    expect(r.top3).toHaveLength(3);
  });
});
