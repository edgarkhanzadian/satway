import { PROGRESS } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily, expectWatchRegistered } from '../src/scenario/checks.js';
import { stringField } from '../src/world/http.js';

test('F. every deposit from one wallet gets its own address, and a third one in a fresh page skips the indices Emily knows', async ({
  app,
  world,
  api,
}) => {
  await app.open();
  await app.connectStacksWallet();
  await app.connectEvmWallet();
  await app.fillDeposit({ amount: '100' });
  await app.getQuote();
  const first = await app.continue();
  expectWatchRegistered(api, first.receipt);
  await app.waitForProgress(PROGRESS.awaitingFunds);
  await app.sendFromWallet();
  await app.waitForProgress(PROGRESS.swapping);
  const firstPayout = world.completeSwap();
  expect(firstPayout.swap.recipient).toBe(first.receipt.depositAddress);
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  world.mine(1);
  world.signers.mint(firstPayout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();
  expectRegisteredWithEmily(world, first.receipt, firstPayout.outpoint, 'page');

  await app.startAnother();
  await app.fillDeposit({ amount: '60' });
  await app.getQuote();
  const second = await app.continue();
  expect(second.receipt.depositAddress).not.toBe(first.receipt.depositAddress);
  expect(second.receipt.depositIndex).not.toBe(first.receipt.depositIndex);
  expect(second.receipt.quoteResponse.quote.depositAddress).not.toBe(
    first.receipt.quoteResponse.quote.depositAddress
  );
  expectWatchRegistered(api, second.receipt);
  expect(api.watch(first.receipt.depositAddress)).not.toBeNull();

  await app.waitForProgress(PROGRESS.awaitingFunds);
  await app.tick();
  await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
  await expect(app.definition('Bitcoin payout')).toHaveCount(0);
  await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');
  await app.expectRouteAt('Your chain', 'In progress');

  await app.sendFromWallet();
  await app.waitForProgress(PROGRESS.swapping);
  const secondPayout = world.completeSwap();
  expect(secondPayout.swap.recipient).toBe(second.receipt.depositAddress);
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  await expect(app.page.getByText(secondPayout.outpoint.txid, { exact: true })).toBeVisible();
  expectRegisteredWithEmily(world, second.receipt, secondPayout.outpoint, 'page');
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(secondPayout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();

  await app.page.evaluate(() => localStorage.clear());
  const lookupsBefore = world.emily.reclaimKeyLookups.length;
  await app.open();
  await app.connectStacksWallet();
  await app.connectEvmWallet();
  await app.fillDeposit({ amount: '30' });
  await app.getQuote();
  const third = await app.continue();
  expect(world.emily.reclaimKeyLookups.length).toBeGreaterThan(lookupsBefore);
  expect([first.receipt.depositIndex, second.receipt.depositIndex]).not.toContain(
    third.receipt.depositIndex
  );
  expect(third.receipt.depositAddress).not.toBe(first.receipt.depositAddress);
  expect(third.receipt.depositAddress).not.toBe(second.receipt.depositAddress);
  const checked = world.bitcoin.addressLookups;
  expect(checked.at(-1)).toBe(third.receipt.depositAddress);
  for (const r of [first, second, third]) {
    expect(stringField(r.receipt.quoteResponse.quoteRequest, 'recipient')).toBe(
      r.receipt.depositAddress
    );
  }
});
