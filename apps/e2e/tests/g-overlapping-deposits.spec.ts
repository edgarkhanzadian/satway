import { PROGRESS } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily } from '../src/scenario/checks.js';
import { savedLabel } from '../src/scenario/journeys.js';
import { outpointKey } from '../src/world/bitcoin.js';

test('G. two overlapping deposits from one wallet: the second never adopts the first one’s payout', async ({
  app,
  world,
}) => {
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
  expect(second.receipt.depositAddress).toBe(first.receipt.depositAddress);
  expect(second.receipt.priorOutpoints).toEqual([]);
  await app.waitForProgress(PROGRESS.awaitingFunds);

  const firstPayout = world.completeSwap({
    depositAddress: first.receipt.quoteResponse.quote.depositAddress,
  });
  await app.tick();
  await app.tick();
  await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
  await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
  await expect(app.sendButton).toBeVisible();
  await expect(app.definition('Bitcoin payout')).toHaveCount(0);
  await expect(app.definition('Other payments')).toContainText(firstPayout.outpoint.txid);
  expectRegisteredWithEmily(world, first.receipt, firstPayout.outpoint, 'page');

  world.mine(1);
  world.signers.mint(firstPayout.outpoint);
  await app.tick();
  await app.tick();
  await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
  await expect(app.page.getByRole('heading', { name: 'Deposit complete' })).toHaveCount(0);

  await app.sendFromWallet();
  await app.waitForProgress(PROGRESS.swapping);
  await app.tick();
  await expect(app.progress(PROGRESS.swapping)).toBeVisible();
  await expect(app.definition('Bitcoin payout')).toHaveCount(0);
  const secondPayout = world.completeSwap({
    depositAddress: second.receipt.quoteResponse.quote.depositAddress,
  });
  expect(outpointKey(secondPayout.outpoint)).not.toBe(outpointKey(firstPayout.outpoint));
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  await expect(app.definition('Bitcoin payout')).toContainText(secondPayout.outpoint.txid);
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(secondPayout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();

  await app.openRecover();
  await app.pickSavedReceipt(savedLabel(first));
  await expect(app.progress(PROGRESS.done)).toBeVisible();
  await expect(app.definition('Bitcoin payout')).toContainText(firstPayout.outpoint.txid);
});
