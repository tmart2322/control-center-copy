/**
 * The web app's live bus (src/server/datasource/db/events.ts, 2026-11-14 live pass): it hears what the worker
 * publishes itself (cc_live) as well as the audit trigger (cc_change), never twice for one change set; the unaudited
 * tables' trigger (0026_live_notify, `tx:` change sets) reaches their topics without the ⌘Z `audit` topic; and a
 * worker that stops beating is announced on `health` once, when it flips.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveEvent } from '@/contract';
import { PgEventBus } from '@/server/datasource/db/events';

function busWithSpy() {
  const bus = new PgEventBus('postgres://localhost:1/none', { now: () => new Date('2026-11-14T15:00:00.000Z') });
  const got: LiveEvent[] = [];
  // listen without subscribe(): subscribe() would open a LISTEN connection
  (bus as unknown as { listeners: Set<(e: LiveEvent) => void> }).listeners.add((e) => got.push(e));
  return { bus, got };
}

const change = (cs: string, table: string, id: string, op = 'update') => JSON.stringify({ cs, entity_type: table, entity_id: id, table, op });
const wire = (t: string, i: string[], r: string, cs?: string) => JSON.stringify({ o: 'worker-1', t, i, r, a: '2026-11-14T15:00:00.000Z', ...(cs ? { cs } : {}) });

describe('the web bus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("delivers the worker's own events (cc_live): a scan's progress reaches the web", () => {
    const { bus, got } = busWithSpy();
    bus.receive('cc_live', wire('scans', [], 'scanner.progress', 'cs-quiet'));
    bus.receive('cc_live', wire('health', [], 'catchup.progress'));
    expect(got.map((e) => [e.topic, e.reason])).toEqual([
      ['scans', 'scanner.progress'],
      ['health', 'catchup.progress'],
    ]);
  });

  it('never delivers one change set twice (cc_change first, then the worker publishes it on cc_live)', () => {
    const { bus, got } = busWithSpy();
    bus.receive('cc_change', change('cs-1', 'drafts', 'd1'));
    vi.advanceTimersByTime(50);
    const after = got.length;
    expect(got.map((e) => e.topic)).toEqual(expect.arrayContaining(['outbox', 'draft', 'audit']));
    bus.receive('cc_live', wire('outbox', ['d1'], 'draft.updated', 'cs-1'));
    expect(got.length).toBe(after);
  });

  it("a `tx:` batch (an unaudited table's trigger) reaches its topics, without the audit topic", () => {
    const { bus, got } = busWithSpy();
    bus.receive('cc_change', change('tx:991', 'jobs', '42', 'insert'));
    bus.receive('cc_change', change('tx:992', 'vdp_records', '', 'update'));
    vi.advanceTimersByTime(50);
    const topics = got.map((e) => e.topic);
    expect(topics).toEqual(expect.arrayContaining(['jobs', 'health', 'deals', 'time']));
    expect(topics).not.toContain('audit');
    // a statement-level notice names no row
    expect(got.find((e) => e.topic === 'deals')!.ids).toEqual([]);
    expect(got.find((e) => e.topic === 'jobs')!.ids).toEqual(['42']);
  });

  it('ignores a cc_live message for an unknown topic', () => {
    const { bus, got } = busWithSpy();
    bus.receive('cc_live', wire('nope', [], 'x'));
    expect(got).toEqual([]);
  });

  it("announces the worker's heartbeat flipping (gone, back), not every reading", () => {
    const { bus, got } = busWithSpy();
    bus.noteWorker(true); // first reading: nothing to announce
    bus.noteWorker(true);
    expect(got).toEqual([]);
    bus.noteWorker(false);
    bus.noteWorker(false);
    bus.noteWorker(true);
    expect(got.map((e) => [e.topic, e.reason])).toEqual([
      ['health', 'worker.down'],
      ['health', 'worker.up'],
    ]);
  });
});
