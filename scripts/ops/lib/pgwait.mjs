// Wait for Postgres with exponential backoff (pg_isready). Used by the launchd service wrapper so the
// worker and web don't crash-loop at login before Homebrew's Postgres is up.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { pg17Bin } from './brew.mjs';

const PG17 = join(pg17Bin(), 'pg_isready');

export const pgIsReady = (host = 'localhost', port = 5432) =>
  new Promise((resolve) => {
    const bin = existsSync(PG17) ? PG17 : 'pg_isready';
    execFile(bin, ['-h', host, '-p', String(port), '-t', '3'], { timeout: 6000 }, (err) => resolve(!err));
  });

export function backoffDelay(attempt, { baseMs = 1000, maxMs = 30000 } = {}) {
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 10));
}

/**
 * Resolves true when ready. Never gives up unless `signal` aborts (then false).
 * `check`, `sleep` and `log` are injectable for tests.
 */
/** @param {{check?: () => Promise<boolean>, sleep?: (ms: number) => Promise<void>, log?: (m: string) => void, signal?: AbortSignal}} [opts] */
export async function waitForPostgres({ check = pgIsReady, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {}, signal } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) return false;
    if (await check()) return true;
    const delay = backoffDelay(attempt);
    if (attempt === 0 || attempt % 5 === 0) log(`postgres not ready (attempt ${attempt + 1}); retrying in ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
}
