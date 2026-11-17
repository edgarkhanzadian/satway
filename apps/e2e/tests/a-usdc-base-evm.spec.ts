import { NEW_ADDRESS_NOTE, PROGRESS } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  erc20TransferData,
  expectReceiptMatchesWorld,
  expectRegisteredWithEmily,
  expectWatchRegistered,
  notifierRun,
} from '../src/scenario/checks.js';
import { PROVIDER_FEE_BPS, TOKENS, WITHDRAW_FEE_SATS } from '../src/world/oneclick.js';

test.describe('A. USDC on Base from the injected EVM wallet', () => {
  test('the open tab registers the payout and follows it to Done @webkit', async ({
    app,
    world,
    api,
    wallets,
  }) => {
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();

    await expect(app.assetSelect).toHaveValue(TOKENS.usdcBase.assetId);
    await expect(app.assetSelect.locator('option')).toHaveText(['USDC on base', 'ETH on eth']);
    await expect(app.refundInput).toHaveValue(wallets.evm.address);

    await app.fillDeposit({ amount: '100' });
    const preview = await app.getQuote();
    const dry = world.oneClick.latestQuote(true);
    expect(dry.record.authorization).toBe('Bearer e2e-test-oneclick-jwt');
    expect(dry.amountIn).toBe('100000000');
    expect(preview.expectedSats).toBe(dry.amountOut);
    expect(preview.minimumSats).toBe(dry.minAmountOut);
    expect(preview.providerFees).toBe(
      `${PROVIDER_FEE_BPS / 100}% plus ${WITHDRAW_FEE_SATS.toLocaleString('en-US')} sats Bitcoin withdrawal`
    );
    expect(preview.ourFee).toBe('0%');

    const { receipt, fileName } = await app.continue();
    expect(fileName).toBe(
      `satway-deposit-${receipt.createdAt.slice(0, 10)}-${receipt.depositAddress.slice(-8)}.json`
    );
    expect(preview.paysOutTo).toBe(NEW_ADDRESS_NOTE);
    expect(receipt.quoteResponse.quoteRequest.recipient).toBe(receipt.depositAddress);
    expectReceiptMatchesWorld(receipt, {
      world,
      wallets,
      refundTo: wallets.evm.address,
      assetId: TOKENS.usdcBase.assetId,
    });
    expectWatchRegistered(api, receipt);
    expect(api.requests.filter(r => r.method === 'OPTIONS').map(r => [r.path, r.status])).toEqual([
      ['/quote', 204],
      ['/quote', 204],
      ['/deposits', 204],
    ]);

    const quote = receipt.quoteResponse.quote;
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await expect(app.page.getByText(`${quote.amountInFormatted} USDC on base`)).toBeVisible();
    await expect(app.page.getByText(quote.depositAddress, { exact: true })).toBeVisible();
    await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');
    await app.expectRouteAt('Your chain', 'In progress');

    await app.sendFromWallet();
    await expect(app.progress('Sent from your wallet.')).toBeVisible();
    await expect(app.sendButton).toHaveCount(0);

    expect(wallets.evm.behaviour.calls('wallet_switchEthereumChain').map(c => c.params)).toEqual([
      [{ chainId: '0x2105' }],
    ]);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction').map(c => c.params)).toEqual([
      [
        {
          from: wallets.evm.address,
          to: TOKENS.usdcBase.contractAddress,
          value: '0x0',
          data: erc20TransferData(quote.depositAddress, BigInt(quote.amountIn)),
        },
      ],
    ]);
    expect([...world.evm.transactions.values()].map(t => t.chainId)).toEqual([8453]);
    expect(world.swap(quote.depositAddress).status).toBe('PROCESSING');

    await app.waitForProgress(PROGRESS.swapping);
    await app.expectRouteAt('Swap to BTC', 'In progress');
    await expect(app.sendButton).toHaveCount(0);

    const payout = world.completeSwap();
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    await app.expectRouteAt('Bitcoin deposit', 'In progress');
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');
    await expect(app.sendButton).toHaveCount(0);

    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 1 }));
    expect(api.watched()).toEqual([receipt.depositAddress]);
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');

    world.mine(1);
    await app.waitForProgress(PROGRESS.minting);
    expect(await api.runScheduled()).toEqual(
      notifierRun({ watched: 1, finished: [receipt.depositAddress] })
    );
    expect(api.watched()).toEqual([]);
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');
    await app.expectRouteAt('sBTC on Stacks', 'In progress');

    world.signers.mint(payout.outpoint);
    await app.waitForProgress(PROGRESS.done);
    await app.expectComplete();
    expect(world.emily.get(payout.outpoint.txid, 0)?.status).toBe('confirmed');
  });

  test('with the tab closed, the Worker notifier registers the payout', async ({
    app,
    world,
    api,
    wallets,
  }) => {
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '250' });
    await app.getQuote();
    const { receipt } = await app.continue();
    expectWatchRegistered(api, receipt);
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await app.sendFromWallet();
    await app.waitForProgress(PROGRESS.swapping);
    await app.page.close();

    const payout = world.completeSwap();
    const report = await api.runScheduled();
    expect(report).toEqual(
      notifierRun({
        watched: 1,
        notified: [{ address: receipt.depositAddress, txid: payout.outpoint.txid, vout: 0 }],
      })
    );
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'notifier');
    expect(api.watched()).toEqual([receipt.depositAddress]);
    world.mine(1);
    expect(await api.runScheduled()).toEqual(
      notifierRun({ watched: 1, finished: [receipt.depositAddress] })
    );
    expect(api.watched()).toEqual([]);

    const later = await app.newTab();
    await later.open();
    await later.connectStacksWallet();
    await later.openYourDeposits();
    await later.pickSavedReceipt(`${receipt.quoteResponse.quote.amountInFormatted} USDC`);
    await expect(later.progress(PROGRESS.minting)).toBeVisible();
    await later.followDeposit();
    await later.waitForProgress(PROGRESS.minting);
    await expect(later.sendButton).toHaveCount(0);

    world.signers.mint(payout.outpoint);
    await later.waitForProgress(PROGRESS.done);
    await later.expectComplete();
    expect(world.requestsTo('emily', { method: 'POST', caller: 'page' })).toEqual([]);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(1);
  });
});
