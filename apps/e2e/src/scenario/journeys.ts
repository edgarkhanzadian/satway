import { expect } from '@playwright/test';

import { PROGRESS, type PortageApp, type StartedDeposit } from '../app/portage-app.js';
import type { Outpoint } from '../world/bitcoin.js';
import type { PayoutResult, World } from '../world/world.js';

export const FAILED_TO_LOAD =
  /^Failed to load resource: the server responded with a status of \d{3}/;
export const NET_FAILED = /^Failed to load resource: net::ERR_FAILED$/;
export const REFUSED = /^Failed to load resource: net::ERR_CONNECTION_REFUSED$/;

export const SEND_COPY = {
  rejected: 'The request was rejected in your wallet, so nothing was sent.',
  alreadyRecorded:
    'A payment from your wallet is already recorded for this swap, so the wallet was not asked again.',
  checking: 'Checking whether a payment has already arrived…',
  unknown:
    'Can’t confirm the swap status right now. If you have not paid yet you can still send manually using the details above.',
  attemptingHeadline:
    'A payment from your wallet was started for this swap, in this tab or another one, and this page has not heard back from the wallet.',
  uncertainHeadline: 'Your wallet may have sent this payment, but this page could not confirm it.',
  promptOpen:
    'The request may still be open in your wallet, in this browser or on your phone. Approve or reject it there. If your wallet shows no request, this page lets you start again 15 minutes after the payment was started.',
  checkWallet:
    'Check your wallet’s activity before doing anything else. Do not send again, from this wallet or any other, unless you are sure nothing left your wallet.',
  recordedNoTx: 'A payment has been recorded for this swap. Do not send again.',
  resend: 'Send the same signed transaction again',
  sendManually: 'Send the funds from your wallet yourself instead.',
} as const;

export interface EvmStart {
  amount?: string;
  asset?: string;
  connectEvm?: boolean;
  refundTo?: string;
}

export async function startDeposit(
  app: PortageApp,
  options: EvmStart = {}
): Promise<StartedDeposit> {
  await app.open();
  await app.connectStacksWallet();
  if (options.connectEvm !== false) await app.connectEvmWallet();
  await app.fillDeposit({
    amount: options.amount ?? '100',
    ...(options.asset === undefined ? {} : { asset: options.asset }),
    ...(options.refundTo === undefined ? {} : { refundTo: options.refundTo }),
  });
  await app.getQuote();
  return app.continue();
}

export async function startAwaitingFunds(
  app: PortageApp,
  options: EvmStart = {}
): Promise<StartedDeposit> {
  const started = await startDeposit(app, options);
  await app.waitForProgress(PROGRESS.awaitingFunds);
  return started;
}

export async function payOut(
  app: PortageApp,
  world: World,
  options: { reportHash?: boolean; amountSats?: number } = {}
): Promise<PayoutResult> {
  if (world.swap().status === 'PENDING_DEPOSIT') world.reportDeposit();
  await app.waitForProgress(PROGRESS.swapping);
  return world.completeSwap(options);
}

export async function toPayoutConfirmed(app: PortageApp, world: World): Promise<PayoutResult> {
  const payout = await payOut(app, world);
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  return payout;
}

export function savedLabel(started: StartedDeposit): string {
  return `${started.receipt.quoteResponse.quote.amountInFormatted} ${started.receipt.origin.symbol}`;
}

export async function resumeIn(
  app: PortageApp,
  started: StartedDeposit,
  options: { reload?: boolean; evm?: boolean; solana?: boolean } = {}
): Promise<void> {
  if (options.reload === true) await app.page.reload();
  await app.open();
  await app.connectStacksWallet();
  if (options.evm !== false && options.solana !== true) await app.connectEvmWallet();
  if (options.solana === true) await app.connectSolanaWallet();
  await app.resumeSaved(savedLabel(started));
}

export async function finishJourney(app: PortageApp, world: World): Promise<PayoutResult> {
  const payout = await toPayoutConfirmed(app, world);
  world.signers.mint(payout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();
  return payout;
}

export async function expectNoSendOffered(app: PortageApp): Promise<void> {
  await expect(app.sendButton).toHaveCount(0);
}

export function blocksUntilReclaim(world: World, payout: Outpoint, lock = 950): number {
  const height = world.bitcoin.transaction(payout.txid)?.height;
  if (height === null || height === undefined) throw new Error('The payout is not confirmed');
  return Math.max(0, lock - (world.bitcoin.tip.height - height + 1));
}
