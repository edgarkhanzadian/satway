import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { WITHDRAW_PROGRESS, WithdrawPage, withdrawalFileSchema } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import { savedLabel, startAwaitingFunds } from '../src/scenario/journeys.js';
import {
  FUNDED_SATS,
  openWithdraw,
  quoteWithdrawal,
  toDelivered,
} from '../src/scenario/withdrawal.js';
import { USER_REJECTED } from '../src/wallets/behaviour.js';

const WAITING = 'Waiting for your wallet';
const UNANSWERED = 'Did your wallet send the withdrawal?';
const WITHDRAWALS = 'satway.withdrawals.v1';
const ACTIVE = 'satway.withdrawals.active.v1';
const ONLY_COPY =
  'This browser could not keep a copy of the receipt, so the file that was just downloaded is the only copy. Keep it: it is how you follow this withdrawal later.';

async function switchTabsAndBack(app: SatwayApp): Promise<void> {
  await app.page.getByRole('button', { name: 'Deposit', exact: true }).click();
  await expect(app.page.getByRole('heading', { name: WAITING })).toHaveCount(0);
  await app.page.getByRole('button', { name: 'Withdraw', exact: true }).click();
}

async function expectStillSigning(app: SatwayApp): Promise<void> {
  await expect(
    app.page.getByRole('button', { name: 'Confirm in your wallet…', exact: true })
  ).toBeVisible();
  await expect(app.page.getByRole('heading', { name: WAITING })).toHaveCount(0);
}

async function failEveryWrite(app: SatwayApp): Promise<void> {
  await app.page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Reflect.set(window, '__e2eQuotaFull', false);
    Storage.prototype.setItem = function setItem(name: string, value: string) {
      if (Reflect.get(window, '__e2eQuotaFull') === true)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      Reflect.apply(original, this, [name, value]);
    };
  });
}

