import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { savedLabel, startAwaitingFunds, toPayoutConfirmed } from '../src/scenario/journeys.js';
import { RECLAIM_COPY, reclaimControls } from '../src/scenario/reclaim.js';
import { toReclaimable } from '../src/scenario/states.js';

async function reopen(app: SatwayApp, options: { wallet: boolean }): Promise<SatwayApp> {
  await app.page.close();
  const later = await app.newTab();
  await later.open();
  if (options.wallet) await later.connectStacksWallet();
  await expect(later.yourDepositsHeading).toBeVisible();
  return later;
}

test.describe('R10. Your deposits, on the Deposit tab', () => {
  test('a remembered deposit is followed from the list with no wallet connected', async ({
    app,
  }) => {
    const started = await startAwaitingFunds(app);
    await app.sendFromWallet();
    await app.waitForProgress(PROGRESS.swapping);
    const later = await reopen(app, { wallet: false });
    await expect(later.page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
    await expect(later.page.getByRole('button', { name: 'Deposit', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const entry = later.savedEntry(savedLabel(started));
    await expect(entry).toContainText('Swapping to BTC');
    await expect(entry.getByRole('button', { name: 'Reclaim', exact: true })).toHaveCount(0);
    await later.followSaved(savedLabel(started));
    await expect(later.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await later.waitForProgress(PROGRESS.swapping);
    await expect(
      later.page.getByText(started.receipt.depositAddress, { exact: true })
    ).toBeVisible();
  });

  test('a receipt file is loaded and followed with no wallet connected', async ({ app }) => {
    const started = await startAwaitingFunds(app);
    await app.sendFromWallet();
    await app.page.evaluate(() => localStorage.clear());
    const later = await reopen(app, { wallet: false });
    await expect(later.savedReceipts).toHaveCount(0);
    await later.uploadReceipt(started.receiptPath);
    await expect(later.progress(PROGRESS.swapping)).toBeVisible();
    await later.followDeposit();
    await expect(later.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
  });

  test('a reclaimable deposit is reclaimed from the list', async ({ app, world, wallets }) => {
    const { started, payout } = await toReclaimable(app, world);
    await app.openYourDeposits();
    const entry = app.savedEntry(savedLabel(started));
    await expect(entry).toContainText('Reclaimable now');
    await entry.getByRole('button', { name: 'Reclaim', exact: true }).click();
    await expect(app.progress(RECLAIM_COPY.signersMayMint)).toBeVisible();
    const controls = reclaimControls(app);
    await expect(controls.output).toBeFocused();
    await controls.to.fill(wallets.stacks.account.paymentAddress);
    await controls.button.click();
    await expect(app.definition('Network fee')).toBeVisible();
    await controls.confirm.click();
    await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
    expect(world.bitcoin.isSpent(payout.outpoint)).toBe(true);
    expect(wallets.stacks.behaviour.calls('signPsbt')).toHaveLength(1);
  });

  test('Hide goes back to the form and the list without losing the deposit, and so does a tab switch', async ({
    app,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    await app.page.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(
      app.page.getByRole('heading', { name: 'Deposit to sBTC from another chain' })
    ).toBeVisible();
    await expect(app.savedEntry(savedLabel(started))).toBeVisible();
    await app.page.getByRole('button', { name: 'Show progress', exact: true }).click();
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await expect(app.sendButton).toBeVisible();
    await app.openTab('Withdraw');
    await app.openTab('Deposit');
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await app.sendFromWallet();
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(1);
  });

  test('a finished deposit keeps its last stage and is not checked again on the next visit', async ({
    app,
    world,
  }) => {
    const started = await startAwaitingFunds(app);
    await app.sendFromWallet();
    const payout = await toPayoutConfirmed(app, world);
    world.signers.mint(payout.outpoint);
    await app.waitForProgress(PROGRESS.done);
    await app.page.getByRole('button', { name: 'Start another', exact: true }).click();
    await expect(app.savedEntry(savedLabel(started))).toContainText('sBTC minted');
    await app.page.reload();
    await app.open();
    const before = world.log.length;
    await expect(app.savedEntry(savedLabel(started))).toContainText('sBTC minted');
    await app.harnessIdle();
    expect(
      world.log.slice(before).filter(e => e.caller === 'page' && e.service !== 'unknown')
    ).toEqual([]);
    await expect(
      app.savedEntry(savedLabel(started)).getByRole('button', { name: 'Follow', exact: true })
    ).toHaveCount(0);
  });

  test('without a receipt, the wallet search is on the Deposit tab', async ({ app, world }) => {
    await startAwaitingFunds(app);
    await app.sendFromWallet();
    await toPayoutConfirmed(app, world);
    await app.page.evaluate(() => localStorage.clear());
    const later = await reopen(app, { wallet: true });
    await expect(later.savedReceipts).toHaveCount(0);
    await later.page.getByRole('button', { name: 'Search with my wallet' }).click();
    await expect(
      later.progress('Found 1 registered deposit address for this wallet.')
    ).toBeVisible();
  });
});
