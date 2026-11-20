/**
 * BE-0 database tests against Postgres 17 (control_center_be0, dropped and recreated per run).
 *   npx vitest run --config tests/be0/vitest.config.ts
 */
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export const TEST_DATABASE_URL = process.env.BE0_DATABASE_URL ?? 'postgres://localhost:5432/control_center_be0';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    setupFiles: ['tests/setup/ledger-gaps.ts'], // D0: no booked call without its audit fields or tokens
    include: ['tests/be0/**/*.test.ts'],
    globalSetup: ['tests/be0/global-setup.ts'],
    // One shared database: run files one at a time (tests inside a file are sequential too).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { DATABASE_URL: TEST_DATABASE_URL, BE0_DATABASE_URL: TEST_DATABASE_URL },
  },
});
