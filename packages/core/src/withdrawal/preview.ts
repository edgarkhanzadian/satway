import { fetchFeeEstimate } from '../bitcoin/index.js';
import {
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  oneClickQuoteResponseSchema,
} from '../oneclick/index.js';
import {
  type WithdrawalAmountCheck,
  type WithdrawalLimits,
  checkWithdrawalAmount,
  fetchWithdrawalLimits,
  withdrawalFeeCap,
} from '../sbtc/index.js';
import { type FetchLike, type WithdrawalFlowConfig, parseWith } from '../shared/index.js';
import { buildWithdrawalQuoteRequest } from './build-quote-request.js';
import type { WithdrawalReceipt } from './prepare.js';
import { type CheckedWithdrawalQuote, checkWithdrawalQuoteEcho } from './verify-quote.js';

export interface PreviewWithdrawalInput {
  amountSats: number;
  destinationAsset: string;
  recipient: string;
  refundTo: string;
  slippageBps?: number;
  feeRateSatsPerVbyte?: number;
}

export interface PreviewDependencies {
  fetchFn?: FetchLike;
  requestQuote(request: OneClickQuoteRequest): Promise<unknown>;
  now?(): Date;
}

export interface WithdrawalPreview extends CheckedWithdrawalQuote {
  maxFeeSats: number;
  lockedSats: number;
  feeRateSatsPerVbyte: number;
  quoteRequest: OneClickQuoteRequest;
  quoteResponse: OneClickQuoteResponse;
  limits: WithdrawalLimits;
}

export type PreviewedWithdrawal =
  | { ok: false; amountCheck: WithdrawalAmountCheck; limits: WithdrawalLimits }
  | { ok: true; preview: WithdrawalPreview };

export async function previewWithdrawal(
  config: WithdrawalFlowConfig,
  input: PreviewWithdrawalInput,
  deps: PreviewDependencies
): Promise<PreviewedWithdrawal> {
  const fetchFn = deps.fetchFn;
  const limits = await fetchWithdrawalLimits(config.sbtcApiUrl, fetchFn);
  const amountCheck = checkWithdrawalAmount(input.amountSats, limits, config.minWithdrawalSats);
  if (!amountCheck.ok) return { ok: false, amountCheck, limits };

  const feeRateSatsPerVbyte =
    input.feeRateSatsPerVbyte ?? (await fetchFeeEstimate(config.btcApiUrl, 1, fetchFn));
  const maxFeeSats = withdrawalFeeCap(config, feeRateSatsPerVbyte);

  const quoteRequest = buildWithdrawalQuoteRequest(config, {
    destinationAsset: input.destinationAsset,
    recipient: input.recipient,
    refundTo: input.refundTo,
    amountSats: input.amountSats,
    slippageBps: input.slippageBps,
    dry: true,
    now: deps.now?.() ?? new Date(),
  });
  const quoteResponse = parseWith(
    oneClickQuoteResponseSchema,
    await deps.requestQuote(quoteRequest),
    '1Click quote'
  );
  const checked = checkWithdrawalQuoteEcho(config, quoteRequest, quoteResponse);
  return {
    ok: true,
    preview: {
      ...checked,
      maxFeeSats,
      lockedSats: input.amountSats + maxFeeSats,
      feeRateSatsPerVbyte,
      quoteRequest,
      quoteResponse,
      limits,
    },
  };
}

export interface QuoteChange {
  amountOutDropped: boolean;
  minAmountOutDropped: boolean;
  feeCapRose: boolean;
  worse: boolean;
}

function lower(next: string, before: string): boolean {
  return /^\d+$/.test(next) && /^\d+$/.test(before) && BigInt(next) < BigInt(before);
}

export function compareWithdrawalQuotes(
  preview: Pick<WithdrawalPreview, 'amountOut' | 'minAmountOut' | 'maxFeeSats'>,
  live: Pick<WithdrawalReceipt, 'amountOut' | 'minAmountOut' | 'maxFeeSats'>
): QuoteChange {
  const amountOutDropped = lower(live.amountOut, preview.amountOut);
  const minAmountOutDropped = lower(live.minAmountOut, preview.minAmountOut);
  const feeCapRose = live.maxFeeSats > preview.maxFeeSats;
  return {
    amountOutDropped,
    minAmountOutDropped,
    feeCapRose,
    worse: amountOutDropped || minAmountOutDropped || feeCapRose,
  };
}
