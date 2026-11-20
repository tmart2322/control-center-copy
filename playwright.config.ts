import { defineConfig, devices } from '@playwright/test';

// E2E specs live in e2e/. They expect a running dev server (`npm run dev:web`); nothing is started here.
const port = Number(process.env.PORT || 4327);

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
