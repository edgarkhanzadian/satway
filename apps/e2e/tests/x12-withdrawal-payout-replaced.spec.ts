import { WITHDRAW_PROGRESS } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import { FAILED_TO_LOAD } from '../src/scenario/journeys.js';
import { startWithdrawal, toAwaitingSigners } from '../src/scenario/withdrawal.js';

test.describe('X12. the sBTC signers replace their BTC payout before it confirms', () => {
  test('as on mainnet: the replaced payout is never named, the confirmed replacement is followed to done', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    const original = world.withdrawals.signersBroadcast();
    await app.tick();
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingSigners)).toBeVisible();
    await expect(app.page.getByText(original.txid)).toHaveCount(0);

    const replacement = world.withdrawals.signersReplace(original);
    expect(world.bitcoin.transaction(original.txid)).toBeNull();
    expect(world.bitcoin.serve('GET', `/api/tx/${original.txid}`, '').status).toBe(404);
    await app.tick();
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingSigners)).toBeVisible();

    world.mine(1);
    world.withdrawals.signersRecord(replacement);
    await withdraw.waitFor(WITHDRAW_PROGRESS.payoutConfirmed);
    await expect(app.page.getByText(`${replacement.txid}:1`)).toBeVisible();
    await expect(app.page.getByText(original.txid)).toHaveCount(0);
    await expect(app.progress(WITHDRAW_PROGRESS.mismatch)).toHaveCount(0);

    world.withdrawals.swapReceives(replacement);
    await withdraw.waitFor(WITHDRAW_PROGRESS.swapping);
    world.withdrawals.swapDelivers();
    await withdraw.waitFor(WITHDRAW_PROGRESS.done);
    await expect(app.page.getByText(original.txid)).toHaveCount(0);
  });

  test('a payout named before it confirmed and then replaced stays a soft, non-terminal wait, never a mismatch', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    const original = world.withdrawals.signersAccept();
    await withdraw.waitFor(WITHDRAW_PROGRESS.payoutBroadcast);
    world.withdrawals.signersReplace(original);
    world.mine(1);
    for (let i = 0; i < 4; i++) await app.tick();
    await expect(app.progress(WITHDRAW_PROGRESS.payoutBroadcast)).toBeVisible();
    await expect(app.progress(WITHDRAW_PROGRESS.mismatch)).toHaveCount(0);
  });
});
