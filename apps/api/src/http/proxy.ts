import {
  type NetworkConfig,
  type OneClickAppFee,
  type OneClickQuoteRequest,
  isMainnetTaproot,
} from '@satway/core';

import { BadRequest } from './errors.js';

type FeeConfig = Pick<
  NetworkConfig,
  'btcAssetId' | 'appFeeBps' | 'appFeeRecipient' | 'quoteDeadlineMinutes'
>;

export const DEADLINE_MARGIN_MINUTES = 60;

function str(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new BadRequest(`"${name}" must be a non-empty string`);
  }
  return value;
}

export function sanitizeQuoteRequest(
  body: unknown,
  config: FeeConfig,
  now: Date = new Date()
): OneClickQuoteRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequest('Body must be a JSON object');
  }
  const b: Record<string, unknown> = { ...body };

  if (b.destinationAsset !== config.btcAssetId) {
    throw new BadRequest('Only swaps that pay out native BTC are supported');
  }
  if (b.swapType !== 'EXACT_INPUT') throw new BadRequest('Only EXACT_INPUT is supported');
  if (b.depositType !== 'ORIGIN_CHAIN' || b.refundType !== 'ORIGIN_CHAIN') {
    throw new BadRequest('Deposits and refunds must be on the origin chain');
  }
  if (b.recipientType !== 'DESTINATION_CHAIN') {
    throw new BadRequest('The recipient must be on the destination chain');
  }
  const recipient = str(b.recipient, 'recipient');
  if (!isMainnetTaproot(recipient)) {
    throw new BadRequest('The recipient must be a mainnet taproot address');
  }
  const originAsset = str(b.originAsset, 'originAsset');
  if (originAsset === config.btcAssetId) throw new BadRequest('Origin asset cannot be BTC');
  const amount = str(b.amount, 'amount', 80);
  if (!/^[1-9][0-9]*$/.test(amount))
    throw new BadRequest('"amount" must be a positive integer string');
  if (typeof b.dry !== 'boolean') throw new BadRequest('"dry" must be a boolean');
  const slippage = b.slippageTolerance;
  if (
    typeof slippage !== 'number' ||
    !Number.isInteger(slippage) ||
    slippage < 0 ||
    slippage > 500
  ) {
    throw new BadRequest(
      '"slippageTolerance" must be a whole number between 0 and 500 basis points'
    );
  }
  const deadline = str(b.deadline, 'deadline', 40);
  const deadlineMs = Date.parse(deadline);
  if (Number.isNaN(deadlineMs)) throw new BadRequest('"deadline" must be an ISO date');
  const latestMs = now.getTime() + (config.quoteDeadlineMinutes + DEADLINE_MARGIN_MINUTES) * 60_000;
  if (deadlineMs <= now.getTime() || deadlineMs > latestMs) {
    throw new BadRequest(
      `"deadline" must be in the future and at most ${config.quoteDeadlineMinutes + DEADLINE_MARGIN_MINUTES} minutes away`
    );
  }

  const request: OneClickQuoteRequest = {
    dry: b.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: slippage,
    originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: config.btcAssetId,
    amount,
    refundTo: str(b.refundTo, 'refundTo'),
    refundType: 'ORIGIN_CHAIN',
    recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline,
    referral: 'satway',
  };

  const expected: OneClickAppFee[] =
    config.appFeeBps > 0 && config.appFeeRecipient
      ? [{ recipient: config.appFeeRecipient, fee: config.appFeeBps }]
      : [];
  const given = Array.isArray(b.appFees) ? b.appFees : [];
  if (JSON.stringify(given) !== JSON.stringify(expected)) {
    throw new BadRequest('"appFees" does not match the configured fee');
  }
  if (expected.length > 0) request.appFees = expected;

  return request;
}
