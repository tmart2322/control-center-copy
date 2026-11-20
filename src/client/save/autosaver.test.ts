import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosaver, type AutosaveSnapshot } from './autosaver';

describe('Autosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not save the initial value, debounces, then saves once', async () => {
    const save = vi.fn(async () => undefined);
    const states: AutosaveSnapshot['state'][] = [];
    const a = new Autosaver<string>('a', { save, debounceMs: 1000, onChange: (s) => states.push(s.state) });
    a.update('a');
    expect(save).not.toHaveBeenCalled();
    a.update('ab');
    a.update('abc');
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
    expect(a.snapshot.state).toBe('saved');
    expect(states).toContain('dirty');
    expect(states).toContain('saving');
  });

  it('flush saves immediately (blur / navigation)', async () => {
    const save = vi.fn(async () => undefined);
    const a = new Autosaver<string>('', { save });
    a.update('x');
    await a.flush();
    expect(save).toHaveBeenCalledWith('x');
  });

  it('queues a change made during an in-flight save and never overlaps saves', async () => {
    let resolve!: () => void;
    const save = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const a = new Autosaver<string>('', { save, debounceMs: 10 });
    a.update('one');
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1);
    a.update('two');
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(1); // still in flight
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('two');
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.snapshot.state).toBe('saved');
  });

  it('keeps the pending value after a failure and retries', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('upstream_unavailable')).mockResolvedValueOnce(undefined);
    const a = new Autosaver<string>('', { save });
    a.update('x');
    await a.flush();
    expect(a.snapshot).toMatchObject({ state: 'error', error: 'upstream_unavailable' });
    await a.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(a.snapshot.state).toBe('saved');
  });

  it('typing back to the saved value cancels the pending save', async () => {
    const save = vi.fn(async () => undefined);
    const a = new Autosaver<string>('same', { save, debounceMs: 100 });
    a.update('changed');
    a.update('same');
    await vi.advanceTimersByTimeAsync(200);
    expect(save).not.toHaveBeenCalled();
  });
});
