import type { Clock } from '@/server/ports';

/**
 * Mock clock. Runs in real time from a configurable anchor:
 * - CC_MOCK_NOW=seed (default): the seed's asOf (already rebased onto today), so the cockpit always
 *   looks like the morning the seed was captured.
 * - CC_MOCK_NOW=real: wall-clock time.
 * - CC_MOCK_NOW=<ISO instant> or HH:MM (today, local time).
 * The scenario clock resets/seeks it so screenshots are deterministic.
 */
export class MockClock implements Clock {
  private anchorMs: number;
  private startedRealMs: number;
  private frozenAt: number | null = null;

  constructor(private readonly seedAnchor: Date, mode: string | undefined = process.env.CC_MOCK_NOW) {
    this.startedRealMs = Date.now();
    this.anchorMs = MockClock.resolveAnchor(seedAnchor, mode);
  }

  static resolveAnchor(seedAnchor: Date, mode: string | undefined): number {
    const m = (mode ?? 'seed').trim();
    if (m === '' || m === 'seed') return seedAnchor.getTime();
    if (m === 'real') return Date.now();
    const hhmm = /^(\d{1,2}):(\d{2})$/.exec(m);
    if (hhmm) {
      const d = new Date();
      d.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0);
      return d.getTime();
    }
    const parsed = Date.parse(m);
    if (!Number.isNaN(parsed)) return parsed;
    console.warn(`[mock] CC_MOCK_NOW=${m} not understood; using the seed time`);
    return seedAnchor.getTime();
  }

  now(): Date {
    if (this.frozenAt !== null) return new Date(this.frozenAt);
    return new Date(this.anchorMs + (Date.now() - this.startedRealMs));
  }

  /** Back to the anchor (+ offsetSec), then keep running in real time. */
  reset(offsetSec = 0): void {
    this.startedRealMs = Date.now();
    this.anchorMs = MockClock.resolveAnchor(this.seedAnchor, process.env.CC_MOCK_NOW) + offsetSec * 1000;
    if (this.frozenAt !== null) this.frozenAt = this.anchorMs;
  }

  /** Tests: stop time. */
  freeze(at?: Date): void {
    this.frozenAt = (at ?? this.now()).getTime();
  }

  advance(ms: number): void {
    if (this.frozenAt !== null) this.frozenAt += ms;
    else this.anchorMs += ms;
  }
}
