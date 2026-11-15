import { PROGRESS, type PortageApp } from '../src/app/portage-app.js';
import type { ReceiptFile } from '../src/app/receipt.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily } from '../src/scenario/checks.js';
import type { World } from '../src/world/world.js';

async function startAndCloseMidSwap(
  app: PortageApp
): Promise<{ receipt: ReceiptFile; receiptPath: string }> {
  await app.open();
  await app.connectStacksWallet();
  await app.connectEvmWallet();
  await app.fillDeposit({ amount: '75' });
  await app.getQuote();
  const started = await app.continue();
  await app.waitForProgress(PROGRESS.awaitingFunds);
  await app.sendFromWallet();
  await app.waitForProgress(PROGRESS.swapping);
  return started;
}

async function resumeToDone(later: PortageApp, world: World, receipt: ReceiptFile): Promise<void> {
  await expect(later.progress(PROGRESS.swapping)).toBeVisible();
  await later.followDeposit();
  await expect(later.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
  await later.waitForProgress(PROGRESS.swapping);
  await expect(later.page.getByText(receipt.depositAddress, { exact: true })).toBeVisible();
  await expect(later.progress('A payment has been recorded for this swap.')).toHaveCount(0);
  await expect(later.sendButton).toHaveCount(0);

  const payout = world.completeSwap();
  await later.waitForProgress(PROGRESS.payoutUnconfirmed);
  expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');
  world.mine(1);
  await later.waitForProgress(PROGRESS.minting);
  world.signers.mint(payout.outpoint);
  await later.waitForProgress(PROGRESS.done);
  await later.expectComplete();
}

test.describe('E. close the tab mid-swap and resume in a new one', () => {
  test('from the receipts this browser remembered', async ({ app, world, wallets }) => {
    const { receipt } = await startAndCloseMidSwap(app);
    await app.page.close();

    const later = await app.newTab();
    await later.open();
    await later.connectStacksWallet();
    await later.openRecover();
    expect(await later.savedReceiptLabels()).toHaveLength(1);
    await later.pickSavedReceipt(`${receipt.quoteResponse.quote.amountInFormatted} USDC`);
    await resumeToDone(later, world, receipt);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(1);
  });

  test('from the downloaded receipt file, with the browser storage gone', async ({
    app,
    world,
    wallets,
  }) => {
    const { receipt, receiptPath } = await startAndCloseMidSwap(app);
    await app.page.close();

    const later = await app.newTab();
    await later.open();
    await later.page.evaluate(() => localStorage.clear());
    await later.page.reload();
    await later.connectStacksWallet();
    await later.openRecover();
    await expect(later.savedReceipts).toHaveCount(0);
    await later.uploadReceipt(receiptPath);
    await expect(later.page.getByText(receipt.stacksAddress, { exact: true })).toBeVisible();
    await resumeToDone(later, world, receipt);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(1);
  });
});
