import {
  DEADLINE_ECHO_TOLERANCE_MS,
  type OneClickAppFee,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  assertQuoteMatchesRequest,
  providerFeesOf,
} from '../oneclick/index.js';
import {
  type EncodedWithdrawalRecipient,
  assertRecipientRoundTrip,
  encodeWithdrawalRecipient,
} from '../sbtc/index.js';
import type { NetworkConfig, WithdrawalConfig } from '../shared/index.js';

export type WithdrawalQuoteCheckConfig = Pick<NetworkConfig, 'btcAssetId'> &
  Pick<WithdrawalConfig, 'minWithdrawalSats'>;

export interface CheckedWithdrawalQuote {
  amountSats: number;
  amountOut: string;
  minAmountOut: string;
  refundFeeSats: number | null;
  providerFees: OneClickAppFee[];
}

export interface VerifiedWithdrawalQuote extends CheckedWithdrawalQuote {
  depositAddress: string;
  recipient: EncodedWithdrawalRecipient;
}

export class WithdrawalQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalQuoteError';
  }
}

const WHOLE = /^[1-9][0-9]*$/;

function wholeSats(text: string | undefined, what: string): number {
  if (text === undefined || !WHOLE.test(text)) {
    throw new WithdrawalQuoteError(`Quote ${what} is not a whole number of sats`);
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n)) throw new WithdrawalQuoteError(`Quote ${what} is too large`);
  return n;
}

export function checkWithdrawalQuoteEcho(
  config: WithdrawalQuoteCheckConfig,
  sent: OneClickQuoteRequest,
  response: OneClickQuoteResponse
): CheckedWithdrawalQuote {
  assertQuoteMatchesRequest(sent, response);
  if (sent.originAsset !== config.btcAssetId) {
    throw new WithdrawalQuoteError('A withdrawal quote must swap from BTC');
  }
  if (sent.destinationAsset === config.btcAssetId) {
    throw new WithdrawalQuoteError('A withdrawal quote must swap to something other than BTC');
  }
  const amountSats = wholeSats(sent.amount, 'request amount');
  if (amountSats < config.minWithdrawalSats) {
    throw new WithdrawalQuoteError(
      `The withdrawal amount is below the ${config.minWithdrawalSats} sat minimum`
    );
  }
  const quote = response.quote;
  if (quote.depositMemo !== undefined && quote.depositMemo !== '') {
    throw new WithdrawalQuoteError(
      'The quote needs a deposit memo, which an sBTC withdrawal cannot carry'
    );
  }
  if (quote.deadline !== undefined) {
    const quoted = Date.parse(quote.deadline);
    const asked = Date.parse(sent.deadline);
    if (!Number.isFinite(quoted) || quoted + DEADLINE_ECHO_TOLERANCE_MS < asked) {
      throw new WithdrawalQuoteError('The quote expires before the requested deadline');
    }
  }
  return {
    amountSats,
    amountOut: quote.amountOut,
    minAmountOut: quote.minAmountOut,
    refundFeeSats: quote.refundFee === undefined ? null : wholeSats(quote.refundFee, 'refundFee'),
    providerFees: providerFeesOf(sent, response),
  };
}

export function verifyWithdrawalQuote(
  config: WithdrawalQuoteCheckConfig,
  sent: OneClickQuoteRequest,
  response: OneClickQuoteResponse
): VerifiedWithdrawalQuote {
  if (sent.dry) {
    throw new WithdrawalQuoteError('A dry quote has no deposit address and cannot be withdrawn to');
  }
  const checked = checkWithdrawalQuoteEcho(config, sent, response);
  const depositAddress = response.quote.depositAddress;
  if (!depositAddress) throw new WithdrawalQuoteError('Quote has no deposit address');
  const recipient = encodeWithdrawalRecipient(depositAddress);
  assertRecipientRoundTrip(depositAddress, recipient.recipient);
  if (recipient.address === sent.refundTo) {
    throw new WithdrawalQuoteError('The quote deposit address is the refund address');
  }
  return { ...checked, depositAddress: recipient.address, recipient };
}
