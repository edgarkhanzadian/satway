import {
  type OneClickQuoteRequest,
  QUOTE_REFERRAL,
  SBTC_WITHDRAWAL_DUST_LIMIT_SATS,
  type WithdrawalFlowConfig,
  encodeWithdrawalRecipient,
} from '@satway/core';

import { BadRequest } from './errors.js';
import {
  assertOriginChainExactInput,
  bodyObject,
  checkedAppFees,
  deadlineWithin,
  dryFlag,
  str,
} from './quote-checks.js';

type WithdrawalProxyConfig = Pick<
  WithdrawalFlowConfig,
  | 'btcAssetId'
  | 'appFeeBps'
  | 'appFeeRecipient'
  | 'minWithdrawalSats'
  | 'withdrawalDeadlineMinutes'
  | 'withdrawalSlippageOptionsBps'
>;

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
  const b = bodyObject(body);

  if (b.originAsset !== config.btcAssetId) {
    throw new BadRequest('A withdrawal quote must swap from native BTC');
  }
  const destinationAsset = str(b.destinationAsset, 'destinationAsset');
  if (destinationAsset === config.btcAssetId) {
    throw new BadRequest('A withdrawal quote must swap to something other than BTC');
  }
  assertOriginChainExactInput(b);
  const recipient = str(b.recipient, 'recipient');
  if (/\s/.test(recipient)) throw new BadRequest('"recipient" must not contain spaces');
  const refundTo = bitcoinRefundAddress(b.refundTo);
  const amount = withdrawalAmount(b.amount, config.minWithdrawalSats);
  const dry = dryFlag(b.dry);
  const slippage = b.slippageTolerance;
  if (typeof slippage !== 'number' || !config.withdrawalSlippageOptionsBps.includes(slippage)) {
    throw new BadRequest(
      `"slippageTolerance" must be one of ${config.withdrawalSlippageOptionsBps.join(', ')} basis points`
    );
  }
  const deadline = deadlineWithin(b.deadline, config.withdrawalDeadlineMinutes, now);

  const request: OneClickQuoteRequest = {
    dry,
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

  const appFees = checkedAppFees(b.appFees, config);
  if (appFees.length > 0) request.appFees = appFees;

  return request;
}
