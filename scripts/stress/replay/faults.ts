/**
 * Fault injection for replayed tools (Slack/Org62 in-process MCP servers and the Google client seam).
 * Rules are deterministic (seeded) so a scenario replays the same faults every time.
 */
export type FaultKind = 'rate_limit' | 'timeout' | 'server_error' | 'auth' | 'partial' | 'empty' | 'slow';

export interface FaultRule {
  kind: FaultKind;
  /** Tool name pattern (bare or full name). Default: every tool. */
  tool?: RegExp;
  /** Probability per call (seeded). */
  p?: number;
  /** 1-based call numbers (per injector) that fault. */
  nth?: number[];
  /** Fault every call after this many calls (auth expiring mid-run). */
  afterCalls?: number;
  /** Only while the simulated now is inside [from, to). */
  during?: { from: number; to: number };
  /** slow / timeout delay. */
  delayMs?: number;
}

export interface FaultDecision {
  kind: FaultKind;
  delayMs?: number;
}

export class FaultInjector {
  private n = 0;
  private seed: number;
  readonly fired: Record<string, number> = {};
  constructor(
    public rules: FaultRule[] = [],
    seed = 42,
    private readonly now: () => number = Date.now,
  ) {
    this.seed = seed >>> 0 || 1;
  }

  private rand(): number {
    // xorshift32
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 0x1_0000_0000;
  }

  /** Decide for one call. Returns the first matching rule's fault, if any. */
  decide(tool: string): FaultDecision | undefined {
    this.n += 1;
    const t = this.now();
    for (const r of this.rules) {
      if (r.tool && !r.tool.test(tool)) continue;
      if (r.during && (t < r.during.from || t >= r.during.to)) continue;
      // A rule with no trigger (only a tool and/or a `during` window) fires on every matching call.
      const hit = r.nth ? r.nth.includes(this.n) : r.afterCalls !== undefined ? this.n > r.afterCalls : r.p !== undefined ? this.rand() < r.p : true;
      if (hit) {
        this.fired[r.kind] = (this.fired[r.kind] ?? 0) + 1;
        return { kind: r.kind, delayMs: r.delayMs };
      }
    }
    return undefined;
  }

  get calls(): number {
    return this.n;
  }
}

/** Error text per source, shaped like the real failures so the production classifiers see real signatures. */
export const FAULT_TEXT: Record<'slack' | 'org62' | 'google', Record<Exclude<FaultKind, 'partial' | 'empty' | 'slow'>, string>> = {
  slack: { rate_limit: 'Error: ratelimited (429 Too Many Requests)', timeout: 'Error: request timed out (ETIMEDOUT)', server_error: 'Error: 503 Service Unavailable', auth: 'Error: invalid_auth' },
  org62: { rate_limit: 'REQUEST_LIMIT_EXCEEDED: TotalRequests Limit exceeded', timeout: 'Error: ETIMEDOUT', server_error: '503 Service Unavailable', auth: 'INVALID_SESSION_ID: Session expired or invalid' },
  google: { rate_limit: 'HttpError 429: rateLimitExceeded', timeout: 'deadline exceeded: ETIMEDOUT', server_error: 'HttpError 503: backendError', auth: 'invalid_grant: Token has been expired or revoked' },
};

export const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
