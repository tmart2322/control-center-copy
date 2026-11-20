/**
 * BE-1b DbDataSource suite against Postgres 17 (control_center_be1b_test, dropped and recreated per run).
 *   npm run test:be1b
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const TEST_DATABASE_URL = process.env.BE1B_DATABASE_URL ?? 'postgres://localhost:5432/control_center_be1b_test';

export default defineConfig({
  root,
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  test: {
    setupFiles: ['tests/setup/ledger-gaps.ts'], // D0: no booked call without its audit fields or tokens
    include: ['tests/be1b/**/*.test.ts'],
    globalSetup: ['tests/be1b/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      BE1B_DATABASE_URL: TEST_DATABASE_URL,
      CC_BE1B: '1',
      CC_SEED_PATH: path.resolve(root, 'src/mock/seed.example.json'),
      CC_SCENARIO: '0',
      CC_MOCK_NOW: 'seed',
      // the placeholder seed stays on its own date (Thu 5 Nov): rebased onto today, its weekdays moved, and tests that
      // read "Wednesday" or "due Monday" failed on Mondays (2026-11-16)
      CC_SEED_REBASE: '0',
      CC_VALIDATE_RESPONSES: '1',
    },
  },
});
