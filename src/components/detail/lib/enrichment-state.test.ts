/** Capture enrichment reads from the item and stops saying "Enriching…" once it is done, or past the wait. */
import { describe, expect, it } from 'vitest';
import { captureStatus, ENRICH_WAIT_MS, enrichmentView, isEnriching } from './enrichment-state';

const at = Date.parse('2026-11-11T10:00:00.000Z');
const chip = { id: 'c1', kind: 'asset' as const, label: 'Doc', reason: 'Title matches', status: 'suggested' as const };

describe('enrichmentView', () => {
  it('enriching while young, stale past the wait (no worker ran it), done when done', () => {
    const e = { status: 'enriching' as const, startedAt: new Date(at).toISOString(), chips: [] };
    expect(enrichmentView(e, at + 5_000)).toBe('enriching');
    expect(enrichmentView(e, at + ENRICH_WAIT_MS + 1)).toBe('stale');
    expect(isEnriching(e, at + ENRICH_WAIT_MS + 1)).toBe(false);
    expect(enrichmentView({ ...e, status: 'done' }, at + 1)).toBe('done');
    expect(enrichmentView(null, at)).toBe('none');
    expect(enrichmentView({ status: 'idle', startedAt: null, chips: [] }, at)).toBe('none');
    // no start time: keep the honest "looking" word (nothing to time out from)
    expect(enrichmentView({ ...e, startedAt: null }, at + 10 * ENRICH_WAIT_MS)).toBe('enriching');
  });
});

describe('captureStatus: a Capture row never says "Enriching…" forever', () => {
  const item = (status: 'enriching' | 'done', chips: (typeof chip)[] = []) => ({ enrichment: { status, startedAt: new Date(at).toISOString(), chips } });
  it('Enriching… while it looks, then Added (with what it found)', () => {
    expect(captureStatus(item('enriching'), at + 1_000)).toEqual({ text: 'Enriching…', looking: true });
    expect(captureStatus(item('done', [chip, { ...chip, id: 'c2' }]), at + 1_000)).toEqual({ text: 'Added · 2 related', looking: false });
    expect(captureStatus(item('done'), at + 1_000)).toEqual({ text: 'Added', looking: false });
  });
  it('the db path (an enrich job no worker handles): Added after the wait', () => {
    expect(captureStatus(item('enriching'), at + ENRICH_WAIT_MS + 1)).toEqual({ text: 'Added', looking: false });
  });
});
