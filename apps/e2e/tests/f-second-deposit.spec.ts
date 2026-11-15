import { PROGRESS } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily, expectWatchRegistered } from '../src/scenario/checks.js';
import { outpointKey } from '../src/world/bitcoin.js';

test('F. a second deposit to the same Bitcoin deposit address is tracked on its own', async ({
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
  await app.waitForProgress(PROGRESS.awaitingFunds);
  await app.sendFromWallet();
  await app.waitForProgress(PROGRESS.swapping);
  const firstPayout = world.completeSwap();
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  world.mine(1);
  world.signers.mint(firstPayout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();

  await app.startAnother();
  await app.fillDeposit({ amount: '60' });
  await app.getQuote();
  const second = await app.continue();
  expect(second.receipt.depositAddress).toBe(first.receipt.depositAddress);
  expect(second.receipt.quoteResponse.quote.depositAddress).not.toBe(
    first.receipt.quoteResponse.quote.depositAddress
  );
  expect(second.receipt.priorOutpoints).toEqual([outpointKey(firstPayout.outpoint)]);
  expectWatchRegistered(api, second.receipt, { registrations: 2 });

  await app.waitForProgress(PROGRESS.awaitingFunds);
  await app.tick();
  await app.tick();
  await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
  await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
  await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');
  await app.expectRouteAt('Your chain', 'In progress');

  await app.sendFromWallet();
  await app.waitForProgress(PROGRESS.swapping);
  const secondPayout = world.completeSwap();
  expect(secondPayout.swap.depositAddress).toBe(second.receipt.quoteResponse.quote.depositAddress);
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  await expect(app.page.getByText(secondPayout.outpoint.txid, { exact: true })).toBeVisible();
  expectRegisteredWithEmily(world, second.receipt, secondPayout.outpoint, 'page');
  expectRegisteredWithEmily(world, first.receipt, firstPayout.outpoint, 'page');
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(secondPayout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();

  await app.openRecover();
  expect(await app.savedReceiptLabels()).toEqual([
    expect.stringMatching(/^60\.0 USDC, started /),
    expect.stringMatching(/^100\.0 USDC, started /),
  ]);
});
