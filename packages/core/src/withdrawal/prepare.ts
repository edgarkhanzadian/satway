import { fetchFeeEstimate } from '../bitcoin/index.js';
import {
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
  assertStatusMatchesQuote,
  oneClickQuoteResponseSchema,
  parseOneClickStatus,
} from '../oneclick/index.js';
import {
  type EncodedWithdrawalRecipient,
  type WithdrawalAmountCheck,
  type WithdrawalContractCall,
  type WithdrawalLimits,
  assertActiveWithdrawalContract,
  assertMainnetSender,
  assertRecipientRoundTrip,
  buildWithdrawalContractCall,
  checkWithdrawalAmount,
  fetchWithdrawalLimits,
  withdrawalFeeCap,
} from '../sbtc/index.js';
import { type FetchLike, type WithdrawalFlowConfig, parseWith } from '../shared/index.js';
import { buildWithdrawalQuoteRequest } from './build-quote-request.js';
import { verifyWithdrawalQuote } from './verify-quote.js';

export interface WithdrawalDependencies {
  fetchFn?: FetchLike;
  requestQuote(request: OneClickQuoteRequest): Promise<unknown>;
  fetchSwapStatus(depositAddress: string): Promise<unknown>;
  now?(): Date;
}

export interface PrepareWithdrawalInput {
  sender: string;
  amountSats: number;
  destinationAsset: string;
  recipient: string;
  refundTo: string;
  slippageBps?: number;
  feeRateSatsPerVbyte?: number;
}

export interface WithdrawalReceipt {
  version: 1;
  preparedAt: string;
  sender: string;
  amountSats: number;
  maxFeeSats: number;
  lockedSats: number;
  feeRateSatsPerVbyte: number;
  destinationAsset: string;
  destinationRecipient: string;
  refundTo: string;
  depositAddress: string;
  recipient: EncodedWithdrawalRecipient;
  quoteRequest: OneClickQuoteRequest;
  quoteResponse: OneClickQuoteResponse;
  quoteDeadline: string;
  amountOut: string;
  minAmountOut: string;
  refundFeeSats: number | null;
  contractCall: WithdrawalContractCall;
  limits: WithdrawalLimits;
}

export type PreparedWithdrawal =
  | { ok: false; amountCheck: WithdrawalAmountCheck; limits: WithdrawalLimits }
  | { ok: true; receipt: WithdrawalReceipt };

export async function prepareWithdrawal(
  config: WithdrawalFlowConfig,
  input: PrepareWithdrawalInput,
  deps: WithdrawalDependencies
): Promise<PreparedWithdrawal> {
  const fetchFn = deps.fetchFn;
  assertMainnetSender(input.sender);

  const limits = await fetchWithdrawalLimits(config.sbtcApiUrl, fetchFn);
  const amountCheck = checkWithdrawalAmount(input.amountSats, limits, config.minWithdrawalSats);
  if (!amountCheck.ok) return { ok: false, amountCheck, limits };

  await assertActiveWithdrawalContract(config, fetchFn);

  const feeRateSatsPerVbyte =
    input.feeRateSatsPerVbyte ?? (await fetchFeeEstimate(config.btcApiUrl, 1, fetchFn));
  const maxFeeSats = withdrawalFeeCap(config, feeRateSatsPerVbyte);

  const now = deps.now?.() ?? new Date();
  const quoteRequest = buildWithdrawalQuoteRequest(config, {
    destinationAsset: input.destinationAsset,
    recipient: input.recipient,
    refundTo: input.refundTo,
    amountSats: input.amountSats,
    slippageBps: input.slippageBps,
    dry: false,
    now,
  });
  const quoteResponse = parseWith(
    oneClickQuoteResponseSchema,
    await deps.requestQuote(quoteRequest),
    '1Click quote'
  );
  const verified = verifyWithdrawalQuote(config, quoteRequest, quoteResponse);

  const rawDepositAddress = quoteResponse.quote.depositAddress ?? verified.depositAddress;
  const status: OneClickStatusResponse = parseOneClickStatus(
    await deps.fetchSwapStatus(rawDepositAddress)
  );
  assertStatusMatchesQuote(quoteResponse, status);
  if (status.status !== 'PENDING_DEPOSIT') {
    throw new Error(
      `The swap address is not waiting for a deposit (status ${status.status}); refusing to withdraw to it`
    );
  }

  const contractCall = buildWithdrawalContractCall(config, {
    sender: input.sender,
    amountSats: input.amountSats,
    maxFeeSats,
    recipientAddress: verified.depositAddress,
  });
  assertRecipientRoundTrip(verified.depositAddress, contractCall.arguments.recipient);
  if (contractCall.recipientScriptPubKey !== verified.recipient.scriptPubKey) {
    throw new Error('The withdrawal request would not pay the quoted swap address');
  }

  return {
    ok: true,
    receipt: {
      version: 1,
      preparedAt: now.toISOString(),
      sender: input.sender,
      amountSats: input.amountSats,
      maxFeeSats,
      lockedSats: contractCall.lockedSats,
      feeRateSatsPerVbyte,
      destinationAsset: quoteRequest.destinationAsset,
      destinationRecipient: quoteRequest.recipient,
      refundTo: quoteRequest.refundTo,
      depositAddress: verified.depositAddress,
      recipient: verified.recipient,
      quoteRequest,
      quoteResponse,
      quoteDeadline: quoteRequest.deadline,
      amountOut: verified.amountOut,
      minAmountOut: verified.minAmountOut,
      refundFeeSats: verified.refundFeeSats,
      contractCall,
      limits,
    },
  };
}
