import {
  type AddressOutput,
  type EmilyDepositStatus,
  type FetchLike,
  type NetworkConfig,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
  type OneClickSwapStatus,
  type OneClickToken,
  type OutpointSnapshot,
  type PayoutBasis,
  type Progress,
  type RegistrationFailureKind,
  type WatchedDepositContext,
  applyRegistrations,
  assertQuoteMatchesRequest,
  buildDepositAddress,
  buildQuoteRequest,
  checkDepositAmount,
  describeAmountProblem,
  errorMessage,
  fetchLimits,
  fetchVerifiedSigners,
  largestPayoutSats,
  observeDeposit,
  outpointOf,
  providerFeesOf,
  registerOutputs,
  snapshotOutpoints,
} from '@portage/core';

import type { Receipt } from './receipt.js';

export interface Backend {
  tokens(): Promise<OneClickToken[]>;
  quote(request: OneClickQuoteRequest): Promise<OneClickQuoteResponse>;
  status(depositAddress: string, depositMemo?: string): Promise<OneClickStatusResponse>;
  register(
    depositScript: string,
    reclaimScript: string,
    swapDepositAddress?: string
  ): Promise<{ address: string }>;
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

async function snapshotPrior(
  config: NetworkConfig,
  address: string,
  scriptPubKey: string,
  fetchFn: FetchLike | undefined
): Promise<OutpointSnapshot> {
  try {
    return await snapshotOutpoints(config.btcApiUrl, address, scriptPubKey, { fetchFn });
  } catch (err) {
    throw new Error(
      `Could not read your Bitcoin deposit address, so the deposit was not started: ${errorMessage(err) ?? String(err)}`,
      { cause: err }
    );
  }
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
  const [response, prior] = await Promise.all([
    backend.quote(request),
    options.dry ? null : snapshotPrior(config, deposit.address, deposit.scriptPubKey, fetchFn),
  ]);
  assertQuoteMatchesRequest(request, response);

  const minimumSats = Number(response.quote.minAmountOut);
  const check = checkDepositAmount(
    minimumSats,
    limits,
    config.maxSignerFeeSats,
    largestPayoutSats(response.quote)
  );
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
    ...(prior ? { priorOutpoints: prior.outpoints, priorTruncated: prior.truncated } : {}),
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
  payout: AddressOutput | null;
  basis: PayoutBasis | null;
  mint: EmilyDepositStatus | null;
  candidates: AddressOutput[];
  otherOutputs: AddressOutput[];
  belowMinimum: AddressOutput[];
  outputs: AddressOutput[];
  mints: ReadonlyMap<string, EmilyDepositStatus | null>;
  tipHeight: number | null;
  truncated: boolean;
  registrationError: string | null;
  registrationErrors: RegistrationErrorNote[];
}

export interface RegistrationErrorNote {
  outpoint: string;
  message: string;
  kind: RegistrationFailureKind;
  status: number | null;
}

export function depositContextOf(receipt: Receipt): WatchedDepositContext {
  return {
    createdAt: receipt.createdAt,
    quoteTimestamp: receipt.quoteResponse.timestamp,
    priorOutpoints: receipt.priorOutpoints,
    priorTruncated: receipt.priorTruncated,
    depositAddress: receipt.depositAddress,
    depositScriptPubKey: receipt.depositScriptPubKey,
    depositScript: receipt.depositScript,
    reclaimScript: receipt.reclaimScript,
    reclaimLockBlocks: receipt.reclaimLockBlocks,
    minAmountOut: receipt.quoteResponse.quote.minAmountOut,
  };
}

export async function checkProgress(
  config: NetworkConfig,
  backend: Backend,
  receipt: Receipt,
  fetchFn?: FetchLike
): Promise<Snapshot> {
  let status: OneClickStatusResponse | null = null;
  const swapAddress = receipt.quoteResponse.quote.depositAddress;
  if (swapAddress) {
    try {
      status = await backend.status(swapAddress, receipt.quoteResponse.quote.depositMemo);
    } catch {
      status = null;
    }
  }

  const observed = await observeDeposit(config, depositContextOf(receipt), status, { fetchFn });
  const results = await registerOutputs(config, receipt, observed.toRegister, fetchFn);
  const o = applyRegistrations(observed, results, receipt.reclaimLockBlocks);
  const { selection } = o;
  const payout = selection.payout;
  const candidateKeys = new Set(selection.candidates.map(outpointOf));
  const registrationErrors = results.flatMap(r =>
    r.failure === null
      ? []
      : [
          {
            outpoint: r.outpoint,
            message: r.failure.message,
            kind: r.failure.kind,
            status: r.failure.status,
          },
        ]
  );
  return {
    progress: o.progress,
    swap: o.swap,
    payout,
    basis: selection.basis,
    mint: payout ? (o.mints.get(outpointOf(payout)) ?? null) : null,
    candidates: selection.ambiguous ? selection.candidates : [],
    otherOutputs: selection.others.filter(x => !candidateKeys.has(outpointOf(x))),
    belowMinimum: selection.belowMinimum,
    outputs: o.outputs,
    mints: o.mints,
    tipHeight: o.tipHeight,
    truncated: o.truncated,
    registrationError: registrationErrors.map(e => e.message).join(' ') || null,
    registrationErrors,
  };
}
