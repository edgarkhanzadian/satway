import type { SatwayApp } from '../src/app/satway-app.js';
import { WITHDRAW_PROGRESS, withdrawalFileSchema } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import { deliverFromSigners, startWithdrawal, toDelivered } from '../src/scenario/withdrawal.js';

const WITHDRAWALS = 'satway.withdrawals.v1';
const REPLACED = /^The withdrawal transaction was replaced or dropped from the Stacks mempool/;

async function savedTxids(app: SatwayApp): Promise<(string | null)[]> {
  const raw = (await app.storage())[WITHDRAWALS] ?? '[]';
  return withdrawalFileSchema
    .array()
    .parse(JSON.parse(raw))
    .map(r => r.stacksTxid);
}

test.describe('X8. a fee-bumped replacement at the same nonce', () => {
  test('an identical replacement in the mempool is followed, the receipt updated, and it reaches done', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    const original = world.withdrawals.stacks.latestCall();
    let downloads = 0;
    app.page.on('download', () => {
      downloads += 1;
    });
    const replacement = world.withdrawals.stacks.replaceByFee(original.txid, 'identical');
    await app.until(() =>
      expect(app.page.getByText(`0x${replacement.txid}`)).toBeVisible({ timeout: 750 })
    );
    await expect(app.page.getByText(`0x${original.txid}`)).toHaveCount(0);
    expect(await savedTxids(app)).toEqual([replacement.txid]);
    expect(downloads).toBe(1);
    await toDelivered(withdraw, world);
  });

  test('an identical replacement that already confirmed is followed straight to the signers', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    const original = world.withdrawals.stacks.latestCall();
    const replacement = world.withdrawals.stacks.replaceByFee(original.txid, 'identical');
    world.withdrawals.stacks.confirm(replacement.txid);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingSigners);
    await expect(app.page.getByText(`0x${replacement.txid}`)).toBeVisible();
    expect(await savedTxids(app)).toEqual([replacement.txid]);
    await deliverFromSigners(withdraw, world);
  });

  test('a different withdrawal call at that nonce is not followed', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    const original = world.withdrawals.stacks.latestCall();
    const other = world.withdrawals.stacks.replaceByFee(original.txid, 'different-call');
    await withdraw.waitFor(REPLACED);
    world.withdrawals.stacks.mineOther(other.txid);
    await app.fastForward(60_000);
    await withdraw.waitFor(REPLACED);
    await expect(app.page.getByText(`0x${original.txid}`)).toBeVisible();
    await expect(app.page.getByText(`0x${other.txid}`)).toHaveCount(0);
    expect(await savedTxids(app)).toEqual([original.txid]);
  });
});
