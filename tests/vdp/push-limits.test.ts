/**
 * Owner, 2026-11-14 ("Can we not have arbitrary limits like this?"): "Push 228 to VDP" failed with "items Array must
 * contain at most 50 element(s)". A push takes any number of items; VDP's real limits are paced, never refused:
 * 60 calls a minute (the shared limiter) and 20 Generates per 10 minutes (the run waits for the window).
 */
import { describe, expect, it } from 'vitest';

import { PushVdpChangesRequest } from '../../src/contract';
import { generateWaitMs, pushTimeoutSeconds, VDP_GENERATE_WINDOW_MS } from '../../src/server/vdp/push';

describe('a VDP push of any size', () => {
  it('takes 228 items (it was capped at 50)', () => {
    const items = Array.from({ length: 228 }, (_, i) => ({ itemKey: `placeholder-vdp:item-${i}` }));
    expect(PushVdpChangesRequest.safeParse({ items }).success).toBe(true);
    expect(PushVdpChangesRequest.safeParse({ items: [] }).success).toBe(false);
  });

  it("paces Generates to VDP's 20 per 10 minutes: the 21st waits for the window, never refused", () => {
    const t0 = 1_000_000;
    const twenty = Array.from({ length: 20 }, (_, i) => t0 + i * 1000);
    expect(generateWaitMs(twenty.slice(0, 19), t0 + 30_000)).toBe(0);
    // the 21st waits until the first of the last 20 leaves the window
    expect(generateWaitMs(twenty, t0 + 30_000)).toBe(t0 + VDP_GENERATE_WINDOW_MS - (t0 + 30_000));
    // starts older than the window don't count
    expect(generateWaitMs(twenty, t0 + VDP_GENERATE_WINDOW_MS + 20_000)).toBe(0);
  });

  it("the worker's time limit grows with the push: VDP's call rate for every item, and the Generate windows", () => {
    const plain = Array.from({ length: 228 }, () => ({ op: 'add_vdp_asset' }));
    expect(pushTimeoutSeconds(plain)).toBe(1800 + 228 * 10);
    const generates = Array.from({ length: 45 }, () => ({ op: 'generate_use_case' }));
    // 45 Generates: two extra 10-minute windows, 120 s each at most
    expect(pushTimeoutSeconds(generates)).toBe(1800 + 45 * 10 + 2 * 600 + 45 * 120);
    expect(pushTimeoutSeconds([])).toBe(1800);
  });
});
