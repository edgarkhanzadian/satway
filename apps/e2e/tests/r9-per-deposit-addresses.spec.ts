import { MAINNET_CONFIG, buildIndexedDepositAddress } from '@satway/core';

import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import type { Wallets } from '../src/browser/harness.js';
import { expect, test } from '../src/fixtures.js';
import {
  FAILED_TO_LOAD,
  startAwaitingFunds,
  startDeposit,
  toPayoutConfirmed,
} from '../src/scenario/journeys.js';
import { RECLAIM_COPY, expectReclaimPsbt, reclaimFromRecover } from '../src/scenario/reclaim.js';
import { outpointKey } from '../src/world/bitcoin.js';
import { json } from '../src/world/http.js';
import type { World } from '../src/world/world.js';

const FEE_SATS = Math.ceil(126 * 4);

function addressAt(world: World, wallets: Wallets, depositIndex: number): string {
  const account = wallets.stacks.account;
  return buildIndexedDepositAddress(
    {
      stacksAddress: account.stacksAddress,
      reclaimPublicKey: account.paymentKey.xOnly,
      signersPublicKey: world.signer.xOnly,
      depositIndex,
    },
    MAINNET_CONFIG
  ).address;
}

async function reopenWithoutReceipts(app: SatwayApp): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await app.open();
  await app.connectStacksWallet();
  await app.openRecover();
  await expect(app.savedReceipts).toHaveCount(0);
}

function foundButton(app: SatwayApp, address: string) {
  return app.page.getByRole('button', {
    name: new RegExp(`^Check ${address} \\(index \\d+\\)$`),
  });
}

