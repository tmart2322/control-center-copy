/**
 * 2026-11-14: the activity row's details looped (about 3,000 renders a second, "Page Unresponsive"). useCachedFind
 * re-rendered on every cache event under its topic, and the panel's own useQuery on that topic emits observer events on
 * every render. Only data events may re-render it, which this test checks against a real QueryClient.
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { isCacheDataEvent } from './panel-shell';

describe('useCachedFind re-renders on data, never on an observer re-rendering', () => {
  it('a real cache: setOptions on an observer emits nothing that counts; new data does', async () => {
    const qc = new QueryClient();
    const seen: boolean[] = [];
    qc.getQueryCache().subscribe((ev) => seen.push(isCacheDataEvent(ev as never)));
    const obs = new QueryObserver(qc, { queryKey: ['time', 'week'], queryFn: async () => ({ entries: [] }), staleTime: Infinity });
    const unsub = obs.subscribe(() => undefined);
    await qc.getQueryCache().find({ queryKey: ['time', 'week'] })!.promise;
    const before = seen.filter(Boolean).length;
    // what every render of a component's useQuery does
    for (let i = 0; i < 20; i++) obs.setOptions({ queryKey: ['time', 'week'], queryFn: async () => ({ entries: [] }), staleTime: Infinity });
    expect(seen.filter(Boolean).length).toBe(before);
    qc.setQueryData(['time', 'week'], { entries: [{ id: 'x' }] });
    expect(seen.filter(Boolean).length).toBe(before + 1);
    unsub();
  });

  it('the event kinds', () => {
    expect(isCacheDataEvent({ type: 'added' })).toBe(true);
    expect(isCacheDataEvent({ type: 'removed' })).toBe(true);
    expect(isCacheDataEvent({ type: 'updated', action: { type: 'success' } })).toBe(true);
    expect(isCacheDataEvent({ type: 'updated', action: { type: 'fetch' } })).toBe(false);
    expect(isCacheDataEvent({ type: 'observerOptionsUpdated' })).toBe(false);
    expect(isCacheDataEvent({ type: 'observerResultsUpdated' })).toBe(false);
    expect(isCacheDataEvent({ type: 'observerAdded' })).toBe(false);
  });
});
