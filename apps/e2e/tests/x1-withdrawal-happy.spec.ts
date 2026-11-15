import { postConditionToHex } from '@stacks/transactions';
import { readFile } from 'node:fs/promises';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as W,
  decodeWithdrawalArguments,
  encodeWithdrawalRecipient,
} from '@satway/core';

import { STEP_NAMES, WITHDRAWAL_STOPS, WITHDRAW_PROGRESS } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  FEE_CAP_SATS,
  FUNDED_SATS,
  WITHDRAW_SATS,
  startWithdrawal,
  toDelivered,
} from '../src/scenario/withdrawal.js';
import { BTC_ASSET_ID, TOKENS } from '../src/world/oneclick.js';
import { SIGNER_FEE_SATS } from '../src/world/withdrawals.js';

test.describe('X1. a withdrawal that works, from sBTC to another chain', () => {
  test('USDC on Base, with the destination filled in from the connected EVM wallet', async ({
    app,
    world,
    wallets,
    api,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets, {
      destinationWallet: 'evm',
    });
    const sender = wallets.stacks.account.stacksAddress;
    const receipt = started.receipt;
    const swap = world.withdrawals.latestSwap();

    expect(started.fileName).toMatch(/^satway-withdrawal-\d{4}-\d{2}-\d{2}-.{8}\.json$/);
    expect(receipt).toMatchObject({
      sender,
      amountSats: WITHDRAW_SATS,
      maxFeeSats: FEE_CAP_SATS,
      depositAddress: swap.swap.depositAddress,
      refundTo: wallets.stacks.account.paymentAddress,
      destination: {
        assetId: TOKENS.usdcBase.assetId,
        chain: 'base',
        address: wallets.evm.address,
      },
    });

    const calls = wallets.stacks.contractCalls;
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call).toMatchObject({
      contract: `${W.sbtcContract}.sbtc-withdrawal`,
      functionName: 'initiate-withdrawal-request',
      postConditionMode: 'deny',
      network: 'mainnet',
    });
    expect(decodeWithdrawalArguments(call?.functionArgs ?? [])).toEqual({
      amountSats: WITHDRAW_SATS,
      maxFeeSats: FEE_CAP_SATS,
      recipient: encodeWithdrawalRecipient(swap.swap.depositAddress).recipient,
    });
    expect(call?.postConditions).toEqual([
      postConditionToHex({
        type: 'ft-postcondition',
        address: sender,
        condition: 'eq',
        asset: `${W.sbtcContract}.sbtc-token::sbtc-token`,
        amount: String(WITHDRAW_SATS + FEE_CAP_SATS),
      }),
    ]);
    expect(receipt.stacksTxid).toBe(call?.txid);

    const quotes = api.requests.filter(r => r.method === 'POST' && r.path === '/withdrawal-quote');
    expect(quotes.map(q => q.status)).toEqual([200, 200]);
    const live = world.oneClick.quotes.filter(q => !q.dry).at(-1);
    expect(live?.request).toMatchObject({
      originAsset: BTC_ASSET_ID,
      destinationAsset: TOKENS.usdcBase.assetId,
      amount: String(WITHDRAW_SATS),
      recipient: wallets.evm.address,
      refundTo: wallets.stacks.account.paymentAddress,
      referral: 'satway',
    });

    await withdraw.expectSteps(['Done', 'In progress']);
    await withdraw.expectRouteAt('sBTC on Stacks', 'In progress');
    const hash = await toDelivered(withdraw, world);

    await expect(app.page.getByRole('heading', { name: 'Withdrawal complete' })).toBeVisible();
    await withdraw.expectSteps(STEP_NAMES.map(() => 'Done'));
    for (const stop of WITHDRAWAL_STOPS) await expect(withdraw.stop(stop)).toContainText('Done');
    await expect(app.definition('Delivery transaction')).toContainText(hash.replace(/^0x/, ''));
    await expect(app.definition('Signer fee charged')).toHaveText(
      `${SIGNER_FEE_SATS.toLocaleString('en-US')} sats`
    );
    expect(world.withdrawals.stacks.balanceOf(sender)).toBe(
      FUNDED_SATS - WITHDRAW_SATS - SIGNER_FEE_SATS
    );
    await expect(app.page.getByText('Check your wallet on base.')).toBeVisible();

    const saved = await app.storage();
    expect(Object.keys(saved)).toContain('satway.withdrawals.v1');
    const remembered: unknown = JSON.parse(saved['satway.withdrawals.v1'] ?? '[]');
    const file: unknown = JSON.parse(await readFile(started.receiptPath, 'utf8'));
    expect(remembered).toEqual([file]);
  });

  test('SOL on Solana, with the address filled in from the Solana wallet', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets, {
      destinationWallet: 'solana',
      asset: 'SOL on sol',
    });
    expect(started.receipt.destination).toMatchObject({
      assetId: TOKENS.sol.assetId,
      chain: 'sol',
      address: wallets.solana.address,
    });
    await toDelivered(withdraw, world);
    await expect(app.page.getByRole('heading', { name: 'Withdrawal complete' })).toBeVisible();
    await expect(app.progress(WITHDRAW_PROGRESS.done)).toBeVisible();
  });

  test('USDC on Solana to an address typed by hand, at 3% slippage', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets, {
      asset: 'USDC on sol',
      recipient: wallets.solana.address,
      slippage: '3%',
    });
    expect(started.receipt.destination.address).toBe(wallets.solana.address);
    expect(world.oneClick.quotes.at(-1)?.request.slippageTolerance).toBe(300);
    await toDelivered(withdraw, world);
    await expect(app.page.getByRole('heading', { name: 'Withdrawal complete' })).toBeVisible();
  });
});
