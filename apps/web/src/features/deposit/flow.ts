import { isSupportedOriginChain } from '@satway/chains';
import {
  type DepositIndexOwner,
  type FetchLike,
  type IndexedDepositAddress,
  type NetworkConfig,
  type OneClickToken,
  assertQuoteMatchesRequest,
  buildIndexedDepositAddress,
  buildQuoteRequest,
  checkDepositAmount,
  chooseDepositIndex,
  describeAmountProblem,
  fetchLimits,
  fetchVerifiedSigners,
  largestPayoutSats,
  providerFeesOf,
  toXOnly,
} from '@satway/core';

import { type Backend, type Receipt, loadReceipts } from '../../shared/index.js';

const POPULAR = ['USDC', 'USDT', 'ETH', 'BNB'];

export function depositOrigins(
  tokens: readonly OneClickToken[],
  btcAssetId: string
): OneClickToken[] {
  function rank(t: OneClickToken): number {
    return POPULAR.indexOf(t.symbol) + 1 || POPULAR.length + 1;
  }
  return tokens
    .filter(
      t =>
        t.assetId !== btcAssetId &&
        isSupportedOriginChain(t.blockchain) &&
        t.price > 0 &&
        !/deprecated/i.test(t.symbol)
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.symbol.localeCompare(b.symbol) ||
        a.blockchain.localeCompare(b.blockchain)
    );
}

export interface DepositInput {
  stacksAddress: string;
  reclaimPublicKey: string;
  reclaimKeyAddress: string;
  token: OneClickToken;
  amount: string;
  refundTo: string;
}

export interface Prepared {
  receipt: Receipt;
  expectedSats: number;
  minimumSats: number;
  providerFeeBps: number;
  withdrawFeeSats: number | null;
  warnings: string[];
}

export function liveQuoteWorse(
  preview: Pick<Prepared, 'minimumSats'>,
  live: Pick<Prepared, 'minimumSats'>,
  toleranceBps: number
): boolean {
  return live.minimumSats * 10_000 < preview.minimumSats * (10_000 - toleranceBps);
}

export function toBaseUnits(amount: string, decimals: number): string {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error('Enter an amount like 25 or 0.01');
  const [whole = '0', fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals)
    throw new Error(`At most ${decimals} decimal places for this asset`);
  const units = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (units <= 0n) throw new Error('Amount must be greater than zero');
  return units.toString();
}

export function randomBelow(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 2 ** 32) {
    throw new Error('Cannot draw a random number in that range');
  }
  const limit = 2 ** 32 - (2 ** 32 % maxExclusive);
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] ?? limit;
    if (value < limit) return value % maxExclusive;
  }
}

function ownerKey(owner: DepositIndexOwner): string {
  return [
    owner.stacksAddress,
    toXOnly(owner.reclaimPublicKey),
    toXOnly(owner.signersPublicKey),
  ].join('|');
}

const reservedThisSession = new Map<string, Set<number>>();

function reserve(owner: DepositIndexOwner, depositIndex: number): void {
  const key = ownerKey(owner);
  const set = reservedThisSession.get(key) ?? new Set<number>();
  set.add(depositIndex);
  reservedThisSession.set(key, set);
}

export function localDepositIndices(
  owner: DepositIndexOwner,
  receipts: readonly Receipt[] = loadReceipts()
): number[] {
  const key = ownerKey(owner);
  const saved = receipts.filter(r => ownerKey(r) === key).map(r => r.depositIndex);
  return [...new Set([...saved, ...(reservedThisSession.get(key) ?? [])])].sort((a, b) => a - b);
}

export interface PrepareOptions {
  dry: boolean;
  fetchFn?: FetchLike;
  now?: Date;
  randomInt?(maxExclusive: number): number;
  localIndices?: readonly number[];
}

async function depositAddressFor(
  config: NetworkConfig,
  owner: DepositIndexOwner,
  options: PrepareOptions
): Promise<IndexedDepositAddress> {
  if (options.dry) return buildIndexedDepositAddress({ ...owner, depositIndex: 0 }, config);
  const choice = await chooseDepositIndex({
    config,
    owner,
    localIndices: options.localIndices ?? localDepositIndices(owner),
    randomInt: options.randomInt ?? randomBelow,
    fetchFn: options.fetchFn,
  });
  reserve(owner, choice.deposit.depositIndex);
  return choice.deposit;
}

export async function prepareDeposit(
  config: NetworkConfig,
  backend: Backend,
  input: DepositInput,
  options: PrepareOptions
): Promise<Prepared> {
  const fetchFn = options.fetchFn;
  const [signers, limits] = await Promise.all([
    fetchVerifiedSigners(config, { fetchFn }),
    fetchLimits(config.sbtcApiUrl, fetchFn),
  ]);

  const deposit = await depositAddressFor(
    config,
    {
      stacksAddress: input.stacksAddress,
      reclaimPublicKey: input.reclaimPublicKey,
      signersPublicKey: signers.signersPublicKey,
    },
    options
  );

  const request = buildQuoteRequest(config, {
    originAsset: input.token.assetId,
    amount: toBaseUnits(input.amount, input.token.decimals),
    refundTo: input.refundTo,
    depositAddress: deposit.address,
    dry: options.dry,
    now: options.now,
  });
  const response = await backend.quote(request);
  assertQuoteMatchesRequest(request, response);

  const minimumSats = Number(response.quote.minAmountOut);
  const check = checkDepositAmount(
    minimumSats,
    limits,
    deposit.maxSignerFeeSats,
    largestPayoutSats(response.quote)
  );
  if (!check.ok) {
    throw new Error(check.problems.map(p => describeAmountProblem(p, check)).join(' '));
  }
  const warnings: string[] = [];
  if (check.feeCapCoversWholeAmount) {
    warnings.push(
      `This deposit is smaller than the ${deposit.maxSignerFeeSats}-sat cap on the signers’ fee. That is normally fine, but in a Bitcoin fee spike a small deposit could be mostly consumed by fees.`
    );
  }

  const receipt: Receipt = {
    version: 2,
    scriptVersion: 'v1',
    createdAt: (options.now ?? new Date()).toISOString(),
    stacksAddress: input.stacksAddress,
    reclaimPublicKey: input.reclaimPublicKey,
    reclaimKeyAddress: input.reclaimKeyAddress,
    signersPublicKey: signers.signersPublicKey,
    depositIndex: deposit.depositIndex,
    maxSignerFeeSats: deposit.maxSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
    depositAddress: deposit.address,
    depositScriptPubKey: deposit.scriptPubKey,
    depositScript: deposit.depositScript,
    reclaimScript: deposit.reclaimScript,
    origin: {
      chain: input.token.blockchain,
      symbol: input.token.symbol,
      assetId: input.token.assetId,
      decimals: input.token.decimals,
    },
    refundTo: input.refundTo.trim(),
    quoteResponse: response,
  };

  return {
    receipt,
    expectedSats: Number(response.quote.amountOut),
    minimumSats,
    providerFeeBps: providerFeesOf(request, response).reduce((sum, f) => sum + f.fee, 0),
    withdrawFeeSats: response.quote.withdrawFee ? Number(response.quote.withdrawFee) : null,
    warnings,
  };
}
