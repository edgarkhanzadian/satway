import { PROGRESS } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily } from '../src/scenario/checks.js';
import { FAILED_TO_LOAD, savedLabel } from '../src/scenario/journeys.js';
import { json } from '../src/world/http.js';

const STATUS = /^\/v0\/status$/;

test('G. two overlapping deposits from one wallet get their own addresses and never take each other’s payout, even with the swap status unreadable', async ({
  app,
  world,
  harness,
}) => {
  harness.allowConsoleErrors(FAILED_TO_LOAD);
  await app.open();
  await app.connectStacksWallet();
  await app.connectEvmWallet();
  await app.fillDeposit({ amount: '100' });
  await app.getQuote();
  const first = await app.continue();
  await app.waitForProgress(PROGRESS.awaitingFunds);
  await app.sendFromWallet();
  await app.waitForProgress(PROGRESS.swapping);
  await app.page.getByRole('button', { name: 'Hide' }).click();

  await app.fillDeposit({ amount: '60' });
  await app.getQuote();
  const second = await app.continue();
  expect(second.receipt.depositAddress).not.toBe(first.receipt.depositAddress);
  expect(second.receipt.depositIndex).not.toBe(first.receipt.depositIndex);
  expect(second.receipt.maxSignerFeeSats).toBe(80_000 + second.receipt.depositIndex);
  await app.waitForProgress(PROGRESS.awaitingFunds);

  world.addFault({
    service: 'oneclick',
    path: STATUS,
    outcome: json({ message: 'Internal server error' }, 500),
  });
  const firstPayout = world.completeSwap({
    depositAddress: first.receipt.quoteResponse.quote.depositAddress,
  });
  expect(firstPayout.swap.recipient).toBe(first.receipt.depositAddress);
  await app.tick();
  await app.tick();
  await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
  await expect(app.definition('Bitcoin payout')).toHaveCount(0);
  await expect(app.definition('Bitcoin payouts')).toHaveCount(0);
  await expect(app.page.getByText(firstPayout.outpoint.txid)).toHaveCount(0);
  await expect(app.progress(PROGRESS.payoutUnconfirmed)).toHaveCount(0);

  world.clearFaults();
  await app.tick();
  await app.waitForProgress(PROGRESS.awaitingFunds);
  await app.sendFromWallet();
  await app.waitForProgress(PROGRESS.swapping);
  world.addFault({
    service: 'oneclick',
    path: STATUS,
    outcome: json({ message: 'Internal server error' }, 500),
  });
  const secondPayout = world.completeSwap({
    depositAddress: second.receipt.quoteResponse.quote.depositAddress,
  });
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  await expect(app.definition('Bitcoin payout')).toContainText(secondPayout.outpoint.txid);
  await expect(app.page.getByText(firstPayout.outpoint.txid)).toHaveCount(0);
  expectRegisteredWithEmily(world, second.receipt, secondPayout.outpoint, 'page');
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(secondPayout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();
  world.clearFaults();

  await app.openYourDeposits();
  await app.pickSavedReceipt(savedLabel(first));
  await expect(app.definition('Bitcoin payout')).toContainText(firstPayout.outpoint.txid);
  await expect(app.page.getByText(secondPayout.outpoint.txid)).toHaveCount(0);
  expectRegisteredWithEmily(world, first.receipt, firstPayout.outpoint, 'page');
  world.signers.mint(firstPayout.outpoint);
  await app.pickSavedReceipt(savedLabel(second));
  await app.pickSavedReceipt(savedLabel(first));
  await expect(app.progress(PROGRESS.done)).toBeVisible();
});
