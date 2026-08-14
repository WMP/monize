import { defineConfig, devices } from '@playwright/test';

// Manual, local-only, read-only regression config. Intentionally NOT the CI
// e2e config (../e2e/playwright.config.ts).
//
// Differences from the CI config that matter here:
//   - NO `globalSetup`: the CI setup registers a user, which is a write. This
//     harness never registers or seeds -- it logs in as an existing user.
//   - NO `webServer`: the orchestrator (scripts/run-comparison.mjs) owns the
//     app lifecycle so it can run BEFORE and AFTER sequentially against one
//     database. `BASE_URL` is injected per phase.
//   - `workers: 1` always: captures must be deterministic and never race.
//   - `retries: 0`: a read-only capture that needs a retry to agree with
//     itself is a signal, not noise -- surface it.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4801',
    // Pin the UI locale so label-based fallback selectors resolve to the base
    // English catalogue, matching the CI e2e config. Captured monetary text
    // still follows the logged-in user's own number-format preference, which
    // is identical across BEFORE/AFTER because it is the same account.
    locale: 'en',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
