import { copyFile } from 'node:fs/promises';

import { PROGRESS, type PortageApp } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import { THEMES, fontsReady } from '../src/quality/page-checks.js';
import { SEND_COPY, payOut, startAwaitingFunds } from '../src/scenario/journeys.js';
import { openReceiptInRecover, toReclaimable } from '../src/scenario/states.js';

const FIXED_TIME = Date.UTC(2026, 0, 15, 12, 0, 0);
const WIDTHS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
];

async function shoot(app: PortageApp, state: string): Promise<void> {
  await app.harnessIdle();
  for (const size of WIDTHS) {
    await app.page.setViewportSize({ width: size.width, height: size.height });
    for (const theme of THEMES) {
      await app.page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await fontsReady(app.page);
      await expect(app.page).toHaveScreenshot(`${state}-${size.name}-${theme}.png`, {
        fullPage: true,
      });
    }
  }
  await app.page.setViewportSize({ width: 1280, height: 720 });
  await app.page.emulateMedia({ colorScheme: 'light' });
}

test.describe('Q5. visual snapshots of the key states', () => {
  test.use({ frozenClock: FIXED_TIME });

  test('landing', async ({ app }) => {
    await app.open();
    await expect(app.from.getByRole('button', { name: /Test EVM Wallet/ })).toBeVisible();
    await shoot(app, 'landing');
  });

  test('the form with a quote', async ({ app }) => {
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    await shoot(app, 'form-with-quote');
  });

  test('tracking: awaiting funds, swapping, done', async ({ app, world }) => {
    await startAwaitingFunds(app);
    await expect(app.sendButton).toBeVisible();
    await shoot(app, 'awaiting-funds');
    await app.sendFromWallet();
    await app.waitForProgress(PROGRESS.swapping);
    await shoot(app, 'swapping');
    const payout = await payOut(app, world);
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    world.mine(1);
    await app.waitForProgress(PROGRESS.minting);
    world.signers.mint(payout.outpoint);
    await app.waitForProgress(PROGRESS.done);
    await shoot(app, 'done');
  });

  test('refunded', async ({ app, world }) => {
    await startAwaitingFunds(app);
    await app.sendFromWallet();
    await app.waitForProgress(PROGRESS.swapping);
    world.oneClick.refund(world.swap(), 'Price moved beyond the slippage');
    await app.waitForProgress(
      'The swap did not complete and your funds were sent back to your refund address.'
    );
    await shoot(app, 'refunded');
  });

  test('reclaimable, and Recover', async ({ app, world }) => {
    const { started } = await toReclaimable(app, world);
    await shoot(app, 'reclaimable');
    const stable = test.info().outputPath('portage-deposit-receipt.json');
    await copyFile(started.receiptPath, stable);
    await openReceiptInRecover(app, { ...started, receiptPath: stable });
    await shoot(app, 'recover');
  });

  test('uncertain send', async ({ app, wallets }) => {
    await startAwaitingFunds(app);
    wallets.evm.behaviour.loseReply('eth_sendTransaction', {
      code: -32603,
      message: 'Internal JSON-RPC error.',
    });
    await app.clickSend();
    await expect(app.page.getByText(SEND_COPY.uncertainHeadline, { exact: true })).toBeVisible();
    await shoot(app, 'uncertain-send');
  });
});
