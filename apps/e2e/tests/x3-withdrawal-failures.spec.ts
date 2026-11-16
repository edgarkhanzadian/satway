import { WITHDRAW_PROGRESS } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  FUNDED_SATS,
  WITHDRAW_SATS,
  startWithdrawal,
  toAwaitingSigners,
  toPayoutConfirmed,
} from '../src/scenario/withdrawal.js';

const NOT_DONE = 'Withdrawal complete';
const SETTLED_POLL_INTERVAL_MS = 120_000;

test.describe('X3. a withdrawal that fails after it was signed', () => {
  test('the Stacks transaction fails on chain: the sBTC never moved, and polling slows down', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    world.withdrawals.confirmRequest('insufficient-balance');
    await withdraw.waitFor(
      'Your sBTC balance was too low to lock the amount plus the fee cap, so nothing was withdrawn.'
    );
    await expect(
      app.page.getByRole('heading', { name: 'Withdrawal request failed' })
    ).toBeVisible();
    await expect(
      app.page.getByText('Your sBTC did not leave your wallet. You can start a new withdrawal.')
    ).toBeVisible();
    await expect(app.definition('Why it failed')).toHaveText(/err u1/);
    await withdraw.expectSteps(['Done', 'Stopped here']);
    await withdraw.expectRouteAt('sBTC on Stacks', 'Stopped here');
    const reads = world.requestsTo('hiro', { caller: 'page' }).length;
    await app.tick();
    await app.tick();
    expect(world.requestsTo('hiro', { caller: 'page' })).toHaveLength(reads);
    await app.fastForward(SETTLED_POLL_INTERVAL_MS);
    await expect
      .poll(() => world.requestsTo('hiro', { caller: 'page' }).length)
      .toBeGreaterThan(reads);
    await app.page.getByRole('button', { name: 'Start another' }).click();
    await expect(
      app.page.getByRole('heading', { name: 'Withdraw sBTC to another chain' })
    ).toBeVisible();
  });

  test('the Stacks transaction is dropped from the mempool: it keeps checking and does not call it final', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    world.withdrawals.confirmRequest('dropped');
    await withdraw.waitFor(/^The withdrawal transaction was replaced or dropped/);
    await expect(app.page.getByRole('heading', { name: 'Withdrawal in progress' })).toBeVisible();
    await expect(app.page.getByText(/No sBTC moved|start a new withdrawal/)).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: 'Hide' })).toBeVisible();
    const reads = world.requestsTo('hiro', { caller: 'page' }).length;
    await app.tick();
    await expect
      .poll(() => world.requestsTo('hiro', { caller: 'page' }).length)
      .toBeGreaterThan(reads);
  });

  test('the post-condition stops the transaction: it says no sBTC moved', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    world.withdrawals.confirmRequest('post-condition');
    await withdraw.waitFor(
      /^The Stacks transaction was stopped by its post-condition, so no sBTC moved/
    );
    await expect(
      app.page.getByRole('heading', { name: 'Withdrawal request failed' })
    ).toBeVisible();
    expect(world.withdrawals.stacks.balanceOf(wallets.stacks.account.stacksAddress)).toBe(
      FUNDED_SATS
    );
  });

  test('the signers reject the request: the sBTC comes back and the page says so', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    expect(world.withdrawals.stacks.balanceOf(wallets.stacks.account.stacksAddress)).toBe(
      FUNDED_SATS - WITHDRAW_SATS - 3_000
    );
    world.withdrawals.signersReject();
    await withdraw.waitFor(WITHDRAW_PROGRESS.rejected);
    await expect(
      app.page.getByRole('heading', { name: 'Withdrawal rejected by the signers' })
    ).toBeVisible();
    await expect(app.page.getByText(/back in your Stacks wallet/)).toBeVisible();
    await withdraw.expectSteps(['Done', 'Done', 'Stopped here']);
    expect(world.withdrawals.stacks.balanceOf(wallets.stacks.account.stacksAddress)).toBe(
      FUNDED_SATS
    );
    expect(world.withdrawals.latestSwap().swap.status).toBe('PENDING_DEPOSIT');
  });

  test('the signers pay the wrong amount: a mismatch, never Done, even when the swap later succeeds', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    const payout = world.withdrawals.signersAccept({ payoutSats: WITHDRAW_SATS - 1 });
    world.mine(1);
    await withdraw.waitFor(WITHDRAW_PROGRESS.mismatch);
    await expect(
      app.page.getByRole('heading', { name: 'Withdrawal needs attention' })
    ).toBeVisible();
    await expect(
      app.page.getByText('The payout output does not carry exactly the requested amount.').first()
    ).toBeVisible();
    await withdraw.expectSteps(['Done', 'Done', 'Done', 'Stopped here']);
    world.withdrawals.swapReceives(payout);
    world.withdrawals.swapDelivers();
    await app.tick();
    await app.tick();
    await expect(app.page.getByRole('heading', { name: NOT_DONE })).toHaveCount(0);
    await expect(app.progress(WITHDRAW_PROGRESS.done)).toHaveCount(0);
  });

  test('a hard mismatch stays on screen even if the data later looks healthy', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    const [record] = [...world.withdrawals.stacks.requests.values()];
    if (!record) throw new Error('No withdrawal request on chain');
    const amount = record.amountSats;
    record.amountSats = amount + 1;
    await withdraw.waitFor(WITHDRAW_PROGRESS.mismatch);
    record.amountSats = amount;
    for (let i = 0; i < 3; i += 1) await app.fastForward(130_000);
    await expect(app.progress(WITHDRAW_PROGRESS.mismatch)).toBeVisible();
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingSigners)).toHaveCount(0);
  });

  test('NEAR Intents refunds the swap: the BTC went to the refund address and the page says how much', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets);
    const payout = await toPayoutConfirmed(withdraw, world);
    world.withdrawals.swapReceives(payout);
    await withdraw.waitFor(WITHDRAW_PROGRESS.swapping);
    world.withdrawals.swapRefunds('Price moved beyond the slippage tolerance');
    await withdraw.waitFor(WITHDRAW_PROGRESS.refunded);
    await expect(app.page.getByRole('heading', { name: 'Swap refunded' })).toBeVisible();
    await expect(
      app.page.getByText(
        `0.0005 BTC was refunded to ${started.receipt.refundTo} on Bitcoin. Reason given by the swap provider: Price moved beyond the slippage tolerance.`
      )
    ).toBeVisible();
    await withdraw.expectSteps(['Done', 'Done', 'Done', 'Done', 'Stopped here']);
    await withdraw.expectRouteAt('Swap from BTC', 'Stopped here');
    await expect(app.page.getByRole('button', { name: 'Start another' })).toBeVisible();
  });

  test('the quote deadline passes while the signers have not paid: a warning, not an ending', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    const left = Date.parse(started.receipt.quoteDeadline) - world.now().getTime();
    await app.fastForward(left + 60_000);
    await withdraw.waitFor(WITHDRAW_PROGRESS.deadline);
    await expect(
      app.page.getByText(
        `Keep this page or the receipt file. If the swap refunds the BTC, it goes to ${started.receipt.refundTo}.`
      )
    ).toBeVisible();
    await expect(app.page.getByRole('button', { name: 'Hide' })).toBeVisible();
    world.withdrawals.signersReject();
    await withdraw.waitFor(WITHDRAW_PROGRESS.rejected);
  });
});
