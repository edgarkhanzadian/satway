import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { APP_ORIGIN, BLACK_HOLE_PROXY } from './src/config.js';

const ci = Boolean(process.env.CI);

const VISUAL_SPEC = /q5-visual(?:-withdraw)?\.spec\.ts$/;
const BASELINES = fileURLToPath(new URL('./visual-baselines', import.meta.url));

function haveBaselines(): boolean {
  if (!existsSync(BASELINES)) return false;
  return readdirSync(BASELINES).some(f => f.endsWith(`-visual-${process.platform}.png`));
}

const visual = process.env.E2E_VISUAL === '1' || haveBaselines();

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/../visual-baselines/{arg}-{projectName}-{platform}{ext}',
  globalSetup: './src/global-setup.ts',
  fullyParallel: true,
  forbidOnly: ci,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: VISUAL_SPEC },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /@webkit/,
      testIgnore: VISUAL_SPEC,
    },
    ...(visual
      ? [{ name: 'visual', use: { ...devices['Desktop Chrome'] }, testMatch: VISUAL_SPEC }]
      : []),
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
