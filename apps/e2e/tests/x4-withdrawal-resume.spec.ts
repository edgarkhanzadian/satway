import { WITHDRAW_PROGRESS, WithdrawPage } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import { FAILED_TO_LOAD, NET_FAILED } from '../src/scenario/journeys.js';
import {
  deliverFromSigners,
  openWithdraw,
  quoteWithdrawal,
  startWithdrawal,
  toAwaitingSigners,
  toDelivered,
} from '../src/scenario/withdrawal.js';

const UNANSWERED = 'Did your wallet send the withdrawal?';

test.describe('X4. resuming a withdrawal, and slow or lost answers', () => {
  test('a reload mid-flow resumes tracking on the Withdraw tab, with no wallet connected', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    await app.page.reload();
    await app.page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(app.page.getByRole('heading', { name: 'Withdrawal in progress' })).toBeVisible();
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingSigners)).toBeVisible();
    await expect(app.page.getByRole('button', { name: 'Connect Stacks wallet' })).toBeVisible();
    await deliverFromSigners(withdraw, world);
    await app.page.getByRole('button', { name: 'Start another' }).click();
    await app.page.reload();
    await app.page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(
      app.page.getByRole('heading', { name: 'Withdraw sBTC to another chain' })
    ).toBeVisible();
  });

  test('the downloaded receipt, in a browser that lost its storage, is followed from Recover', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    await app.page.evaluate(() => localStorage.clear());
    await app.page.reload();
    await withdraw.openFollow();
    await expect(withdraw.savedWithdrawals).toHaveCount(0);
    await withdraw.uploadReceipt(started.receiptPath);
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingSigners)).toBeVisible();
    await withdraw.follow();
    await expect(app.page.getByRole('heading', { name: 'Withdrawal in progress' })).toBeVisible();
    await deliverFromSigners(withdraw, world);
    await expect(app.page.getByRole('heading', { name: 'Withdrawal complete' })).toBeVisible();
  });

  test('the remembered withdrawal is listed on Recover, and a deposit receipt is pointed elsewhere', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await withdraw.openFollow();
    await withdraw.pickSaved('50,000 sats to USDC on base');
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingSigners)).toBeVisible();
    await app.uploadReceipt(started.receiptPath);
    await expect(app.page.getByRole('alert')).toHaveText(
      'This is a withdrawal receipt. Load it under “Follow a withdrawal” below.'
    );
    await withdraw.follow();
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingSigners)).toBeVisible();
  });

  test('the wallet’s answer is lost: the page asks, and a pasted transaction ID is followed', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    wallets.stacks.behaviour.loseReply('stx_callContract', {
      code: -32603,
      message: 'Internal error',
    });
    await withdraw.signButton.click();
    await expect(app.page.getByRole('heading', { name: UNANSWERED })).toBeVisible();
    const txid = world.withdrawals.stacks.latestCall().txid;

    await app.page.reload();
    await app.page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(app.page.getByRole('heading', { name: UNANSWERED })).toBeVisible();
    await app.page.getByLabel('Stacks transaction ID').fill('not a txid');
    await app.page.getByRole('button', { name: 'Follow this transaction' }).click();
    await expect(app.page.getByRole('alert').last()).toHaveText(/not a Stacks transaction ID/);

    await app.page.getByLabel('Stacks transaction ID').fill(`0x${txid}`);
    const downloaded = app.page.waitForEvent('download');
    await app.page.getByRole('button', { name: 'Follow this transaction' }).click();
    await downloaded;
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    await toDelivered(withdraw, world);
  });

  test('the wallet answers without a transaction ID: nothing was sent, and the draft can be discarded', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    wallets.stacks.behaviour.malformed('stx_callContract', {});
    await withdraw.signButton.click();
    await expect(app.page.getByRole('heading', { name: UNANSWERED })).toBeVisible();
    await app.page.getByRole('button', { name: 'Nothing was sent. Discard it' }).click();
    await expect(
      app.page.getByRole('heading', { name: 'Withdraw sBTC to another chain' })
    ).toBeVisible();
    const storage = await app.storage();
    expect(JSON.parse(storage['satway.withdrawals.v1'] ?? '[]')).toEqual([]);
    expect(world.withdrawals.stacks.txs.size).toBe(0);
  });

  test('a withdrawal quote that never answers times out with a clear message, and a retry works', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(NET_FAILED, FAILED_TO_LOAD);
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    harness.backendDown({ path: /^\/withdrawal-quote$/, mode: 'hang', times: 1 });
    await withdraw.fill({ amount: '50000' });
    await app.page.getByRole('button', { name: 'Get quote' }).click();
    await expect(app.page.getByRole('button', { name: 'Working…' })).toBeVisible();
    await app.fastForward(30_000);
    await expect(app.page.getByRole('alert')).toHaveText(
      /No answer from .+\/withdrawal-quote within 30 seconds/
    );
    harness.backendUp();
    await new WithdrawPage(app).getQuote();
  });

  test('editing the amount while a quote is in flight frees the button, and the late answer is ignored', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    const held = world.hold({ service: 'oneclick', path: /^\/v0\/quote$/ });
    await withdraw.fill({ amount: '50000' });
    await app.page.getByRole('button', { name: 'Get quote' }).click();
    await expect(app.page.getByRole('button', { name: 'Working…' })).toBeVisible();
    await withdraw.fill({ amount: '60000' });
    const getQuote = app.page.getByRole('button', { name: 'Get quote' });
    await expect(getQuote).toBeVisible();
    await expect(getQuote).not.toHaveAttribute('aria-disabled', 'true');
    held.release();
    await expect.poll(() => world.oneClick.quotes.length).toBe(1);
    await expect(app.definition('You receive about')).toHaveCount(0);
    await expect(getQuote).not.toHaveAttribute('aria-disabled', 'true');
    await withdraw.getQuote();
    expect(world.oneClick.quotes.at(-1)?.request.amount).toBe('60000');
  });

  test('editing the amount while the live quote is in flight frees the form', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    const held = world.hold({ service: 'oneclick', path: /^\/v0\/quote$/ });
    await app.page.getByRole('button', { name: 'Continue' }).click();
    await expect(app.page.getByRole('button', { name: 'Working…' })).toBeVisible();
    await withdraw.fill({ amount: '60000' });
    const getQuote = app.page.getByRole('button', { name: 'Get quote' });
    await expect(getQuote).toHaveText('Get quote');
    await expect(getQuote).not.toHaveAttribute('aria-disabled', 'true');
    held.release();
    await expect.poll(() => world.oneClick.quotes.length).toBe(2);
    await expect(
      app.page.getByRole('heading', { name: 'Check the live quote before you sign' })
    ).toHaveCount(0);
    await withdraw.getQuote();
    await withdraw.continueToConfirm();
  });

  test('a hanging Stacks API read while tracking: the page says so and recovers', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    world.addFault({ service: 'hiro', path: /^\/extended\/v1\/tx\//, outcome: 'hang', times: 1 });
    await app.tick();
    await app.fastForward(15_000);
    await expect(
      app.progress('Could not read the Stacks network right now. Checking again shortly.')
    ).toBeVisible();
    world.withdrawals.confirmRequest();
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingSigners);
  });
});
