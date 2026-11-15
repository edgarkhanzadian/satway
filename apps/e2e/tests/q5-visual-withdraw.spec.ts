import type { SatwayApp } from '../src/app/satway-app.js';
import { WITHDRAW_PROGRESS } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import { THEMES, fontsReady } from '../src/quality/page-checks.js';
import {
  openWithdraw,
  quoteWithdrawal,
  toAwaitingSigners,
  toPayoutConfirmed,
} from '../src/scenario/withdrawal.js';

const FIXED_TIME = Date.UTC(2026, 0, 15, 12, 0, 0);
const WIDTHS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
];

async function shoot(app: SatwayApp, state: string): Promise<void> {
  await app.harnessIdle();
  for (const size of WIDTHS) {
    await app.page.setViewportSize({ width: size.width, height: size.height });
    for (const theme of THEMES) {
      await app.page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await fontsReady(app.page);
      await expect(app.page).toHaveScreenshot(`withdraw-${state}-${size.name}-${theme}.png`, {
        fullPage: true,
      });
    }
  }
  await app.page.setViewportSize({ width: 1280, height: 720 });
  await app.page.emulateMedia({ colorScheme: 'light' });
}

test.describe('Q5. visual snapshots of the withdrawal', () => {
  test.use({ frozenClock: FIXED_TIME });

  test('the form with a quote, then the live quote to confirm', async ({ app, world, wallets }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await shoot(app, 'quote');
    world.withdrawals.liveQuoteFactor = 0.97;
    await withdraw.continueToConfirm();
    await app.page.getByRole('heading', { name: 'Check the live quote before you sign' }).blur();
    await shoot(app, 'confirm');
  });

  test('tracking: awaiting the signers, then done', async ({ app, world, wallets }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    await withdraw.sign();
    await toAwaitingSigners(withdraw, world);
    await shoot(app, 'awaiting-signers');
    const payout = world.withdrawals.signersAccept();
    world.mine(1);
    await withdraw.waitFor(WITHDRAW_PROGRESS.payoutConfirmed);
    world.withdrawals.swapReceives(payout);
    world.withdrawals.swapDelivers();
    await withdraw.waitFor(WITHDRAW_PROGRESS.done);
    await shoot(app, 'done');
  });

  test('refunded', async ({ app, world, wallets }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    await withdraw.sign();
    const payout = await toPayoutConfirmed(withdraw, world);
    world.withdrawals.swapReceives(payout);
    world.withdrawals.swapRefunds('Price moved beyond the slippage tolerance');
    await withdraw.waitFor(WITHDRAW_PROGRESS.refunded);
    await shoot(app, 'refunded');
  });
});
