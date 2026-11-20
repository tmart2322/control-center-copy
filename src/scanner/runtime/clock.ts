/** Injectable clock, so the runtime can run inside BE-1's worker and in tests with simulated time. */
export interface Clock {
  now(): Date;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    }),
};

/** Manually advanced clock for tests. `sleep` advances time instantly. */
export class FakeClock implements Clock {
  private t: number;
  constructor(start: string | Date | number) {
    this.t = typeof start === 'number' ? start : new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(at: string | Date | number): void {
    this.t = typeof at === 'number' ? at : new Date(at).getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
  async sleep(ms: number): Promise<void> {
    this.t += ms;
  }
}
