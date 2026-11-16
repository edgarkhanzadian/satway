import {
  type NetworkConfig,
  type OneClickQuoteRequest,
  QUOTE_REFERRAL,
  isMainnetTaproot,
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

export { DEADLINE_MARGIN_MINUTES } from './quote-checks.js';

type FeeConfig = Pick<
  NetworkConfig,
  'btcAssetId' | 'appFeeBps' | 'appFeeRecipient' | 'quoteDeadlineMinutes'
>;

export function sanitizeQuoteRequest(
  body: unknown,
  config: FeeConfig,
  now: Date = new Date()
): OneClickQuoteRequest {
  const b = bodyObject(body);

  if (b.destinationAsset !== config.btcAssetId) {
    throw new BadRequest('Only swaps that pay out native BTC are supported');
  }
  assertOriginChainExactInput(b);
  const recipient = str(b.recipient, 'recipient');
  if (!isMainnetTaproot(recipient)) {
    throw new BadRequest('The recipient must be a mainnet taproot address');
  }
  const originAsset = str(b.originAsset, 'originAsset');
  if (originAsset === config.btcAssetId) throw new BadRequest('Origin asset cannot be BTC');
  const amount = str(b.amount, 'amount', 80);
  if (!/^[1-9][0-9]*$/.test(amount))
    throw new BadRequest('"amount" must be a positive integer string');
  const dry = dryFlag(b.dry);
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
  const deadline = deadlineWithin(b.deadline, config.quoteDeadlineMinutes, now);

  const request: OneClickQuoteRequest = {
    dry,
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
    referral: QUOTE_REFERRAL,
  };

  const appFees = checkedAppFees(b.appFees, config);
  if (appFees.length > 0) request.appFees = appFees;

  return request;
}
