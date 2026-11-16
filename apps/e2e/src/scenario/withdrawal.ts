import { expect } from '@playwright/test';

import type { SatwayApp } from '../app/satway-app.js';
import {
  type StartedWithdrawal,
  WITHDRAW_PROGRESS,
  WithdrawPage,
  type WithdrawalPreview,
} from '../app/withdraw-app.js';
import type { Wallets } from '../browser/harness.js';
import { EVM_WALLET_NAME } from '../wallets/evm-wallet.js';
import type { ChainTx } from '../world/bitcoin.js';
import type { World } from '../world/world.js';

export const WITHDRAW_SATS = 50_000;
export const FUNDED_SATS = 200_000;
export const FEE_CAP_SATS = 3_000;

export interface WithdrawalStart {
  asset?: string;
  amount?: string;
  recipient?: string;
  destinationWallet?: 'evm';
  fund?: number;
  slippage?: string;
}

export async function openWithdraw(
  app: SatwayApp,
  world: World,
  wallets: Wallets,
  options: Pick<WithdrawalStart, 'destinationWallet' | 'fund'> = {}
): Promise<WithdrawPage> {
  world.withdrawals.fundSbtc(wallets.stacks.account.stacksAddress, options.fund ?? FUNDED_SATS);
  await app.open();
  await app.connectStacksWallet();
  const withdraw = new WithdrawPage(app);
  await withdraw.open();
  const to = app.page.getByRole('region', { name: 'To' });
  if (options.destinationWallet === 'evm') {
    await to.getByRole('button', { name: new RegExp(EVM_WALLET_NAME) }).click();
    await expect(to.getByText(`${EVM_WALLET_NAME} connected`)).toBeVisible();
  }
  return withdraw;
}

export async function quoteWithdrawal(
  withdraw: WithdrawPage,
  options: WithdrawalStart = {}
): Promise<WithdrawalPreview> {
  await withdraw.fill({
    ...(options.asset === undefined ? {} : { asset: options.asset }),
    amount: options.amount ?? String(WITHDRAW_SATS),
    ...(options.recipient === undefined ? {} : { recipient: options.recipient }),
    ...(options.slippage === undefined ? {} : { slippage: options.slippage }),
  });
  return withdraw.getQuote();
}

export async function startWithdrawal(
  app: SatwayApp,
  world: World,
  wallets: Wallets,
  options: WithdrawalStart = { destinationWallet: 'evm' }
): Promise<{ withdraw: WithdrawPage; started: StartedWithdrawal }> {
  const withdraw = await openWithdraw(app, world, wallets, options);
  await quoteWithdrawal(withdraw, options);
  await withdraw.continueToConfirm();
  const started = await withdraw.sign();
  return { withdraw, started };
}

export async function toAwaitingSigners(withdraw: WithdrawPage, world: World): Promise<void> {
  await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
  world.withdrawals.confirmRequest();
  await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingSigners);
}

export async function toPayoutConfirmed(withdraw: WithdrawPage, world: World): Promise<ChainTx> {
  await toAwaitingSigners(withdraw, world);
  const payout = world.withdrawals.signersAccept();
  await withdraw.waitFor(WITHDRAW_PROGRESS.payoutBroadcast);
  world.mine(1);
  await withdraw.waitFor(WITHDRAW_PROGRESS.payoutConfirmed);
  return payout;
}

export async function deliverFromSigners(withdraw: WithdrawPage, world: World): Promise<string> {
  const payout = world.withdrawals.signersAccept();
  world.mine(1);
  await withdraw.waitFor(WITHDRAW_PROGRESS.payoutConfirmed);
  world.withdrawals.swapReceives(payout);
  await withdraw.waitFor(WITHDRAW_PROGRESS.swapping);
  const hash = world.withdrawals.swapDelivers();
  await withdraw.waitFor(WITHDRAW_PROGRESS.done);
  return hash;
}

export async function toDelivered(withdraw: WithdrawPage, world: World): Promise<string> {
  const payout = await toPayoutConfirmed(withdraw, world);
  world.withdrawals.swapReceives(payout);
  await withdraw.waitFor(WITHDRAW_PROGRESS.swapping);
  const hash = world.withdrawals.swapDelivers();
  await withdraw.waitFor(WITHDRAW_PROGRESS.done);
  return hash;
}
