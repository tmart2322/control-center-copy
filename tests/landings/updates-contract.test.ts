/**
 * 2026-11-14 integration: the re-derive's update candidates carry Duration__c as numbers (0.25 → 5.25); the route
 * that files them in Log it took strings only, so the first live hand-off was refused. Both are accepted, as text.
 */
import { describe, expect, it } from 'vitest';
import { ProposeEventUpdatesRequest } from '../../src/contract';

describe('POST /time/updates takes the re-derive as it comes', () => {
  it('numbers or strings, stored as text', () => {
    const base = { activityEntryId: '11111111-1111-4111-8111-111111111111', org62EventId: '00U000000000001AAA', field: 'Duration__c', reason: 're-derived: placeholder' };
    const r = ProposeEventUpdatesRequest.safeParse({ candidates: [{ ...base, from: 0.25, to: 5.25 }, { ...base, from: '1', to: '0.25' }] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.candidates.map((c) => [c.from, c.to])).toEqual([
      ['0.25', '5.25'],
      ['1', '0.25'],
    ]);
  });
});
