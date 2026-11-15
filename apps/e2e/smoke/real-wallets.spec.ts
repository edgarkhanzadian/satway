import { type BrowserContext, type Page, test as base, chromium, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SatwayApp } from '../src/app/satway-app.js';
import { type CanaryLog, routeThroughLocalWorker } from '../src/canary/canary-fixtures.js';
import { APP_ORIGIN } from '../src/config.js';
import { SMOKE_ENV, smokeEnvProblem } from '../src/smoke/smoke-env.js';
import { World } from '../src/world/world.js';

const HUMAN_TIMEOUT = 10 * 60_000;
const REJECTED = 'The request was rejected in your wallet, so nothing was sent.';

function say(...lines: string[]): void {
  process.stdout.write(`\n=== SMOKE: action needed ===\n${lines.join('\n')}\n\n`);
}

interface SmokeFixtures {
  wallets: BrowserContext;
  log: CanaryLog;
  page: Page;
  app: SatwayApp;
}

const test = base.extend<SmokeFixtures>({
  async log({}, use) {
    await use({ violations: [], realRequests: [], workerCalls: [] });
  },
  async wallets({ log }, use) {
    if (process.env.CI) throw new Error('The real-wallet smoke test refuses to run in CI.');
    const problem = smokeEnvProblem(process.env);
    if (problem !== null) throw new Error(problem);
    const extensions = [process.env[SMOKE_ENV.metamask], process.env[SMOKE_ENV.leather]].join(',');
    const profile =
      process.env[SMOKE_ENV.profile] ?? mkdtempSync(join(tmpdir(), 'satway-smoke-profile-'));
    const context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${extensions}`, `--load-extension=${extensions}`],
    });
    await routeThroughLocalWorker(context, log, { humanMayStartDeposit: true });
    await use(context);
    await context.close();
    expect(log.violations, 'nothing may be broadcast or registered').toEqual([]);
  },
  async page({ wallets }, use) {
    await use(await wallets.newPage());
  },
  async app({ page }, use) {
    await use(
      new SatwayApp(
        page,
        {
          async idle() {
            await page.waitForLoadState('networkidle');
          },
          touch() {
            return undefined;
          },
        },
        new World('satway smoke page object')
      )
    );
  },
});

test('real wallets: discovery, connect, a dry quote, and a send prompt the human rejects', async ({
  app,
  page,
}) => {
  await page.goto(`${APP_ORIGIN}/`);
  await expect(page.getByRole('heading', { name: 'satway', level: 1 })).toBeVisible();

  await expect(app.from.getByRole('button', { name: /MetaMask/ })).toBeVisible();
  await app.to.getByRole('button', { name: 'Connect Stacks wallet' }).click();
  await expect(page.locator('connect-modal').getByText('Leather')).toBeVisible();

  say(
    'In the Stacks wallet list, choose Leather and approve the connection in the Leather popup.',
    'The test only waits: it never touches the extension.'
  );
  await expect(app.to.getByText('Connected', { exact: true })).toBeVisible({
    timeout: HUMAN_TIMEOUT,
  });
  const stacks = await app.to.locator('code').first().getAttribute('title');
  expect(stacks).toMatch(/^SP[0-9A-Z]+$/);

  await app.from.getByRole('button', { name: /MetaMask/ }).click();
  say('Approve the connection in the MetaMask popup.');
  await expect(app.from.getByText(/MetaMask connected$/)).toBeVisible({ timeout: HUMAN_TIMEOUT });
  const evm = await app.from.locator('code').first().getAttribute('title');
  expect(evm).toMatch(/^0x[0-9a-fA-F]{40}$/);
  say(
    `Check these are your wallets' addresses: Stacks ${stacks ?? '?'}, EVM ${evm ?? '?'}.`,
    'If they are not, close the browser to stop the test.'
  );

  await app.fillDeposit({ asset: 'USDC on base', amount: '25' });
  await app.page.getByRole('button', { name: 'Get quote' }).click();
  await expect(app.definition('You receive about')).toBeVisible({ timeout: 60_000 });

  say(
    'Now, by hand: press Continue (this asks 1Click for a real swap address; nothing is paid),',
    'then press "Send from MetaMask", and REJECT the request in MetaMask.',
    'Do not approve anything. The test waits for the rejection message.'
  );
  await expect(app.sendError).toHaveText(REJECTED, { timeout: HUMAN_TIMEOUT });
  expect(await app.sendRecords()).toEqual([]);
  await expect(app.sendButton).toBeVisible();
});
