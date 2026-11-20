/**
 * The live client (src/client/live.ts, src/client/intent.ts, docs/UX.md "Live updates"): a burst refetches once,
 * chatty topics at most every 1.5 s with a trailing refetch, the clock is an event (a meeting starting), and the
 * app tells the user's own changes from changes made elsewhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idsOfInput, isLocalChange, LOCAL_ANY_MS, LOCAL_ID_MS, noteGesture, noteLocalWrite, resetIntent } from '@/client/intent';
import { CHATTY_MS, nextBoundary, QUIET_MS, TopicScheduler } from '@/client/live';
import { homeInOrder, homeKeyEntity } from '@/components/home/live';
import { catchUpSignature } from '@/server/datasource/db/catch-up';
import type { HomePayload } from '@/contract';

describe('coalescing (TopicScheduler)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a burst of events on a topic refetches it once', () => {
    const runs: string[][] = [];
    const s = new TopicScheduler((t) => runs.push(t));
    for (let i = 0; i < 25; i++) s.add('outbox');
    s.add('draft');
    vi.advanceTimersByTime(QUIET_MS + 5);
    expect(runs).toEqual([['outbox', 'draft']]);
  });

  it('a chatty topic refetches at most every CHATTY_MS, with one trailing run for the last change', () => {
    const runs: string[][] = [];
    const s = new TopicScheduler((t) => runs.push(t));
    s.add('jobs');
    vi.advanceTimersByTime(QUIET_MS + 5);
    expect(runs).toHaveLength(1);
    // events keep coming for a second: no run before the interval is up
    for (let i = 0; i < 10; i++) {
      s.add('jobs');
      vi.advanceTimersByTime(100);
    }
    expect(runs).toHaveLength(1);
    vi.advanceTimersByTime(CHATTY_MS);
    expect(runs).toHaveLength(2);
    expect(s.waiting).toEqual([]);
  });

  it('a quiet topic is not held back by a chatty one', () => {
    const runs: string[][] = [];
    const s = new TopicScheduler((t) => runs.push(t));
    s.add('jobs');
    vi.advanceTimersByTime(QUIET_MS + 5);
    s.add('jobs');
    s.add('outbox');
    vi.advanceTimersByTime(QUIET_MS + 5);
    expect(runs).toEqual([['jobs'], ['outbox']]);
    vi.advanceTimersByTime(CHATTY_MS);
    expect(runs).toEqual([['jobs'], ['outbox'], ['jobs']]);
  });
});

describe('the clock is an event (nextBoundary)', () => {
  const now = Date.parse('2026-11-14T15:00:00.000Z');
  it('finds the next meeting start or end ahead, within 12 h', () => {
    const data = { ribbon: { blocks: [{ start: '2026-11-14T14:00:00.000Z', end: '2026-11-14T15:30:00.000Z' }, { start: '2026-11-14T16:00:00.000Z', end: '2026-11-14T17:00:00.000Z' }] } };
    expect(nextBoundary(data, now)).toBe(Date.parse('2026-11-14T15:30:00.000Z'));
  });

  it('ignores times in the past, beyond 12 h, and computed ones (a next read is not a boundary)', () => {
    const data = { nextReadAt: '2026-11-14T15:01:00.000Z', at: '2026-11-14T15:02:00.000Z', items: [{ due: '2026-11-16T15:00:00.000Z' }, { start: '2026-11-14T10:00:00.000Z' }] };
    expect(nextBoundary(data, now)).toBeNull();
  });
});

describe("mine or elsewhere (intent)", () => {
  beforeEach(() => resetIntent());

  it('reads the ids a write names: params, and body id / ids / …Id / …Ids', () => {
    expect(idsOfInput({ params: { id: 'd1', verb: 'approve' }, body: { ifVersion: 3, ids: ['a', 'b'], draftId: 'd2', patch: { oppId: 'o1' } } }).sort()).toEqual(['a', 'approve', 'b', 'd1', 'd2', 'o1'].sort());
    expect(idsOfInput(undefined)).toEqual([]);
  });

  it("a write's ids leave as mine for a minute (approve → undo window → send)", () => {
    const t = 1_000_000;
    noteLocalWrite(['d1'], t);
    expect(isLocalChange('d1', t + 15_000)).toBe(true);
    expect(isLocalChange('d1', t + LOCAL_ID_MS + 1)).toBe(false);
    expect(isLocalChange('d2', t + 15_000)).toBe(false);
  });

  it('right after a click that wrote something, any departure is mine (briefly)', () => {
    const t = 2_000_000;
    noteGesture(t);
    noteLocalWrite([], t + 200);
    expect(isLocalChange('anything', t + 200 + LOCAL_ANY_MS - 1)).toBe(true);
    expect(isLocalChange('anything', t + 200 + LOCAL_ANY_MS + 1)).toBe(false);
  });

  it('a background write with no gesture opens no window', () => {
    const t = 3_000_000;
    noteLocalWrite([], t);
    expect(isLocalChange('x', t + 10)).toBe(false);
  });
});

describe('Home in the merged order', () => {
  const card = (id: string) => ({ id, rank: 0, title: id }) as unknown as HomePayload['doNow']['cards'][number];
  const row = (id: string) => ({ id, title: id }) as unknown as HomePayload['sections'][number]['rows'][number];
  const home = { doNow: { cards: [card('c1'), card('c2'), card('c3')], total: 3 }, sections: [{ id: 'reply', rows: [row('r1'), row('r2')] }] } as unknown as HomePayload;

  it('keeps Do now to three while a card fades out (the one replacing it waits), and renumbers', () => {
    const order = [{ id: 'c:c1', card: card('c1') }, { id: 'c:gone', card: card('gone') }, { id: 'c:c2', card: card('c2') }, { id: 'c:c3', card: card('c3') }];
    const h = homeInOrder(home, order as never);
    expect(h.doNow.cards.map((c) => c.id)).toEqual(['c1', 'gone', 'c2']);
    expect(h.doNow.cards.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  it('puts rows back in their sections in the merged order', () => {
    const h = homeInOrder(home, [{ id: 'r:reply:r2', section: 'reply', row: row('r2') }, { id: 'r:reply:r1', section: 'reply', row: row('r1') }] as never);
    expect(h.sections[0]!.rows.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('names the entity behind a Home key (what a write names)', () => {
    expect(homeKeyEntity('c:w_1')).toBe('w_1');
    expect(homeKeyEntity('r:reply:w_2')).toBe('w_2');
  });
});

describe("the worker's catch-up progress is pushed when it moves", () => {
  it('changes per 5 % step and when a connector starts or stops catching up, not per beat', () => {
    expect(catchUpSignature({ gmail: 41 })).toBe(catchUpSignature({ gmail: 44 }));
    expect(catchUpSignature({ gmail: 44 })).not.toBe(catchUpSignature({ gmail: 45 }));
    expect(catchUpSignature({ gmail: 44, slack: 10 })).not.toBe(catchUpSignature({ gmail: 44 }));
    expect(catchUpSignature({})).toBe('');
  });
});
