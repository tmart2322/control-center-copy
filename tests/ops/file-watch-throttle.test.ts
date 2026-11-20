/**
 * COST-2: Claude-session file changes start at most one scan per window. Busy parallel sessions write transcripts
 * nonstop; a scan per 5 s debounce cost $6/day (3,142 runs). Changes inside the window coalesce into the next run.
 */
import { describe, expect, it } from 'vitest';
import { FILE_WATCH_MIN_S, nextFileWatchAt } from '../../src/worker/scanning';

const MIN = FILE_WATCH_MIN_S * 1000;

describe('nextFileWatchAt', () => {
  it('the first change scans now', () => {
    expect(nextFileWatchAt(Number.NEGATIVE_INFINITY, 1_000_000, MIN)).toBe(1_000_000);
  });

  it('a change inside the window waits for its end; after the window, now again', () => {
    const t0 = 10_000_000;
    expect(nextFileWatchAt(t0, t0 + 5_000, MIN)).toBe(t0 + MIN);
    expect(nextFileWatchAt(t0, t0 + MIN - 1, MIN)).toBe(t0 + MIN);
    expect(nextFileWatchAt(t0, t0 + MIN, MIN)).toBe(t0 + MIN);
    expect(nextFileWatchAt(t0, t0 + MIN + 1, MIN)).toBe(t0 + MIN + 1);
  });

  it('a change while a scan is already scheduled joins it and never pushes it out', () => {
    const scheduled = 10_000_000 + MIN;
    expect(nextFileWatchAt(scheduled, scheduled - 1_000, MIN)).toBe(scheduled);
    expect(nextFileWatchAt(scheduled, scheduled - MIN + 1, MIN)).toBe(scheduled);
  });

  it('a day of nonstop changes every 5 s is at most one scan per window (288 at 5 min, not 17,280)', () => {
    let last = Number.NEGATIVE_INFINITY;
    const runs = new Set<number>();
    for (let t = 0; t < 86_400_000; t += 5_000) {
      last = nextFileWatchAt(last, t, MIN);
      runs.add(last);
    }
    expect(FILE_WATCH_MIN_S).toBe(300);
    expect(runs.size).toBeLessThanOrEqual(289);
  });

  it('0 turns the window off', () => {
    expect(nextFileWatchAt(1000, 1001, 0)).toBe(1001);
  });
});
