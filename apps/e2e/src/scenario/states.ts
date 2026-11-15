import { expect } from '@playwright/test';

import { PROGRESS, type SatwayApp, type StartedDeposit } from '../app/satway-app.js';
import type { Wallets } from '../browser/harness.js';
import type { PayoutResult, World } from '../world/world.js';
import { type EvmStart, startAwaitingFunds, toPayoutConfirmed } from './journeys.js';
import { RECLAIM_COPY } from './reclaim.js';

export const RECLAIM_LOCK_BLOCKS = 950;

export interface ReclaimableDeposit {
  started: StartedDeposit;
  payout: PayoutResult;
}

export async function toReclaimable(
  app: SatwayApp,
  world: World,
  options: EvmStart = {}
): Promise<ReclaimableDeposit> {
  const started = await startAwaitingFunds(app, options);
  await app.sendFromWallet();
  const payout = await toPayoutConfirmed(app, world);
  world.mine(RECLAIM_LOCK_BLOCKS - 1);
  await app.waitForProgress(RECLAIM_COPY.signersMayMint);
  await expect(app.definition('Reclaim available')).toHaveText('now, from the Recover tab');
  return { started, payout };
}

export async function openReceiptInRecover(app: SatwayApp, started: StartedDeposit): Promise<void> {
  await app.openRecover();
  await app.uploadReceipt(started.receiptPath);
  await expect(
    app.page.getByText(started.receipt.reclaimKeyAddress, { exact: true })
  ).toBeVisible();
  await app.harnessIdle();
}

export async function toMinting(
  app: SatwayApp,
  world: World,
  options: EvmStart = {}
): Promise<ReclaimableDeposit> {
  const started = await startAwaitingFunds(app, options);
  await app.sendFromWallet();
  const payout = await toPayoutConfirmed(app, world);
  await expect(app.progress(PROGRESS.minting)).toBeVisible();
  return { started, payout };
}

export function walletSent(wallets: Wallets): number {
  return wallets.evm.behaviour.calls('eth_sendTransaction').length;
}
