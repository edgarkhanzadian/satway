import { defineConfig } from '@playwright/test';

import { APP_ORIGIN } from './src/config.js';
import { smokeEnvProblem } from './src/smoke/smoke-env.js';

if (process.env.CI) {
  throw new Error(
    'The real-wallet smoke test is manual only: it needs a human and real wallet extensions. It refuses to run in CI.'
  );
}

const problem = smokeEnvProblem(process.env);
if (problem !== null) throw new Error(problem);

export default defineConfig({
  testDir: './smoke',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/smoke',
  globalSetup: './src/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 30 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL: APP_ORIGIN, trace: 'off', video: 'off', locale: 'en-US' },
  webServer: {
    command: 'tsx scripts/serve-web.ts',
    url: `${APP_ORIGIN}/__e2e/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
