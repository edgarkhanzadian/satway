import { expect } from '@playwright/test';

import { PROGRESS, type SatwayApp, type StartedDeposit } from '../app/satway-app.js';
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
  paused:
    'This page could not refresh, so sending from your wallet is paused until it can. You can still send manually using the details above.',
  unknown:
    'Can’t confirm the swap status right now, so the payment details are not shown. If you have already paid, there is nothing more to do here. This page keeps checking.',
  attemptingHeadline:
    'A payment from your wallet was started for this swap, in this tab or another one, and this page has not heard back from the wallet.',
  uncertainHeadline: 'Your wallet may have sent this payment, but this page could not confirm it.',
  promptOpen:
    'The request may still be open in your wallet. Approve or reject it there. If your wallet shows no request, this page lets you start again 15 minutes after the payment was started.',
  checkWallet:
    'Check your wallet’s activity before doing anything else. Do not send again, from this wallet or any other, unless you are sure nothing left your wallet.',
  recordedNoTx: 'A payment has been recorded for this swap. Do not send again.',
  sendManually: 'Send the funds from your wallet yourself instead.',
} as const;

function keepOpen(reason: string): string {
  return `Keep this page open: the deposit is not registered for background tracking yet, because ${reason}. This page keeps trying. Until it succeeds, only this page can register your Bitcoin payment with the sBTC signers, so if you close it, open it again later and load the receipt file.`;
}

export const REGISTRATION_COPY = {
  closable:
    'You can close this page. The deposit continues, and you can check on it later by loading the receipt file.',
  busy: keepOpen('our server is busy'),
  unreachable: keepOpen('our server could not be reached'),
  unknownSwap: keepOpen('the swap provider has not listed this swap yet'),
} as const;

export interface EvmStart {
  amount?: string;
  asset?: string;
  connectEvm?: boolean;
  refundTo?: string;
}

export async function startDeposit(
  app: SatwayApp,
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
  app: SatwayApp,
  options: EvmStart = {}
): Promise<StartedDeposit> {
  const started = await startDeposit(app, options);
  await app.waitForProgress(PROGRESS.awaitingFunds);
  return started;
}

export async function payOut(
  app: SatwayApp,
  world: World,
  options: { reportHash?: boolean; amountSats?: number } = {}
): Promise<PayoutResult> {
  if (world.swap().status === 'PENDING_DEPOSIT') world.reportDeposit();
  await app.waitForProgress(PROGRESS.swapping);
  return world.completeSwap(options);
}

export async function toPayoutConfirmed(app: SatwayApp, world: World): Promise<PayoutResult> {
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
  app: SatwayApp,
  started: StartedDeposit,
  options: { reload?: boolean; evm?: boolean } = {}
): Promise<void> {
  if (options.reload === true) await app.page.reload();
  await app.open();
  await app.connectStacksWallet();
  if (options.evm !== false) await app.connectEvmWallet();
  await app.resumeSaved(savedLabel(started));
}

export async function finishJourney(app: SatwayApp, world: World): Promise<PayoutResult> {
  const payout = await toPayoutConfirmed(app, world);
  world.signers.mint(payout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();
  return payout;
}

export async function expectNoSendOffered(app: SatwayApp): Promise<void> {
  await expect(app.sendButton).toHaveCount(0);
}

export function blocksUntilReclaim(world: World, payout: Outpoint, lock = 950): number {
  const height = world.bitcoin.transaction(payout.txid)?.height;
  if (height === null || height === undefined) throw new Error('The payout is not confirmed');
  return Math.max(0, lock - (world.bitcoin.tip.height - height + 1));
}
