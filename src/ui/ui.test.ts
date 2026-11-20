import { describe, expect, it } from 'vitest';
import { computePosition } from './floating';
import { fmtAgo, fmtMinutes, fmtUsd, initials } from './format';
import { redactSecrets } from './PanelBoundary';

describe('format', () => {
  it('formats minutes like the effort split', () => {
    expect(fmtMinutes(45)).toBe('45m');
    expect(fmtMinutes(100)).toBe('1h40m');
    expect(fmtMinutes(120)).toBe('2h');
    expect(fmtMinutes(65)).toBe('1h05m');
  });
  it('formats relative times', () => {
    expect(fmtAgo(1000, 1500)).toBe('just now');
    expect(fmtAgo(0, 5000)).toBe('5s ago');
    expect(fmtAgo(0, 3 * 3600_000)).toBe('3h ago');
    expect(fmtAgo(0, 3 * 86400_000)).toBe('3d ago');
  });
  it('formats money and initials', () => {
    expect(fmtUsd(0.42)).toBe('$0.42');
    expect(fmtUsd(15)).toBe('$15.00');
    expect(initials('Dana Reyes')).toBe('DR');
    expect(initials('ACME')).toBe('AC');
    expect(initials('acme corp', 1)).toBe('A');
  });
});

describe('computePosition', () => {
  const vp = { width: 1000, height: 800 };
  it('places below-start by default', () => {
    expect(computePosition({ top: 100, left: 50, width: 40, height: 20 }, { width: 200, height: 100 }, 'bottom-start', vp, 6)).toEqual({ top: 126, left: 50, side: 'bottom' });
  });
  it('flips when it would overflow', () => {
    const r = computePosition({ top: 760, left: 50, width: 40, height: 20 }, { width: 200, height: 100 }, 'bottom-start', vp, 6);
    expect(r.side).toBe('top');
    expect(r.top).toBe(654);
  });
  it('clamps into the viewport', () => {
    const r = computePosition({ top: 100, left: 980, width: 20, height: 20 }, { width: 200, height: 100 }, 'bottom-start', vp, 6);
    expect(r.left).toBe(792);
  });
});

describe('redactSecrets', () => {
  it('redacts credential-like text in error details', () => {
    const out = redactSecrets('failed: token=abcdef123456 bearer eyJhbGciOiJIUzI1NiJ9.x xoxb-1234567890-abc sk-ant-abcdefghijklmnop');
    expect(out).not.toMatch(/abcdef123456|eyJhbGciOiJIUzI1NiJ9|xoxb-1234567890|sk-ant-abcdefghijklmnop/);
  });
});
