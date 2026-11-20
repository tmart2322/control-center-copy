/** DEEP-1: the "Still needed?" rule (an ask already over 30 days old when first seen waits in Triage). */
import { describe, expect, it } from 'vitest';
import { isStillNeeded, staleOnArrival, stillNeededReason, stillNeededWhy } from '@/engines/still-needed';

const SEEN = Date.parse('2026-11-06T12:00:00Z');
const days = (n: number) => SEEN - n * 86_400_000;

describe('DEEP-1 still needed?', () => {
  it('is about the origin against the first sighting, not about now', () => {
    expect(staleOnArrival({ originAt: days(31), firstSeenAt: SEEN })).toBe(true);
    expect(staleOnArrival({ originAt: days(29), firstSeenAt: SEEN })).toBe(false);
    expect(staleOnArrival({ originAt: new Date(days(90)).toISOString(), firstSeenAt: new Date(SEEN).toISOString() })).toBe(true);
    expect(staleOnArrival({ originAt: null, firstSeenAt: SEEN })).toBe(false);
  });

  it('keeps work due after it was first seen open; old due dates do not save it', () => {
    expect(staleOnArrival({ originAt: days(40), firstSeenAt: SEEN, dueAt: SEEN + 5 * 86_400_000 })).toBe(false);
    expect(staleOnArrival({ originAt: days(40), firstSeenAt: SEEN, dueAt: days(35) })).toBe(true);
  });

  it('marks the reason, and Triage groups by the mark (TRAIN-1 notices included)', () => {
    const reason = stillNeededReason(days(87), SEEN, 'scanner:slack');
    expect(reason).toBe('Asked 2026-08-11, 87 days before it was first seen: still needed? (scanner:slack)');
    expect(stillNeededWhy(reason)).toBe('Asked 2026-08-11, 87 days before it was first seen: still needed?');
    expect(stillNeededWhy(stillNeededReason(days(40), SEEN, 'backfill:DEEP-1'))).toBe('Asked 2026-09-27, 40 days before it was first seen: still needed?');
    expect(isStillNeeded({ state: 'suggested', closedReason: reason })).toBe(true);
    expect(isStillNeeded({ state: 'suggested', closedReason: 'Overdue since 2026-08-01 when first seen: still needed? (scanner:trainings)' })).toBe(true);
    expect(isStillNeeded({ state: 'suggested', closedReason: 'Proposed by scanner:slack (guess)' })).toBe(false);
    expect(isStillNeeded({ state: 'open', closedReason: reason })).toBe(false);
  });
});
