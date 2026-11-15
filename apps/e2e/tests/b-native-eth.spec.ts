import { PROGRESS } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  expectReceiptMatchesWorld,
  expectRegisteredWithEmily,
  expectWatchRegistered,
} from '../src/scenario/checks.js';
import { TOKENS } from '../src/world/oneclick.js';

test('B. native ETH on Ethereum mainnet is a plain value transfer from the EVM wallet', async ({
  app,
  world,
  api,
  wallets,
}) => {
  await app.open();
  await app.connectStacksWallet();
  await app.connectEvmWallet();
  await app.fillDeposit({ asset: 'ETH on eth', amount: '0.05' });
  await expect(app.refundInput).toHaveValue(wallets.evm.address);

  const preview = await app.getQuote();
  const dry = world.oneClick.latestQuote(true);
  expect(dry.amountIn).toBe('50000000000000000');
  expect(preview.expectedSats).toBe(dry.amountOut);

  const { receipt } = await app.continue();
  expectReceiptMatchesWorld(receipt, {
    world,
    wallets,
    refundTo: wallets.evm.address,
    assetId: TOKENS.eth.assetId,
  });
  expectWatchRegistered(api, receipt);
  const quote = receipt.quoteResponse.quote;

  await app.waitForProgress(PROGRESS.awaitingFunds);
  await expect(app.page.getByText(`${quote.amountInFormatted} ETH on eth`)).toBeVisible();
  await app.sendFromWallet();
  await expect(app.progress('Sent from your wallet.')).toBeVisible();

  expect(wallets.evm.behaviour.calls('wallet_switchEthereumChain')).toEqual([]);
  expect(wallets.evm.behaviour.calls('eth_sendTransaction').map(c => c.params)).toEqual([
    [
      {
        from: wallets.evm.address,
        to: quote.depositAddress,
        value: `0x${BigInt(quote.amountIn).toString(16)}`,
      },
    ],
  ]);
  const [sent] = [...world.evm.transactions.values()];
  expect(sent?.chainId).toBe(1);
  expect(sent?.data).toBeNull();
  expect(world.oneClick.arrivals).toEqual([
    {
      depositAddress: quote.depositAddress,
      assetId: TOKENS.eth.assetId,
      amount: BigInt(quote.amountIn),
      txHash: sent?.hash,
    },
  ]);

  await app.waitForProgress(PROGRESS.swapping);
  const payout = world.completeSwap();
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(payout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();
});
