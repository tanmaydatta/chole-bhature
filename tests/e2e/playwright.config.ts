import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  globalSetup: './playwright.global-setup.ts',
  testDir: './test/playwright',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'api', testMatch: '**/*.api.spec.ts' },
    { name: 'browser', testMatch: '**/*.browser.spec.ts',
      use: { ...devices['Desktop Chrome'],
        channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' } },
  ],
});
