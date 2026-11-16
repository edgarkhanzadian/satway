import { Cl, serializeCV } from '@stacks/transactions';

import type { SatwayApp } from '../src/app/satway-app.js';
import { WITHDRAW_PROGRESS, withdrawalFileSchema } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import { FAILED_TO_LOAD } from '../src/scenario/journeys.js';
import { openWithdraw, quoteWithdrawal, toDelivered } from '../src/scenario/withdrawal.js';
import { approveContractCall } from '../src/wallets/stacks-contract-call.js';
import { WITHDRAWAL_FUNCTION } from '../src/world/stacks.js';

const UNANSWERED = 'Did your wallet send the withdrawal?';
const WITHDRAWALS = 'satway.withdrawals.v1';
const NOT_KNOWN =
  'Stacks does not know this transaction yet. If your wallet sent it just now, wait a minute and try again.';
const BOGUS_TXID = 'ab'.repeat(32);

async function savedTxids(app: SatwayApp): Promise<(string | null)[]> {
  const raw = (await app.storage())[WITHDRAWALS] ?? '[]';
  return withdrawalFileSchema
    .array()
    .parse(JSON.parse(raw))
    .map(r => r.stacksTxid);
}

async function paste(app: SatwayApp, txid: string): Promise<void> {
  await app.page.getByLabel('Stacks transaction ID').fill(txid);
  await app.page.getByRole('button', { name: 'Follow this transaction' }).click();
}

test.describe('X7. a pasted Stacks transaction ID is checked before it is saved', () => {
  test('an unknown ID is not saved and can be retried; another call is refused; the right one is followed', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    wallets.stacks.behaviour.loseReply('stx_callContract', {
      code: -32603,
      message: 'Internal error',
    });
    await withdraw.signButton.click();
    await expect(app.page.getByRole('heading', { name: UNANSWERED })).toBeVisible();
    const sent = world.withdrawals.stacks.latestCall();

    let downloads = 0;
    app.page.on('download', () => {
      downloads += 1;
    });
    await paste(app, `0x${BOGUS_TXID}`);
    await expect(app.page.getByRole('alert').last()).toHaveText(NOT_KNOWN);
    await expect(app.page.getByRole('heading', { name: UNANSWERED })).toBeVisible();
    expect(await savedTxids(app)).toEqual([null]);

    const other = world.withdrawals.stacks.submit({
      sender: sent.sender,
      contract: sent.contract,
      functionName: WITHDRAWAL_FUNCTION,
      functionArgs: [...sent.functionArgs.slice(0, 2), serializeCV(Cl.uint(1))],
      postConditions: sent.postConditions,
      postConditionMode: sent.postConditionMode,
    });
    await paste(app, other.txid);
    await expect(app.page.getByRole('alert').last()).toHaveText(
      'That transaction is not this withdrawal. It withdraws a different amount, fee cap or Bitcoin address than this withdrawal. Check the ID in your wallet’s activity.'
    );
    expect(await savedTxids(app)).toEqual([null]);
    expect(downloads).toBe(0);

    const downloaded = app.page.waitForEvent('download');
    await paste(app, `0x${sent.txid}`);
    await downloaded;
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    expect(await savedTxids(app)).toEqual([sent.txid]);
    world.withdrawals.stacks.confirm(sent.txid);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingSigners);
  });

  test('a wallet that returned a wrong ID: “Change transaction” replaces it with the checked one', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    wallets.stacks.behaviour.malformed('stx_callContract', { txid: `0x${BOGUS_TXID}` });
    await withdraw.sign();
    const params = wallets.stacks.behaviour.calls('stx_callContract')[0]?.params;
    const { txid } = approveContractCall(
      world,
      wallets.stacks.account.stacksAddress,
      params,
      wallets.stacks.contractCalls
    );
    expect(await savedTxids(app)).toEqual([BOGUS_TXID]);
    const change = app.page.getByRole('button', { name: 'Change transaction' });
    await app.until(() => expect(change).toBeVisible({ timeout: 750 }));

    await change.click();
    await expect(app.page.getByRole('heading', { name: 'Change the transaction' })).toBeVisible();
    await app.page.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.page.getByRole('heading', { name: 'Change the transaction' })).toHaveCount(0);
    await change.click();
    await paste(app, `0x${'cd'.repeat(32)}`);
    await expect(app.page.getByRole('alert').last()).toHaveText(NOT_KNOWN);
    expect(await savedTxids(app)).toEqual([BOGUS_TXID]);

    const downloaded = app.page.waitForEvent('download');
    await paste(app, txid);
    await downloaded;
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    await expect(app.page.getByText(txid)).toBeVisible();
    await expect(change).toHaveCount(0);
    expect(await savedTxids(app)).toEqual([txid.replace(/^0x/, '')]);
    await toDelivered(withdraw, world);
  });
});
