/**
 * The worker's first-scan configuration (B-080 ← B-079): the lookback and the one-time backfill budget you chose
 * during onboarding, read from `user_settings` key `onboarding` → `firstScan {lookbackDays, budgetUsd}`.
 *
 * Precedence, per field: the worker's flags (--lookback-days, --backfill-budget, --scope-days), then the env
 * (CC_FIRST_SCAN_LOOKBACK_DAYS, CC_FIRST_SCAN_BUDGET_USD, CC_FIRST_SCAN_CONNECTORS, CC_FIRST_SCAN_SCOPE_DAYS), then
 * the onboarding choice, then the defaults (DEFAULT_FIRST_SCAN_DAYS, $25 (DEFAULT_BACKFILL_BUDGET_USD), the six first-scan sources). So a staged
 * ramp or a scripted install still sets its own, and a browser onboarding needs no env at all. `0` days = off.
 *
 * When it is read: once, when the worker starts scanning for a user. The worker waits for a user to exist, so one
 * that was already running when onboarding finished reads it then. Two waits keep it from planning a 30-day
 * default too early:
 *  - a user row that nothing set up yet (no onboarding record and no `cc.meta`: CC_USER_EMAIL made the row, and the
 *    browser onboarding hasn't finished) waits until one of them lands;
 *  - onboarding's bootstrap lands a moment before its record, so while this database's onboarding draft is still on
 *    disk (deleted right after the record) it waits up to 30 s for the record.
 *
 * Only the first scan's start uses it: a first scan already under way (`first-scan.json`) keeps its own lookback.
 */
import { DEFAULT_BACKFILL_BUDGET_USD } from '@/contract';
import { existsSync, readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { DEFAULT_FIRST_SCAN_DAYS, FileFirstScanLedger, FirstScan, firstScanFromEnv, type FirstScanConfig, type FirstScanLedger } from '@/scanner/runtime/first-scan';
import { META_KEY } from '@/server/datasource/db/store/settings';
import { draftPath } from '@/server/onboarding/drafts';

/** `user_settings` key of the onboarding record (db/onboarding.ts ONBOARDING_KEY; not imported: it pulls the web's onboarding in). */
export const ONBOARDING_KEY = 'onboarding';

/** The onboarding record's first-scan choice (null: none recorded, or not readable). */
export interface OnboardingFirstScan {
  lookbackDays: number;
  budgetUsd: number;
}

export async function readOnboardingFirstScan(db: Db, userId: string): Promise<OnboardingFirstScan | null> {
  const r = await db.execute<{ v: unknown }>(sql`select value as v from user_settings where owner_user_id = ${userId} and key = ${ONBOARDING_KEY} limit 1`);
  const fs = (r.rows[0]?.v as { firstScan?: { lookbackDays?: unknown; budgetUsd?: unknown } } | undefined)?.firstScan;
  const days = Number(fs?.lookbackDays);
  const budget = Number(fs?.budgetUsd);
  if (!fs || !Number.isFinite(days) || days < 0) return null;
  return { lookbackDays: days, budgetUsd: Number.isFinite(budget) && budget >= 0 ? budget : DEFAULT_BACKFILL_BUDGET_USD };
}

/** Has anything set this user up: the web onboarding's record, or a bootstrap (`cc.meta`, its last write)? */
export async function userSetUp(db: Db, userId: string): Promise<boolean> {
  const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from user_settings where owner_user_id = ${userId} and key in (${ONBOARDING_KEY}, ${META_KEY})`);
  return (r.rows[0]?.n ?? 0) > 0;
}

/**
 * The config: env and flags first, the onboarding choice next, the defaults last (see the header). Pure apart from
 * its inputs.
 */
export function firstScanConfigFrom(choice: OnboardingFirstScan | null, env: Record<string, string | undefined> = process.env, argv: string[] = process.argv, defaultDays = DEFAULT_FIRST_SCAN_DAYS): FirstScanConfig | undefined {
  const set = (v: string | undefined) => v !== undefined && v.trim() !== '';
  const merged = {
    ...env,
    ...(choice && !set(env.CC_FIRST_SCAN_LOOKBACK_DAYS) ? { CC_FIRST_SCAN_LOOKBACK_DAYS: String(choice.lookbackDays) } : {}),
    ...(choice && !set(env.CC_FIRST_SCAN_BUDGET_USD) ? { CC_FIRST_SCAN_BUDGET_USD: String(choice.budgetUsd) } : {}),
  };
  return firstScanFromEnv(merged, argv, defaultDays);
}

/** Is a web onboarding for this database still writing (its draft is on disk)? */
export function onboardingDraftPending(database: string, file = draftPath()): boolean {
  if (!existsSync(file)) return false;
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { database?: unknown }).database === database;
  } catch {
    return false;
  }
}

export interface FirstScanForOptions {
  /** current_database(), for the draft check (default: asked). */
  database?: string;
  env?: Record<string, string | undefined>;
  argv?: string[];
  log?: (msg: string, detail?: Record<string, unknown>) => void;
  /** How long to wait for the record while the onboarding draft is still on disk (default 30 s). */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  pending?: (database: string) => boolean;
  /** The worker is shutting down: stop waiting for onboarding. */
  stopping?: () => boolean;
  /** Where the first scan keeps its state (default: `<CC_STATE_DIR>/first-scan.json`). */
  ledger?: FirstScanLedger;
}

/**
 * What the worker hands the scanner (ScannerRuntimeDeps.firstScan): a FirstScan on the state folder's ledger, or
 * null when the first scan is off (0 days). Never throws: a failed read falls back to env and defaults.
 */
export async function firstScanFor(db: Db, userId: string, o: FirstScanForOptions = {}): Promise<FirstScan | null> {
  const env = o.env ?? process.env;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let choice: OnboardingFirstScan | null = null;
  try {
    // a bare user row (CC_USER_EMAIL) before onboarding: wait for it (scanning it now would ignore your choice)
    let waited = 0;
    while (!(await userSetUp(db, userId)) && !o.stopping?.()) {
      if (waited % 60_000 === 0) o.log?.('waiting for onboarding to finish (open /onboarding)');
      await sleep(5000);
      waited += 5000;
    }
    choice = await readOnboardingFirstScan(db, userId);
    if (!choice) {
      const database = o.database ?? (await db.execute<{ name: string }>(sql`select current_database() as name`)).rows[0]?.name ?? '';
      const pending = o.pending ?? ((d: string) => onboardingDraftPending(d));
      const until = Date.now() + (o.waitMs ?? 30_000);
      while (!choice && pending(database) && Date.now() < until) {
        await sleep(1000);
        choice = await readOnboardingFirstScan(db, userId);
      }
    }
  } catch {
    choice = null;
  }
  const cfg = firstScanConfigFrom(choice, env, o.argv ?? process.argv);
  const fromEnv = [env.CC_FIRST_SCAN_LOOKBACK_DAYS, env.CC_FIRST_SCAN_BUDGET_USD].some((v) => v !== undefined && v.trim() !== '');
  o.log?.('first scan config', { source: choice ? (fromEnv ? 'onboarding+env' : 'onboarding') : fromEnv ? 'env' : 'default', lookbackDays: cfg?.lookbackDays ?? 0, budgetUsd: cfg?.budgetUsd ?? 0 });
  return cfg ? new FirstScan(cfg, o.ledger ?? new FileFirstScanLedger()) : null;
}
