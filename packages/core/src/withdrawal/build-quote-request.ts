import {
  type OneClickQuoteRequest,
  QUOTE_REFERRAL,
  appFeesFor,
  assertAppFeeConfig,
} from '../oneclick/index.js';
import { SBTC_WITHDRAWAL_DUST_LIMIT_SATS, encodeWithdrawalRecipient } from '../sbtc/index.js';
import type { NetworkConfig, WithdrawalConfig } from '../shared/index.js';

export type WithdrawalQuoteConfig = Pick<
  NetworkConfig,
  'btcAssetId' | 'appFeeBps' | 'appFeeRecipient'
> &
  Pick<
    WithdrawalConfig,
    | 'minWithdrawalSats'
    | 'withdrawalDeadlineMinutes'
    | 'withdrawalSlippageOptionsBps'
    | 'withdrawalDefaultSlippageBps'
  >;

export interface BuildWithdrawalQuoteInput {
  destinationAsset: string;
  recipient: string;
  refundTo: string;
  amountSats: number;
  slippageBps?: number;
  dry: boolean;
  now?: Date;
}

const MAX_RECIPIENT_LENGTH = 200;

export function resolveWithdrawalSlippage(
  config: Pick<WithdrawalConfig, 'withdrawalSlippageOptionsBps' | 'withdrawalDefaultSlippageBps'>,
  slippageBps: number | undefined
): number {
  const chosen = slippageBps ?? config.withdrawalDefaultSlippageBps;
  if (!config.withdrawalSlippageOptionsBps.includes(chosen)) {
    throw new Error(
      `Slippage must be one of ${config.withdrawalSlippageOptionsBps.join(', ')} basis points`
    );
  }
  return chosen;
}

export function buildWithdrawalQuoteRequest(
  config: WithdrawalQuoteConfig,
  input: BuildWithdrawalQuoteInput
): OneClickQuoteRequest {
  if (
    !Number.isSafeInteger(input.amountSats) ||
    input.amountSats <= SBTC_WITHDRAWAL_DUST_LIMIT_SATS ||
    input.amountSats < config.minWithdrawalSats
  ) {
    throw new Error(
      `The withdrawal amount must be a whole number of sats of at least ${Math.max(config.minWithdrawalSats, SBTC_WITHDRAWAL_DUST_LIMIT_SATS + 1)}`
    );
  }
  const destinationAsset = input.destinationAsset.trim();
  if (!destinationAsset || destinationAsset !== input.destinationAsset) {
    throw new Error('A destination asset is required');
  }
  if (destinationAsset === config.btcAssetId) {
    throw new Error(
      'The destination is BTC; withdraw sBTC to Bitcoin directly instead of swapping'
    );
  }
  const recipient = input.recipient;
  if (!recipient || /\s/.test(recipient) || recipient.length > MAX_RECIPIENT_LENGTH) {
    throw new Error('A recipient address on the destination chain is required');
  }
  const refundTo = encodeWithdrawalRecipient(input.refundTo).address;
  const slippageTolerance = resolveWithdrawalSlippage(config, input.slippageBps);
  assertAppFeeConfig(config);
  if (
    !Number.isSafeInteger(config.withdrawalDeadlineMinutes) ||
    config.withdrawalDeadlineMinutes <= 0
  ) {
    throw new Error('The withdrawal quote deadline must be a positive number of minutes');
  }

  const now = input.now ?? new Date();
  const deadline = new Date(now.getTime() + config.withdrawalDeadlineMinutes * 60_000);

  const request: OneClickQuoteRequest = {
    dry: input.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance,
    originAsset: config.btcAssetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset,
    amount: String(input.amountSats),
    refundTo,
    refundType: 'ORIGIN_CHAIN',
    recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: deadline.toISOString(),
    referral: QUOTE_REFERRAL,
  };
  const appFees = appFeesFor(config);
  if (appFees) request.appFees = appFees;
  return request;
}
