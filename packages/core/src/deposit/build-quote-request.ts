import {
  type OneClickQuoteRequest,
  QUOTE_REFERRAL,
  appFeesFor,
  assertAppFeeConfig,
} from '../oneclick/index.js';
import { isMainnetTaproot } from '../sbtc/index.js';
import type { NetworkConfig } from '../shared/index.js';

export interface BuildQuoteInput {
  originAsset: string;
  amount: string;
  refundTo: string;
  depositAddress: string;
  dry: boolean;
  now?: Date;
}

export function buildQuoteRequest(
  config: Pick<
    NetworkConfig,
    'btcAssetId' | 'slippageBps' | 'quoteDeadlineMinutes' | 'appFeeBps' | 'appFeeRecipient'
  >,
  input: BuildQuoteInput
): OneClickQuoteRequest {
  if (!isMainnetTaproot(input.depositAddress)) {
    throw new Error('Deposit address must be a mainnet taproot address');
  }
  if (!/^[1-9][0-9]*$/.test(input.amount)) {
    throw new Error('Amount must be a positive integer string in base units');
  }
  if (input.originAsset === config.btcAssetId) {
    throw new Error('Origin asset is already BTC; use the sBTC bridge directly');
  }
  if (!input.refundTo.trim()) {
    throw new Error('A refund address on the origin chain is required');
  }
  assertAppFeeConfig(config);

  const now = input.now ?? new Date();
  const deadline = new Date(now.getTime() + config.quoteDeadlineMinutes * 60_000);

  const request: OneClickQuoteRequest = {
    dry: input.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: config.slippageBps,
    originAsset: input.originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: config.btcAssetId,
    amount: input.amount,
    refundTo: input.refundTo.trim(),
    refundType: 'ORIGIN_CHAIN',
    recipient: input.depositAddress,
    recipientType: 'DESTINATION_CHAIN',
    deadline: deadline.toISOString(),
    referral: QUOTE_REFERRAL,
  };
  const appFees = appFeesFor(config);
  if (appFees) request.appFees = appFees;
  return request;
}
