import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  test: {
    setupFiles: ['tests/setup/ledger-gaps.ts'], // D0: no booked call without its audit fields or tokens
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules/**', '.claude/**', 'e2e/**', 'tests/be0/**', 'tests/be1b/**'], // DB suites run via `npm run test:db` / `test:be1b` (own global setup)
    // Tests always use the committed placeholder seed, never the private fixture.
    env: {
      CC_SEED_PATH: path.resolve(root, 'src/mock/seed.example.json'),
      CC_SCENARIO: '0',
      CC_MOCK_NOW: 'seed',
      // the placeholder seed stays on its own date (Thu 5 Nov): rebased onto today, its weekdays moved, and tests that
      // read "Wednesday" or "due Monday" failed on Mondays (2026-11-16)
      CC_SEED_REBASE: '0',
    },
  },
});
