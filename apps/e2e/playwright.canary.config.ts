import { defineConfig, devices } from '@playwright/test';

import { APP_ORIGIN } from './src/config.js';

export default defineConfig({
  testDir: './canary',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/canary',
  globalSetup: './src/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/canary' }]],
  use: {
    baseURL: APP_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [{ name: 'canary', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'tsx scripts/serve-web.ts',
    url: `${APP_ORIGIN}/__e2e/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
