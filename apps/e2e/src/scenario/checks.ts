import { expect } from '@playwright/test';
import { Cl } from '@stacks/transactions';

import type { ReceiptFile } from '../app/receipt.js';
import type { Wallets } from '../browser/harness.js';
import type { ApiWorker } from '../worker/worker.js';
import { type Outpoint, addressOfScript, depositOutputScript } from '../world/bitcoin.js';
import { field, parseJson } from '../world/http.js';
import { parseDepositScript, parseReclaimScript } from '../world/sbtc-scripts.js';
import type { Caller, World } from '../world/world.js';

function plain(value: unknown): unknown {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  return copy;
}

export function stacksPrincipalHex(stacksAddress: string): string {
  return Cl.serialize(Cl.standardPrincipal(stacksAddress));
}

export function expectReceiptMatchesWorld(
  receipt: ReceiptFile,
  input: { world: World; wallets: Wallets; refundTo: string; assetId: string }
): void {
  const { world, wallets } = input;
  const account = wallets.stacks.account;
  expect(receipt.stacksAddress).toBe(account.stacksAddress);
  expect(receipt.reclaimPublicKey).toBe(account.paymentKey.xOnly);
  expect(receipt.reclaimKeyAddress).toBe(account.paymentAddress);
  expect(receipt.signersPublicKey).toBe(world.signer.xOnly);
  expect(Number.isSafeInteger(receipt.depositIndex)).toBe(true);
  expect(receipt.depositIndex).toBeGreaterThanOrEqual(0);
  expect(receipt.depositIndex).toBeLessThan(65_536);
  expect(receipt.maxSignerFeeSats).toBe(80_000 + receipt.depositIndex);
  expect(receipt.reclaimLockBlocks).toBe(950);
  expect(receipt.refundTo).toBe(input.refundTo);
  expect(receipt.origin.assetId).toBe(input.assetId);

  const outputScript = depositOutputScript(receipt.depositScript, receipt.reclaimScript);
  expect(receipt.depositScriptPubKey).toBe(outputScript);
  expect(addressOfScript(outputScript)).toBe(receipt.depositAddress);

  const deposit = parseDepositScript(receipt.depositScript);
  expect(deposit).toEqual({
    maxFee: receipt.maxSignerFeeSats,
    recipient: stacksPrincipalHex(account.stacksAddress),
    signerKey: world.signer.xOnly,
  });
  expect(parseReclaimScript(receipt.reclaimScript)).toEqual({
    lockTime: 950,
    key: account.paymentKey.xOnly,
  });

  const swap = world.swap(receipt.quoteResponse.quote.depositAddress);
  expect(swap.quote.dry).toBe(false);
  expect(receipt.quoteResponse).toEqual(plain(swap.quote.response));
  expect(receipt.quoteResponse.quoteRequest.recipient).toBe(receipt.depositAddress);
  expect(swap.recipient).toBe(receipt.depositAddress);
}

export function expectWatchRegistered(api: ApiWorker, receipt: ReceiptFile): void {
  const posts = api.requests.filter(r => r.method === 'POST' && r.path === '/deposits');
  const last = posts.at(-1);
  if (!last?.requestBody) throw new Error('POST /deposits never reached the Worker');
  expect(last.status).toBe(201);
  expect(parseJson(last.requestBody)).toEqual({
    depositScript: receipt.depositScript,
    reclaimScript: receipt.reclaimScript,
    swapDepositAddress: receipt.quoteResponse.quote.depositAddress,
  });
  const watch = api.watch(receipt.depositAddress);
  expect(field(watch, 'depositScript')).toBe(receipt.depositScript);
  expect(field(watch, 'reclaimScript')).toBe(receipt.reclaimScript);
  expect(field(watch, 'swapDepositAddress')).toBe(receipt.quoteResponse.quote.depositAddress);
  expect(typeof field(watch, 'deadline')).toBe('string');
  expect(Array.isArray(field(watch, 'registered'))).toBe(true);
}

export interface NotifierRun {
  watched: number;
  processed?: number;
  skipped?: number;
  notified?: unknown[];
  finished?: unknown[];
  expired?: unknown[];
  deferred?: unknown[];
  errors?: unknown[];
}

export const NOTIFIER_BUDGET = 40;

export function notifierRun(run: NotifierRun): Record<string, unknown> {
  return {
    runIndex: expect.any(Number),
    budget: NOTIFIER_BUDGET,
    subrequests: expect.any(Number),
    listed: expect.any(Number),
    folded: expect.any(Number),
    pending: expect.any(Number),
    processed: run.watched,
    skipped: 0,
    notified: [],
    finished: [],
    expired: [],
    deferred: [],
    errors: [],
    ...run,
  };
}

export function expectRegisteredWithEmily(
  world: World,
  receipt: ReceiptFile,
  payout: Outpoint,
  by: Caller,
  options: { failedAttemptsFirst?: number } = {}
): void {
  const tx = world.bitcoin.transaction(payout.txid);
  if (!tx) throw new Error(`The payout ${payout.txid} is not on the world chain`);
  const all = world
    .requestsTo('emily', { method: 'POST', path: '/deposit' })
    .map(p => ({ caller: p.caller, status: p.status, body: parseJson(p.requestBody ?? '{}') }))
    .filter(p => field(p.body, 'bitcoinTxid') === payout.txid);
  const failed = options.failedAttemptsFirst ?? 0;
  expect(all.slice(0, failed).every(p => p.status !== 201)).toBe(true);
  const posts = all.slice(failed);
  expect(posts.map(p => p.caller)).toEqual([by]);
  expect(posts[0]?.status).toBe(201);
  for (const attempt of all) expect(attempt.body).toEqual(posts[0]?.body);
  expect(posts[0]?.body).toEqual({
    bitcoinTxid: payout.txid,
    bitcoinTxOutputIndex: payout.vout,
    depositScript: receipt.depositScript,
    reclaimScript: receipt.reclaimScript,
    transactionHex: tx.hex,
  });
  const stored = world.emily.get(payout.txid, payout.vout);
  expect(stored?.recipient).toBe(stacksPrincipalHex(receipt.stacksAddress));
  expect(stored?.amount).toBe(tx.outputs[payout.vout]?.value);
}

export function erc20TransferData(to: string, amount: bigint): string {
  return `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`;
}
