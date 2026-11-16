import { PROGRESS } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  expectReceiptMatchesWorld,
  expectRegisteredWithEmily,
  expectWatchRegistered,
} from '../src/scenario/checks.js';
import { field } from '../src/world/http.js';
import { TOKENS } from '../src/world/oneclick.js';

test('D. manual send: no chain wallet connected, the user pays the shown address themselves', async ({
  app,
  world,
  api,
  wallets,
}) => {
  const refundTo = world.rng.evmAddress();
  await app.open();
  await app.connectStacksWallet();
  await expect(app.from.getByText('Test EVM Wallet', { exact: true })).toBeVisible();
  await app.fillDeposit({ asset: 'USDC on base', amount: '40', refundTo });
  await app.getQuote();
  const { receipt } = await app.continue();
  expectReceiptMatchesWorld(receipt, {
    world,
    wallets,
    refundTo,
    assetId: TOKENS.usdcBase.assetId,
  });
  expectWatchRegistered(api, receipt);
  const quote = receipt.quoteResponse.quote;

  await app.waitForProgress(PROGRESS.awaitingFunds);
  await expect(app.page.getByText('Send exactly this, from your own wallet:')).toBeVisible();
  await expect(
    app.page.getByText(`${quote.amountInFormatted} USDC on base`, { exact: true })
  ).toBeVisible();
  expect(quote.amountInFormatted).toBe('40.0');
  await expect(app.page.getByText(quote.depositAddress, { exact: true })).toBeVisible();
  await expect(app.page.getByText(`will be refunded to ${refundTo}`)).toBeVisible();
  await expect(app.sendButton).toHaveCount(0);

  world.reportDeposit();
  await app.waitForProgress(PROGRESS.swapping);
  await expect(app.page.getByText('Send exactly this, from your own wallet:')).toHaveCount(0);

  const payout = world.completeSwap();
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(payout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();

  expect(wallets.evm.behaviour.requests).toEqual([]);
  expect(wallets.stacks.behaviour.requests.map(r => r.method)).toEqual(['getAddresses']);
});

test('D. manual send: the amount to send comes from the verified base units, not the provider’s formatted text', async ({
  app,
  world,
}) => {
  world.oneClick.tamper = (response, { dry }) => {
    const quote = field(response, 'quote');
    if (!dry && typeof quote === 'object' && quote !== null)
      Reflect.set(quote, 'amountInFormatted', '400.0');
  };
  await app.open();
  await app.connectStacksWallet();
  await app.fillDeposit({ asset: 'USDC on base', amount: '40', refundTo: world.rng.evmAddress() });
  await app.getQuote();
  const { receipt } = await app.continue();
  expect(receipt.quoteResponse.quote.amountInFormatted).toBe('400.0');
  expect(receipt.quoteResponse.quote.amountIn).toBe('40000000');
  expect(receipt.origin).toMatchObject({ decimals: TOKENS.usdcBase.decimals });

  await app.waitForProgress(PROGRESS.awaitingFunds);
  await expect(app.page.getByText('40.0 USDC on base', { exact: true })).toBeVisible();
  await expect(app.page.getByText(/400\.0/)).toHaveCount(0);

  await app.openYourDeposits();
  expect(await app.savedReceiptLabels()).toEqual([expect.stringMatching(/^40\.0 USDC, started /)]);
});
