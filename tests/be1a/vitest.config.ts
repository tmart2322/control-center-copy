/**
 * BE-1a suite (worker runtime, DbScannerStore, live events) against Postgres 17.
 * The database control_center_be1a is dropped and recreated per run (global-setup.ts).
 *   npm run test:be1a
 * Files are `*.spec.ts` so the root `npm test` (tests/**\/*.test.ts) never picks them up without a database.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const TEST_DATABASE_URL = process.env.BE1A_DATABASE_URL ?? 'postgres://localhost:5432/control_center_be1a';

export default defineConfig({
  root,
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  test: {
    setupFiles: ['tests/setup/ledger-gaps.ts'], // D0: no booked call without its audit fields or tokens
    include: ['tests/be1a/**/*.spec.ts'],
    globalSetup: ['tests/be1a/global-setup.ts'],
    // One shared database: run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      BE1A_DATABASE_URL: TEST_DATABASE_URL,
      // Never touch the real state dir (heartbeat, pid file, notify state).
      CC_STATE_DIR: path.join(tmpdir(), `cc-be1a-state-${process.pid}`),
      CC_LIVE: process.env.CC_LIVE ?? '0',
    },
  },
});
