/**
 * "Start first scan" (B-079 → B-080): the one seam between onboarding and the scanner's first-run backfill.
 *
 * The DataSource saves the request with the onboarding record (db: `user_settings` key `onboarding`, field
 * `firstScan`). The worker reads it when it starts scanning for you (src/worker/first-scan-config.ts): it waits for a
 * user, so a worker already running when onboarding finishes picks the record up as soon as the user exists. The
 * lookback and the budget become its FirstScanConfig; CC_FIRST_SCAN_LOOKBACK_DAYS / CC_FIRST_SCAN_BUDGET_USD (or the
 * worker's --lookback-days / --backfill-budget flags) still override it. Nothing here starts a job.
 *
 *   savedFirstScan   db: `started` (the worker reads it), or `recorded` when this install's env sets its own lookback
 *   recordOnlyFirstScan   mock: `recorded` (nothing scans for real; the mock simulates the progress)
 */
import { durationText, firstScanMinutes, type FirstScanRequest, type LookbackDays } from '@/contract';

export interface FirstScanStart {
  lookbackDays: LookbackDays;
  budgetUsd: number;
  at: Date;
}

export interface FirstScanStarter {
  startFirstScan(req: FirstScanStart): Promise<FirstScanRequest>;
}

/** Mock: records the choice only. */
export const recordOnlyFirstScan: FirstScanStarter = {
  async startFirstScan({ lookbackDays, budgetUsd, at }) {
    return {
      lookbackDays,
      budgetUsd,
      requestedAt: at.toISOString(),
      status: 'recorded',
      message: `Saved: ${lookbackDays} days of history, up to $${budgetUsd} one-time. Mock mode: nothing is scanned; the first scan's progress is simulated.`,
    };
  },
};

/** The env the worker would use instead of the saved choice (the same keys `firstScanFromEnv` reads). */
export function envLookback(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env.CC_FIRST_SCAN_LOOKBACK_DAYS;
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Db: the worker reads the saved choice (src/worker/first-scan-config.ts). */
export function savedFirstScan(env: Record<string, string | undefined> = process.env): FirstScanStarter {
  return {
    async startFirstScan({ lookbackDays, budgetUsd, at }) {
      const base = { lookbackDays, budgetUsd, requestedAt: at.toISOString() };
      const override = envLookback(env);
      if (override !== null) {
        return {
          ...base,
          status: 'recorded',
          message:
            override > 0
              ? `Saved: ${lookbackDays} days, up to $${budgetUsd}. This install's environment sets the first scan to ${override} days (CC_FIRST_SCAN_LOOKBACK_DAYS), and that applies.`
              : `Saved: ${lookbackDays} days, up to $${budgetUsd}. This install's environment turns the first scan off (CC_FIRST_SCAN_LOOKBACK_DAYS=0); scanning starts with the last day only.`,
        };
      }
      return {
        ...base,
        status: 'started',
        message: `Your first scan reads ${lookbackDays} days of history, up to $${budgetUsd} one-time. It starts when the worker picks it up (within a minute) and takes ${durationText(firstScanMinutes(lookbackDays))}; a banner shows its progress.`,
      };
    },
  };
}

export function startFirstScan(req: FirstScanStart, starter: FirstScanStarter = recordOnlyFirstScan): Promise<FirstScanRequest> {
  return starter.startFirstScan(req);
}
