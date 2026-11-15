import {
  type OneClickAppFee,
  type OneClickQuoteRequest,
  QUOTE_REFERRAL,
  SBTC_WITHDRAWAL_DUST_LIMIT_SATS,
  type WithdrawalFlowConfig,
  encodeWithdrawalRecipient,
} from '@satway/core';

import { BadRequest } from './errors.js';
import { DEADLINE_MARGIN_MINUTES } from './proxy.js';

type WithdrawalProxyConfig = Pick<
  WithdrawalFlowConfig,
  | 'btcAssetId'
  | 'appFeeBps'
  | 'appFeeRecipient'
  | 'minWithdrawalSats'
  | 'withdrawalDeadlineMinutes'
  | 'withdrawalSlippageOptionsBps'
>;

function str(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new BadRequest(`"${name}" must be a non-empty string`);
  }
  return value;
}

function bitcoinRefundAddress(value: unknown): string {
  const text = str(value, 'refundTo', 100);
  try {
    if (encodeWithdrawalRecipient(text).address === text) return text;
  } catch {
    throw new BadRequest('"refundTo" must be a mainnet Bitcoin address');
  }
  throw new BadRequest('"refundTo" must be a Bitcoin address in its standard form');
}

function withdrawalAmount(value: unknown, minimum: number): string {
  const amount = str(value, 'amount', 20);
  if (!/^[1-9][0-9]*$/.test(amount)) {
    throw new BadRequest('"amount" must be a positive integer string');
  }
  const sats = Number(amount);
  const floor = Math.max(minimum, SBTC_WITHDRAWAL_DUST_LIMIT_SATS + 1);
  if (!Number.isSafeInteger(sats) || sats < floor) {
    throw new BadRequest(`"amount" must be a whole number of sats of at least ${floor}`);
  }
  return amount;
}

export function sanitizeWithdrawalQuoteRequest(
  body: unknown,
  config: WithdrawalProxyConfig,
  now: Date = new Date()
): OneClickQuoteRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequest('Body must be a JSON object');
  }
  const b: Record<string, unknown> = { ...body };

  if (b.originAsset !== config.btcAssetId) {
    throw new BadRequest('A withdrawal quote must swap from native BTC');
  }
  const destinationAsset = str(b.destinationAsset, 'destinationAsset');
  if (destinationAsset === config.btcAssetId) {
    throw new BadRequest('A withdrawal quote must swap to something other than BTC');
  }
  if (b.swapType !== 'EXACT_INPUT') throw new BadRequest('Only EXACT_INPUT is supported');
  if (b.depositType !== 'ORIGIN_CHAIN' || b.refundType !== 'ORIGIN_CHAIN') {
    throw new BadRequest('Deposits and refunds must be on the origin chain');
  }
  if (b.recipientType !== 'DESTINATION_CHAIN') {
    throw new BadRequest('The recipient must be on the destination chain');
  }
  const recipient = str(b.recipient, 'recipient');
  if (/\s/.test(recipient)) throw new BadRequest('"recipient" must not contain spaces');
  const refundTo = bitcoinRefundAddress(b.refundTo);
  const amount = withdrawalAmount(b.amount, config.minWithdrawalSats);
  if (typeof b.dry !== 'boolean') throw new BadRequest('"dry" must be a boolean');
  const slippage = b.slippageTolerance;
  if (typeof slippage !== 'number' || !config.withdrawalSlippageOptionsBps.includes(slippage)) {
    throw new BadRequest(
      `"slippageTolerance" must be one of ${config.withdrawalSlippageOptionsBps.join(', ')} basis points`
    );
  }
  const deadline = str(b.deadline, 'deadline', 40);
  const deadlineMs = Date.parse(deadline);
  if (Number.isNaN(deadlineMs)) throw new BadRequest('"deadline" must be an ISO date');
  const windowMinutes = config.withdrawalDeadlineMinutes + DEADLINE_MARGIN_MINUTES;
  if (deadlineMs <= now.getTime() || deadlineMs > now.getTime() + windowMinutes * 60_000) {
    throw new BadRequest(
      `"deadline" must be in the future and at most ${windowMinutes} minutes away`
    );
  }

  const request: OneClickQuoteRequest = {
    dry: b.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: slippage,
    originAsset: config.btcAssetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset,
    amount,
    refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline,
    referral: QUOTE_REFERRAL,
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