test.describe('X6. switching tabs while a withdrawal is in flight', () => {
  test('switching tabs during the wallet prompt: the form still waits, then tracks once the wallet approves', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    const late = wallets.stacks.behaviour.late('stx_callContract');
    await withdraw.signButton.click();
    await expect.poll(() => wallets.stacks.behaviour.calls('stx_callContract').length).toBe(1);

    await switchTabsAndBack(app);
    await expectStillSigning(app);
    await expect(app.page.getByRole('heading', { name: UNANSWERED })).toHaveCount(0);
    await expect(
      app.page.getByRole('button', { name: 'Nothing was sent. Discard it' })
    ).toHaveCount(0);

    const downloaded = app.page.waitForEvent('download');
    late.release();
    await downloaded;
    await expect(app.page.getByRole('heading', { name: WAITING })).toHaveCount(0);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    const txid = world.withdrawals.stacks.latestCall().txid;
    await expect(app.page.getByText(`0x${txid}`)).toBeVisible();
    const storage = await app.storage();
    const saved = withdrawalFileSchema.array().parse(JSON.parse(storage[WITHDRAWALS] ?? '[]'));
    expect(saved.map(r => r.stacksTxid)).toEqual([txid]);
    expect(storage[ACTIVE]).toBe(saved[0]?.depositAddress);
    await toDelivered(withdraw, world);
  });

  test('switching tabs during the wallet prompt, then declining: back to the form, nothing kept', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    const late = wallets.stacks.behaviour.late('stx_callContract', {
      reject: { code: USER_REJECTED },
    });
    await withdraw.signButton.click();
    await expect.poll(() => wallets.stacks.behaviour.calls('stx_callContract').length).toBe(1);
    await switchTabsAndBack(app);
    await expectStillSigning(app);
    late.release();
    await expect(
      app.page.getByRole('heading', { name: 'Withdraw sBTC to another chain' })
    ).toBeVisible();
    await expect(app.page.getByRole('heading', { name: WAITING })).toHaveCount(0);
    await expect(app.page.getByRole('heading', { name: UNANSWERED })).toHaveCount(0);
    expect(world.withdrawals.stacks.txs.size).toBe(0);
    const storage = await app.storage();
    expect(JSON.parse(storage[WITHDRAWALS] ?? '[]')).toEqual([]);
    expect(storage[ACTIVE]).toBeUndefined();
  });

  test('with browser writes failing, the started withdrawal survives a tab switch', async ({
    app,
    world,
    wallets,
  }) => {
    await failEveryWrite(app);
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    await app.page.evaluate(() => Reflect.set(window, '__e2eQuotaFull', true));
    const late = wallets.stacks.behaviour.late('stx_callContract');
    await withdraw.signButton.click();
    await expect.poll(() => wallets.stacks.behaviour.calls('stx_callContract').length).toBe(1);
    await switchTabsAndBack(app);
    await expectStillSigning(app);
    const downloaded = app.page.waitForEvent('download');
    late.release();
    await downloaded;
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    await expect(app.page.getByText(ONLY_COPY)).toBeVisible();

    await switchTabsAndBack(app);
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingTx)).toBeVisible();
    await expect(app.page.getByText(ONLY_COPY)).toBeVisible();
    const storage = await app.storage();
    expect(storage[WITHDRAWALS]).toBeUndefined();
    await toDelivered(withdraw, world);
  });

  test('“Nothing was sent” re-reads the browser first: a withdrawal saved with a transaction is followed, not discarded', async ({
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
    const drafts = withdrawalFileSchema
      .array()
      .parse(JSON.parse((await app.storage())[WITHDRAWALS] ?? '[]'));
    const sent = JSON.stringify(drafts.map(r => ({ ...r, stacksTxid: txid })));
    await app.page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: WITHDRAWALS,
      value: sent,
    });
    await app.page.getByRole('button', { name: 'Nothing was sent. Discard it' }).click();
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    await expect(app.page.getByText(`0x${txid}`)).toBeVisible();
    const storage = await app.storage();
    const saved = withdrawalFileSchema.array().parse(JSON.parse(storage[WITHDRAWALS] ?? '[]'));
    expect(saved.map(r => r.stacksTxid)).toEqual([txid]);
    expect(storage[ACTIVE]).toBe(saved[0]?.depositAddress);
    await toDelivered(withdraw, world);
  });

  test('an active deposit and an active withdrawal both survive tab switches, each with its own route map', async ({
    app,
    world,
    wallets,
  }) => {
    const deposit = await startAwaitingFunds(app);
    world.withdrawals.fundSbtc(wallets.stacks.account.stacksAddress, FUNDED_SATS);
    const withdraw = new WithdrawPage(app);
    await withdraw.open();
    await expect(app.page.getByRole('list', { name: 'Route of a withdrawal' })).toBeVisible();
    await expect(app.route).toHaveCount(0);
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    await withdraw.sign();
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    await expect(withdraw.route).toBeVisible();

    await app.openTab('Deposit');
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
    await expect(app.route).toBeVisible();
    await expect(withdraw.route).toHaveCount(0);

    await app.openTab('Withdraw');
    await expect(app.page.getByRole('heading', { name: 'Withdrawal in progress' })).toBeVisible();
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingTx)).toBeVisible();
    await expect(withdraw.route).toBeVisible();
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await expect(withdraw.savedWithdrawal('50,000 sats to USDC on base')).toHaveCount(1);
    await expect(app.page.getByRole('list', { name: 'Route of a withdrawal' })).toBeVisible();

    await app.openTab('Deposit');
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
    await expect(app.route).toBeVisible();
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await expect(app.yourDepositsHeading).toBeVisible();
    await expect(app.savedEntry(savedLabel(deposit))).toHaveCount(1);
    await expect(app.page.getByRole('list', { name: 'Route of a deposit' })).toBeVisible();

    await app.openTab('Withdraw');
    await expect(app.page.getByRole('heading', { name: 'Withdrawal in progress' })).toHaveCount(0);
    await expect(withdraw.savedWithdrawal('50,000 sats to USDC on base')).toHaveCount(1);
  });

  test('without a Stacks wallet both lists are reachable, each loader points to the other tab, and both are followed', async ({
    app,
    world,
    wallets,
  }) => {
    const deposit = await startAwaitingFunds(app);
    world.withdrawals.fundSbtc(wallets.stacks.account.stacksAddress, FUNDED_SATS);
    const withdraw = new WithdrawPage(app);
    await withdraw.open();
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    const started = await withdraw.sign();
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    await app.page.reload();
    await expect(app.page.getByRole('button', { name: 'Connect Stacks wallet' })).toBeVisible();

    await app.openTab('Withdraw');
    await expect(app.page.getByRole('heading', { name: 'Withdrawal in progress' })).toBeVisible();
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await withdraw.openWithdrawals();
    await withdraw.uploadReceipt(deposit.receiptPath);
    await expect(app.page.getByRole('alert')).toHaveText(
      'This is not a withdrawal receipt. Deposit receipts are loaded on the Deposit tab.'
    );
    await app.openYourDeposits();
    await app.uploadReceipt(started.receiptPath);
    await expect(app.page.getByRole('alert')).toHaveText(
      'This is a withdrawal receipt. Load it on the Withdraw tab, under “Your withdrawals”.'
    );

    await app.resumeSaved(savedLabel(deposit));
    await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
    await withdraw.openWithdrawals();
    await withdraw.followSaved('50,000 sats to USDC on base');
    await expect(app.page.getByRole('heading', { name: 'Withdrawal in progress' })).toBeVisible();
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingTx)).toBeVisible();
    await app.openTab('Deposit');
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
  });
});