test.describe('R9. one Bitcoin deposit address per deposit', () => {
  test('an address that already has transactions is skipped and another one drawn', async ({
    app,
    world,
    wallets,
  }) => {
    const funded: string[] = [];
    world.bitcoin.beforeAddressStats = address => {
      funded.push(address);
      world.payTo(address, 7_000);
    };
    const started = await startDeposit(app);
    expect(funded).toHaveLength(1);
    expect(started.receipt.depositAddress).not.toBe(funded[0]);
    expect(world.bitcoin.addressLookups.slice(-2)).toEqual([
      funded[0],
      started.receipt.depositAddress,
    ]);
    expect(addressAt(world, wallets, started.receipt.depositIndex)).toBe(
      started.receipt.depositAddress
    );
    expect(started.receipt.quoteResponse.quoteRequest.recipient).toBe(
      started.receipt.depositAddress
    );
  });

  test('without a receipt, Emily finds the deposit, and a deposit at index n ≠ 0 is reclaimed', async ({
    app,
    world,
    wallets,
  }) => {
    world.payTo(addressAt(world, wallets, 0), 5_000);
    world.mine(1);
    const started = await startAwaitingFunds(app);
    expect(started.receipt.depositIndex).not.toBe(0);
    expect(started.receipt.maxSignerFeeSats).toBe(80_000 + started.receipt.depositIndex);
    const payout = await toPayoutConfirmed(app, world);
    world.mine(949);
    await app.tick();
    await app.waitForProgress(RECLAIM_COPY.signersMayMint);

    await reopenWithoutReceipts(app);
    await app.page.getByRole('button', { name: 'Search with my wallet' }).click();
    await expect(app.progress('Found 1 registered deposit address for this wallet.')).toBeVisible();
    expect(world.emily.reclaimKeyLookups.at(-1)).toBe(wallets.stacks.account.paymentKey.xOnly);
    await foundButton(app, started.receipt.depositAddress).click();
    await expect(app.progress(RECLAIM_COPY.signersMayMint)).toBeVisible();
    await expect(app.definition('Signer fee cap')).toHaveText(
      `${started.receipt.maxSignerFeeSats.toLocaleString('en-US')} sats`
    );

    const to = wallets.stacks.account.paymentAddress;
    await reclaimFromRecover(app, to);
    await expect(
      app
        .progress(/^Reclaim sent for /)
        .or(app.sendError)
        .first()
    ).toBeVisible();
    await expect(app.sendError).toHaveCount(0);
    const [broadcast] = world.bitcoin.broadcasts;
    const reclaimTx = world.bitcoin.allTransactions().find(t => t.hex === broadcast);
    if (!reclaimTx)
      throw new Error(`The world refused the reclaim: ${JSON.stringify(world.bitcoin.rejected)}`);
    await expect(
      app.progress(
        `Reclaim sent for ${outpointKey(payout.outpoint)}. Transaction ${reclaimTx.txid}.`
      )
    ).toBeVisible();
    expectReclaimPsbt(wallets.stacks, {
      outpoint: payout.outpoint,
      amountSats: payout.amountSats,
      to,
      feeSats: FEE_SATS,
    });
  });

  test('with Emily down, a gap scan over the wallet’s addresses finds the deposit', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    const started = await startAwaitingFunds(app);
    const payout = await toPayoutConfirmed(app, world);
    await reopenWithoutReceipts(app);
    world.addFault({
      service: 'emily',
      path: /^\/deposit\/reclaim-pubkeys\//,
      outcome: json({ message: 'Service unavailable' }, 503),
    });
    await app.page.getByRole('button', { name: 'Search with my wallet' }).click();
    await expect(app.progress(/^The sBTC signers’ API could not be reached/)).toBeVisible();
    await expect(
      app.progress(
        'Found 1 deposit address for this wallet. Deposits made while the sBTC signers used an earlier key are not found this way.'
      )
    ).toBeVisible({ timeout: 60_000 });
    const checked = new Set(world.bitcoin.addressLookups);
    expect(checked.has(addressAt(world, wallets, 0))).toBe(true);
    expect(checked.has(addressAt(world, wallets, started.receipt.depositIndex + 256))).toBe(true);
    expect(checked.has(addressAt(world, wallets, started.receipt.depositIndex + 257))).toBe(false);
    await foundButton(app, started.receipt.depositAddress).click();
    await expect(app.progress(PROGRESS.minting)).toBeVisible();
    await expect(app.definition('Bitcoin payout')).toContainText(payout.outpoint.txid);
  });

  test('when Emily knows no registered deposit, the page scans Bitcoin by itself and finds it', async ({
    app,
    world,
  }) => {
    const started = await startAwaitingFunds(app);
    await toPayoutConfirmed(app, world);
    await reopenWithoutReceipts(app);
    world.addFault({
      service: 'emily',
      path: /^\/deposit\/reclaim-pubkeys\//,
      outcome: json({ nextToken: null, deposits: [] }, 200),
    });
    await app.page.getByRole('button', { name: 'Search with my wallet' }).click();
    await expect(
      app.progress(/^The sBTC signers’ API knows no registered deposits for this wallet\./)
    ).toBeVisible();
    await expect(
      app.progress(
        'Found 1 deposit address for this wallet. Deposits made while the sBTC signers used an earlier key are not found this way.'
      )
    ).toBeVisible({ timeout: 60_000 });
    await expect(foundButton(app, started.receipt.depositAddress)).toBeVisible();
  });

  test('“Keep scanning” checks the next window past where the gap scan stopped', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    const far = addressAt(world, wallets, 300);
    world.payTo(far, 20_000);
    world.mine(1);
    await reopenWithoutReceipts(app);
    world.addFault({
      service: 'emily',
      path: /^\/deposit\/reclaim-pubkeys\//,
      outcome: json({ message: 'Service unavailable' }, 503),
    });
    await app.page.getByRole('button', { name: 'Search with my wallet' }).click();
    await expect(
      app.progress(/^No deposits were found at your possible deposit addresses on Bitcoin\./)
    ).toBeVisible({ timeout: 60_000 });
    expect(world.bitcoin.addressLookups).not.toContain(far);
    await app.page.getByRole('button', { name: 'Keep scanning' }).click();
    await expect(app.progress(/^Found 1 deposit address for this wallet\./)).toBeVisible({
      timeout: 60_000,
    });
    await expect(foundButton(app, far)).toBeVisible();
    const first = addressAt(world, wallets, 0);
    expect(world.bitcoin.addressLookups.filter(a => a === first)).toHaveLength(1);
  });
});
