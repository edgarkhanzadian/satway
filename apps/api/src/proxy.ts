import {
  type NetworkConfig,
  type OneClickAppFee,
  type OneClickQuoteRequest,
  isMainnetTaproot,
} from '@portage/core';

export class BadRequest extends Error {}

type FeeConfig = Pick<NetworkConfig, 'btcAssetId' | 'appFeeBps' | 'appFeeRecipient'>;

function str(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new BadRequest(`"${name}" must be a non-empty string`);
  }
  return value;
}

export function sanitizeQuoteRequest(body: unknown, config: FeeConfig): OneClickQuoteRequest {
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
  if (typeof slippage !== 'number' || !(slippage >= 0 && slippage <= 500)) {
    throw new BadRequest('"slippageTolerance" must be between 0 and 500 basis points');
  }
  const deadline = str(b.deadline, 'deadline', 40);
  if (Number.isNaN(Date.parse(deadline))) throw new BadRequest('"deadline" must be an ISO date');

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
    referral: 'portage',
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
