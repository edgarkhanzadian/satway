import {
  type EmilyDepositStatus,
  type FetchLike,
  type NetworkConfig,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
  type OneClickSwapStatus,
  type OneClickToken,
  type Payout,
  type Progress,
  assertQuoteMatchesRequest,
  buildDepositAddress,
  buildQuoteRequest,
  checkDepositAmount,
  deriveProgress,
  describeAmountProblem,
  errorMessage,
  fetchDeposit,
  fetchLimits,
  fetchTipHeight,
  fetchVerifiedSigners,
  findPayouts,
  notifyDeposit,
  providerFeesOf,
} from '@stxonector/core';

import type { Receipt } from './receipt.js';

export interface Backend {
  tokens(): Promise<OneClickToken[]>;
  quote(request: OneClickQuoteRequest): Promise<OneClickQuoteResponse>;
  status(depositAddress: string, depositMemo?: string): Promise<OneClickStatusResponse>;
  register(depositScript: string, reclaimScript: string): Promise<{ address: string }>;
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

export async function prepareDeposit(
  config: NetworkConfig,
  backend: Backend,
  input: DepositInput,
  options: { dry: boolean; fetchFn?: FetchLike; now?: Date }
): Promise<Prepared> {
  const fetchFn = options.fetchFn;
  const [signers, limits] = await Promise.all([
    fetchVerifiedSigners(config, { fetchFn }),
    fetchLimits(config.sbtcApiUrl, fetchFn),
  ]);

  const deposit = buildDepositAddress({
    stacksAddress: input.stacksAddress,
    reclaimPublicKey: input.reclaimPublicKey,
    signersPublicKey: signers.signersPublicKey,
    maxSignerFeeSats: config.maxSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
  });

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
  const check = checkDepositAmount(minimumSats, limits, config.maxSignerFeeSats);
  if (!check.ok) {
    throw new Error(check.problems.map(p => describeAmountProblem(p, check)).join(' '));
  }
  const warnings: string[] = [];
  if (check.feeCapCoversWholeAmount) {
    warnings.push(
      `This deposit is smaller than the ${config.maxSignerFeeSats}-sat cap on the signers’ fee. That is normally fine, but in a Bitcoin fee spike a small deposit could be mostly consumed by fees.`
    );
  }

  const receipt: Receipt = {
    version: 1,
    createdAt: (options.now ?? new Date()).toISOString(),
    stacksAddress: input.stacksAddress,
    reclaimPublicKey: input.reclaimPublicKey,
    reclaimKeyAddress: input.reclaimKeyAddress,
    signersPublicKey: signers.signersPublicKey,
    maxSignerFeeSats: config.maxSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
    depositAddress: deposit.address,
    depositScriptPubKey: deposit.scriptPubKey,
    depositScript: deposit.depositScript,
    reclaimScript: deposit.reclaimScript,
    origin: {
      chain: input.token.blockchain,
      symbol: input.token.symbol,
      assetId: input.token.assetId,
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

export interface Snapshot {
  progress: Progress;
  swap: OneClickSwapStatus | null;
  payout: Payout | null;
  mint: EmilyDepositStatus | null;
  registrationError: string | null;
}

export async function checkProgress(
  config: NetworkConfig,
  backend: Backend,
  receipt: Receipt,
  fetchFn?: FetchLike
): Promise<Snapshot> {
  let swap: OneClickSwapStatus | null = null;
  const swapAddress = receipt.quoteResponse.quote.depositAddress;
  if (swapAddress) {
    try {
      swap = (await backend.status(swapAddress, receipt.quoteResponse.quote.depositMemo)).status;
    } catch {
      swap = null;
    }
  }

  const payouts = await findPayouts(
    config.btcApiUrl,
    receipt.depositAddress,
    receipt.depositScriptPubKey,
    fetchFn
  );
  const payout = payouts[0] ?? null;

  let mint: EmilyDepositStatus | null = null;
  if (payout) {
    mint =
      (await fetchDeposit(config.sbtcApiUrl, payout.txid, payout.vout, fetchFn))?.status ?? null;
  }
  let tipHeight: number | null = null;
  try {
    tipHeight = await fetchTipHeight(config.btcApiUrl, fetchFn);
  } catch {
    tipHeight = null;
  }

  let progress = deriveProgress({
    swap,
    payout,
    mint,
    tipHeight,
    reclaimLockBlocks: receipt.reclaimLockBlocks,
  });
  let registrationError: string | null = null;
  if (progress.needsNotification && payout) {
    const registered = await notifyDeposit(
      config,
      {
        bitcoinTxid: payout.txid,
        bitcoinTxOutputIndex: payout.vout,
        depositScript: receipt.depositScript,
        reclaimScript: receipt.reclaimScript,
      },
      fetchFn
    ).catch((err: unknown) => {
      registrationError = errorMessage(err) ?? String(err);
      return null;
    });
    if (registered) {
      mint = registered.status;
      progress = deriveProgress({
        swap,
        payout,
        mint,
        tipHeight,
        reclaimLockBlocks: receipt.reclaimLockBlocks,
      });
    }
  }
  return { progress, swap, payout, mint, registrationError };
}
