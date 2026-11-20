/**
 * BE-REEVAL DB suite (the `reevaluate` job end to end) against Postgres 17.
 *   npx vitest run --config tests/bereeval/vitest.config.ts
 * The database control_center_bereeval_<CC_TEST_DB_SUFFIX|main> is dropped and recreated per run (global-setup.ts).
 * Files are `*.spec.ts` so the root `npm test` (tests/**\/*.test.ts) never picks them up without a database;
 * the pure tests next to them (`*.test.ts`) run there.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { BEREEVAL_DATABASE_URL as TEST_DATABASE_URL } from './db-url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root,
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  test: {
    setupFiles: ['tests/setup/ledger-gaps.ts'], // D0: no booked call without its audit fields or tokens
    include: ['tests/bereeval/**/*.spec.ts'],
    globalSetup: ['tests/bereeval/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 600_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      BEREEVAL_DATABASE_URL: TEST_DATABASE_URL,
      CC_SEED_PATH: path.resolve(root, 'src/mock/seed.example.json'),
      CC_SCENARIO: '0',
      CC_MOCK_NOW: 'seed',
      // the placeholder seed stays on its own date (Thu 5 Nov): rebased onto today, its weekdays moved, and tests that
      // read "Wednesday" or "due Monday" failed on Mondays (2026-11-16)
      CC_SEED_REBASE: '0',
      CC_STATE_DIR: path.join(tmpdir(), `cc-bereeval-state-${process.pid}`),
      CC_LIVE: '0',
      CC_NOTIFY: '0',
    },
  },
});
