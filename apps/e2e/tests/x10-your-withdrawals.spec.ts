import { writeFile } from 'node:fs/promises';

import { WITHDRAW_PROGRESS } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  deliverFromSigners,
  startWithdrawal,
  toAwaitingSigners,
} from '../src/scenario/withdrawal.js';

const ENTRY = '50,000 sats to USDC on base';
const IN_PROGRESS = 'Withdrawal in progress';

test.describe('X10. your withdrawals on the Withdraw tab', () => {
  test('a remembered withdrawal is followed from the list without a Stacks wallet, and keeps updating', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await app.page.reload();
    await withdraw.openWithdrawals();
    await expect(app.page.getByRole('button', { name: 'Connect Stacks wallet' })).toBeVisible();
    await expect(
      app.page.getByRole('heading', { name: 'Withdraw sBTC to another chain' })
    ).toBeVisible();
    await expect(withdraw.savedWithdrawals).toHaveCount(1);
    await expect(
      withdraw.savedWithdrawal(ENTRY).getByText(WITHDRAW_PROGRESS.awaitingSigners)
    ).toBeVisible();

    await withdraw.followSaved(ENTRY);
    await expect(app.page.getByRole('heading', { name: IN_PROGRESS })).toBeFocused();
    await expect(app.page.getByText(`0x${started.receipt.stacksTxid ?? ''}`)).toBeVisible();
    await deliverFromSigners(withdraw, world);
    await expect(app.page.getByRole('heading', { name: 'Withdrawal complete' })).toBeVisible();
    const storage = await app.storage();
    expect(storage['satway.withdrawals.active.v1']).toBe(started.receipt.depositAddress);
  });

  test('hiding the active withdrawal goes back to the form and the list, and it can be followed again', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await expect(app.page.getByLabel(/^Amount of sBTC/)).toBeVisible();
    await expect(
      withdraw.savedWithdrawal(ENTRY).getByText(WITHDRAW_PROGRESS.awaitingTx)
    ).toBeVisible();
    await expect(app.page.getByRole('heading', { name: IN_PROGRESS })).toHaveCount(0);

    world.withdrawals.confirmRequest();
    await withdraw.followSaved(ENTRY);
    await expect(app.page.getByRole('heading', { name: IN_PROGRESS })).toBeVisible();
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingSigners);
    await expect(app.page.getByText(`0x${started.receipt.stacksTxid ?? ''}`)).toBeVisible();
    await expect(withdraw.savedWithdrawals).toHaveCount(0);
  });

  test('a receipt file is loaded without a wallet and followed; a bad file is refused', async ({
    app,
    world,
    wallets,
  }, testInfo) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets);
    await toAwaitingSigners(withdraw, world);
    await app.page.evaluate(() => localStorage.clear());
    await app.page.reload();
    await withdraw.openWithdrawals();
    await expect(
      app.page.getByText('This browser does not remember any withdrawals.')
    ).toBeVisible();

    const junk = testInfo.outputPath('junk.json');
    await writeFile(junk, 'not json');
    await withdraw.uploadReceipt(junk);
    await expect(app.page.getByRole('alert')).toHaveText('That file is not a withdrawal receipt.');

    await withdraw.uploadReceipt(started.receiptPath);
    await expect(app.page.getByRole('heading', { name: IN_PROGRESS })).toBeVisible();
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingSigners)).toBeVisible();
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await expect(withdraw.savedWithdrawal(ENTRY)).toHaveCount(1);
  });
});
