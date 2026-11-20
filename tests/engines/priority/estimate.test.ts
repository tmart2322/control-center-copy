/** Hands-on estimates: low defaults by kind, and calibration from recorded actuals (DESIGN-V2). */
import { describe, expect, it } from 'vitest';
import {
  approveBatchMin,
  calibrate,
  DEFAULT_HANDS_ON,
  defaultYouMin,
  estimateKindOf,
  estimateYouMin,
  makeEstimator,
  type EffortActual,
} from '@/engines/priority/estimate';
import { rankWork } from '@/engines/priority/rank';
import { at, inputs, item } from './fixtures';

describe('default hands-on estimates by kind', () => {
  it('match the design ranges and err low', () => {
    expect(defaultYouMin('reply')).toBeGreaterThanOrEqual(5);
    expect(defaultYouMin('reply')).toBeLessThanOrEqual(15);
    expect(defaultYouMin('post')).toBeLessThanOrEqual(15);
    expect(defaultYouMin('approve')).toBeGreaterThanOrEqual(2);
    expect(defaultYouMin('approve')).toBeLessThanOrEqual(5);
    expect(defaultYouMin('review')).toBeGreaterThanOrEqual(10);
    expect(defaultYouMin('review')).toBeLessThanOrEqual(20);
    expect(defaultYouMin('reauth')).toBe(2);
    // a build is kickoff ~10 plus review ~20, never the build's own duration
    expect(defaultYouMin('build')).toBe(DEFAULT_HANDS_ON.buildKickoff + DEFAULT_HANDS_ON.buildReview);
    expect(defaultYouMin('build')).toBe(30);
  });

  it('are configurable', () => {
    const est = makeEstimator({ defaults: { reply: 6, buildReview: 5 } });
    expect(estimateYouMin({ kind: 'ask', title: 'Reply to Dana', effort: {} }, est).youMin).toBe(6);
    expect(estimateYouMin({ kind: 'deliverable', title: 'Demo org build', effort: { agentMin: 120 } }, est).youMin).toBe(15);
  });

  it('classify items from the verb-first title, the kind and the agent split', () => {
    const k = (title: string, kind: Parameters<typeof estimateKindOf>[0]['kind'] = 'task', agentMin = 0) => estimateKindOf({ title, kind, effort: { youMin: 0, agentMin } });
    expect(k('Reply to Dana: same demo?')).toBe('reply');
    expect(k('Answer Dana before the prep')).toBe('reply');
    expect(k('Post a short status to the sizing thread')).toBe('post');
    expect(k('Send the field list to Sam')).toBe('post');
    expect(k('Approve 3 drafts')).toBe('approve');
    expect(k('Review the condensed deck')).toBe('review');
    expect(k('Smoke-test both demos')).toBe('review');
    expect(k('Re-auth VDP')).toBe('reauth');
    expect(k('Build the ACME demo org', 'deliverable', 180)).toBe('build');
    expect(k('Trailhead badges', 'training')).toBe('training');
    expect(k('Something for Globex', 'ask')).toBe('reply');
    expect(k('Expenses', 'travel')).toBe('other');
  });

  it('use the item’s own estimate when it has one, else the default', () => {
    const est = makeEstimator();
    expect(estimateYouMin({ kind: 'ask', title: 'Reply to Dana', effort: { youMin: 4, agentMin: 0 } }, est)).toEqual({ youMin: 4, source: 'item', kind: 'reply' });
    expect(estimateYouMin({ kind: 'ask', title: 'Reply to Dana', effort: { youMin: 0, agentMin: 0 } }, est)).toEqual({ youMin: 10, source: 'default', kind: 'reply' });
    expect(estimateYouMin({ kind: 'ask', title: 'Reply to Dana', effort: { youMin: Number.NaN } }, est).source).toBe('default');
  });

  it('batch approvals: the first draft at the approve default, each further one +1', () => {
    const est = makeEstimator();
    expect(approveBatchMin(0, est)).toBe(0);
    expect(approveBatchMin(1, est)).toBe(3);
    expect(approveBatchMin(3, est)).toBe(5);
  });
});

describe('calibrate (pure): per-kind multiplier and median from recent actuals', () => {
  const a = (estimateKind: EffortActual['estimateKind'], ...mins: number[]): EffortActual[] => mins.map((youMin) => ({ estimateKind, youMin, source: 'completed' as const }));

  it('returns nothing without actuals, so the defaults apply', () => {
    expect(calibrate([])).toEqual({});
    expect(calibrate([{ estimateKind: 'reply', youMin: 0 }, { estimateKind: 'reply', youMin: Number.NaN }])).toEqual({});
  });

  it('moves a default only part of the way on a few samples', () => {
    const c = calibrate(a('reply', 20));
    // raw ×2, shrunk with 2 pseudo-samples at ×1: 1 + 1 × 1/3
    expect(c.reply).toEqual({ kind: 'reply', n: 1, median: 20, multiplier: 1.33, youMin: 13 });
    expect(c.post).toBeUndefined();
  });

  it('uses the median once there are enough actuals', () => {
    const c = calibrate(a('reply', 4, 5, 6, 5, 50));
    expect(c.reply).toMatchObject({ n: 5, median: 5, multiplier: 0.5, youMin: 5 });
  });

  it('clamps runaway actuals', () => {
    const c = calibrate(a('reauth', 600, 600, 600, 600, 600));
    expect(c.reauth!.multiplier).toBe(4);
    expect(c.reauth!.youMin).toBe(8);
  });

  it('is wired into the engine: defaults are calibrated, own estimates are not', () => {
    const items = [
      item('sam', { title: 'Reply to Sam', kind: 'ask', due: at('16:00'), effort: { youMin: 0, agentMin: 0 } }),
      item('dana', { title: 'Reply to Dana', kind: 'ask', due: at('16:00'), effort: { youMin: 12, agentMin: 0 } }),
    ];
    const plain = rankWork(inputs({ items }));
    expect(plain.calibration).toEqual({});
    expect(plain.scores.sam!.effort.youMin).toBe(10);
    const learned = rankWork(inputs({ items, estimates: { actuals: a('reply', 4, 4, 5, 4, 4) } }));
    expect(learned.calibration.reply).toMatchObject({ n: 5, median: 4, youMin: 4 });
    expect(learned.scores.sam!.effort.youMin).toBe(4);
    expect(learned.scores.sam!.effortSource).toBe('calibrated');
    expect(learned.scores.dana!.effort.youMin).toBe(12);
    expect(learned.capacity.youMinToday).toBe(4 + 12);
    // the start-by uses the same planned minutes
    expect(learned.scores.sam!.startBy).toBe(at('15:41'));
  });
});
