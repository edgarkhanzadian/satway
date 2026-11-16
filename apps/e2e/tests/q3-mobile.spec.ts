import type { Locator, Page } from '@playwright/test';

import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { WITHDRAW_PROGRESS } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectNoHorizontalScroll } from '../src/quality/page-checks.js';
import { RECLAIM_COPY, reclaimControls } from '../src/scenario/reclaim.js';
import { openReceiptInYourDeposits, toReclaimable } from '../src/scenario/states.js';
import { startWithdrawal } from '../src/scenario/withdrawal.js';

const MIN_TAP = 44;

const SIZES = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
];

async function expectTapTarget(control: Locator, label: string): Promise<void> {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  if (!box) throw new Error(`${label} has no box`);
  expect(box.height, `${label} tap height`).toBeGreaterThanOrEqual(MIN_TAP);
  expect(box.width, `${label} tap width`).toBeGreaterThanOrEqual(MIN_TAP);
}

async function tap(control: Locator, label: string): Promise<void> {
  await expectTapTarget(control, label);
  await control.tap();
}

async function expectAddressesWrap(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  for (const code of await page.locator('main code').all()) {
    if (!(await code.isVisible())) continue;
    const box = await code.boundingBox();
    if (!box) continue;
    expect(box.x + box.width, `address ${await code.innerText()} fits`).toBeLessThanOrEqual(width);
  }
}

async function expectVerticalRoute(app: SatwayApp): Promise<void> {
  const items = await app.route.getByRole('listitem').all();
  expect(items).toHaveLength(4);
  let lastBottom = Number.NEGATIVE_INFINITY;
  let left: number | null = null;
  for (const item of items) {
    const box = await item.boundingBox();
    if (!box) throw new Error('A route stop has no box');
    expect(box.y).toBeGreaterThanOrEqual(lastBottom);
    left ??= box.x;
    expect(box.x).toBe(left);
    lastBottom = box.y + box.height - 1;
    const size = await item.evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(12);
  }
}

async function step(app: SatwayApp, name: string): Promise<void> {
  await app.harnessIdle();
  await expectNoHorizontalScroll(app.page, name);
  await expectAddressesWrap(app.page);
}

for (const size of SIZES) {
  test.describe(`Q3. ${size.width}x${size.height} with touch`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true });

    test('the main happy path: no horizontal scroll, 44px tap targets, wrapped addresses, vertical route', async ({
      app,
      world,
    }) => {
      await app.open();
      await step(app, 'landing');
      await tap(
        app.to.getByRole('button', { name: 'Connect Stacks wallet' }),
        'Connect Stacks wallet'
      );
      await app.page
        .locator('connect-modal')
        .getByRole('listitem')
        .filter({ hasText: 'Test Stacks Wallet' })
        .getByRole('button', { name: 'Connect' })
        .tap();
      await expect(app.to.getByText('Connected', { exact: true })).toBeVisible();
      await step(app, 'stacks connected');
      await tap(app.from.getByRole('button', { name: /Test EVM Wallet/ }), 'EVM wallet');
      await expect(app.from.getByText('Test EVM Wallet connected')).toBeVisible();
      await step(app, 'wallets connected');
      await expectTapTarget(app.amountInput, 'Amount');
      await app.amountInput.fill('100');
      await tap(app.page.getByRole('button', { name: 'Get quote' }), 'Get quote');
      await expect(app.definition('You receive about')).toBeVisible();
      await step(app, 'quote');
      const downloaded = app.page.waitForEvent('download');
      await tap(app.page.getByRole('button', { name: 'Continue' }), 'Continue');
      await downloaded;
      await app.waitForProgress(PROGRESS.awaitingFunds);
      await step(app, 'awaiting funds');
      await expectVerticalRoute(app);
      await tap(app.sendButton, 'Send');
      await expect(app.progress('Sent from your wallet.')).toBeVisible();
      await step(app, 'sent');
      await app.waitForProgress(PROGRESS.swapping);
      await step(app, 'swapping');
      const payout = world.completeSwap();
      await app.waitForProgress(PROGRESS.payoutUnconfirmed);
      await step(app, 'payout');
      world.mine(1);
      await app.waitForProgress(PROGRESS.minting);
      world.signers.mint(payout.outpoint);
      await app.waitForProgress(PROGRESS.done);
      await step(app, 'done');
      await expectVerticalRoute(app);
      await expectTapTarget(
        app.page.getByRole('button', { name: 'Start another' }),
        'Start another'
      );
      await expectTapTarget(
        app.page.getByRole('button', { name: 'Withdraw', exact: true }),
        'Withdraw tab'
      );
    });

    test('the reclaim flow', async ({ app, world, wallets }) => {
      const { started } = await toReclaimable(app, world);
      await step(app, 'reclaimable');
      await openReceiptInYourDeposits(app, started);
      await expect(app.progress(RECLAIM_COPY.signersMayMint)).toBeVisible();
      await step(app, 'recover');
      const controls = reclaimControls(app);
      await expectTapTarget(controls.output, 'Output to reclaim');
      await expectTapTarget(controls.to, 'Reclaim destination');
      await controls.to.fill(wallets.stacks.account.paymentAddress);
      await tap(controls.button, 'Reclaim BTC');
      await tap(controls.confirm, 'Sign and send');
      await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
      await step(app, 'reclaim sent');
    });

    test('your withdrawals: 44px tap targets and no horizontal scroll', async ({
      app,
      world,
      wallets,
    }) => {
      const { withdraw } = await startWithdrawal(app, world, wallets);
      await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
      await tap(app.page.getByRole('button', { name: 'Hide' }), 'Hide');
      const entry = withdraw.savedWithdrawal('50,000 sats to USDC on base');
      await expect(entry).toHaveCount(1);
      await step(app, 'your withdrawals');
      await expectTapTarget(entry.getByRole('button', { name: 'Remove' }), 'Remove');
      await expectTapTarget(
        app.page.getByLabel('Withdrawal receipt (JSON)'),
        'Withdrawal receipt file'
      );
      await tap(entry.getByRole('button', { name: 'Follow' }), 'Follow');
      await expect(app.page.getByRole('heading', { name: 'Withdrawal in progress' })).toBeVisible();
      await step(app, 'withdrawal followed');
    });
  });
}
