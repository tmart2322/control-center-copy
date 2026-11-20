/**
 * D6 (audit 2026-11-13): the pre-call budget guard of the relay jobs (`vdp.specialist_aes`, `accounts.hierarchy`,
 * `org62.readback`). Each lookup is a small model run that relays one read-only call; before, these jobs never asked
 * the daily hard cap. Now every lookup holds its own cost cap against it while it runs (reserve → call → book →
 * release), and a refused lookup is recorded as a decision (block `hard_cap_reserve`), so the job stops cleanly.
 */
import { DbScannerStore } from '@/scanner/store-db';

import type { JobContext } from '../types';

/** The relay skills' own per-run cap (skills/read-lookup.md, skills/org62-readback.md: budget_usd_per_run). */
export const RELAY_LOOKUP_CAP_USD = 0.03;

export interface RelayGuard {
  /** Run one lookup (and book its spend, inside `fn`) under a hold; `null` when the daily hard cap refused it. */
  run<T>(fn: () => Promise<T>): Promise<T | null>;
  /** Lookups the cap refused so far. */
  refused: number;
}

export function relayGuard(ctx: JobContext, skill: string, o: { capUsd?: number; store?: Pick<DbScannerStore, 'reserveSpend' | 'recordDecision'> } = {}): RelayGuard {
  const store = o.store ?? new DbScannerStore({ db: ctx.db, userId: ctx.userId, clock: ctx.clock });
  const trigger = typeof ctx.job.payload?.trigger === 'string' ? (ctx.job.payload.trigger as string) : 'schedule';
  const g: RelayGuard = {
    refused: 0,
    async run(fn) {
      const hold = await store.reserveSpend(o.capUsd ?? RELAY_LOOKUP_CAP_USD).catch(() => null);
      if (hold && !hold.ok) {
        g.refused += 1;
        await store.recordDecision({ skill, kind: 'block', reason: 'hard_cap_reserve', trigger, detail: { jobId: ctx.job.id ?? null, spentUsd: hold.spentUsd, heldUsd: hold.reservedUsd, capUsd: hold.hardCapUsd } });
        return null;
      }
      try {
        return await fn();
      } finally {
        await hold?.release();
      }
    },
  };
  return g;
}
