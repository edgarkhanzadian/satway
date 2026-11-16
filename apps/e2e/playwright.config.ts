import { defineConfig, devices } from '@playwright/test';

import { APP_ORIGIN, BLACK_HOLE_PROXY } from './src/config.js';

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  globalSetup: './src/global-setup.ts',
  fullyParallel: true,
  forbidOnly: ci,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: APP_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    acceptDownloads: true,
    serviceWorkers: 'block',
    locale: 'en-US',
    timezoneId: 'UTC',
    launchOptions: { proxy: BLACK_HOLE_PROXY },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@webkit/ },
  ],
  webServer: {
    command: 'tsx scripts/serve-web.ts',
    url: `${APP_ORIGIN}/__e2e/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
