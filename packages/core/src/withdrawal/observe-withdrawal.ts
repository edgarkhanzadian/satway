import {
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
  type OneClickSwapStatus,
  StatusEchoMismatchError,
  type SwapRefund,
  assertStatusMatchesQuote,
  deliveryTxHashesOf,
  parseOneClickStatus,
  refundOf,
} from '../oneclick/index.js';
import {
  type OnChainWithdrawalRequest,
  type PayoutVerification,
  type WithdrawalRecipient,
  type WithdrawalStatus,
  type WithdrawalTxFailure,
  assertRecipientRoundTrip,
  decodeWithdrawalRecipient,
  describePayoutProblem,
  fetchAndVerifyWithdrawalPayout,
  followWithdrawalStatus,
  scriptPubKeyOfMainnetAddress,
} from '../sbtc/index.js';
import { type FetchLike, type WithdrawalFlowConfig, errorMessage } from '../shared/index.js';
import {
  type SwapEchoState,
  type WithdrawalProgress,
  deriveWithdrawalProgress,
} from './progress.js';

export interface WatchedWithdrawal {
  stacksTxid: string;
  sender: string;
  amountSats: number;
  maxFeeSats: number;
  depositAddress: string;
  recipient: WithdrawalRecipient;
  quoteResponse: OneClickQuoteResponse;
  quoteDeadline: string;
}

export interface WithdrawalFacts {
  stacksTxid: string;
  requestId: number | null;
  request: OnChainWithdrawalRequest | null;
  txFailure: WithdrawalTxFailure | null;
  feeSats: number | null;
  payoutTxid: string | null;
  payoutVout: number | null;
  payoutConfirmations: number | null;
  payoutVerified: boolean;
  swapStatus: OneClickSwapStatus | null;
  swapEcho: SwapEchoState | null;
  destinationTxHashes: string[];
  refund: SwapRefund | null;
  deadlinePassed: boolean;
  mismatches: string[];
  softMismatches: number;
  errors: string[];
}

export interface WithdrawalObservation {
  stacks: WithdrawalStatus | null;
  payout: PayoutVerification | null;
  facts: WithdrawalFacts;
  progress: WithdrawalProgress;
}

function receiptProblems(watched: WatchedWithdrawal): string[] {
  try {
    assertRecipientRoundTrip(watched.depositAddress, watched.recipient);
    const quoted = watched.quoteResponse.quote.depositAddress;
    if (
      !quoted ||
      scriptPubKeyOfMainnetAddress(quoted) !==
        decodeWithdrawalRecipient(watched.recipient).scriptPubKey
    ) {
      return ['The saved withdrawal pays a different address than its saved quote.'];
    }
    return [];
  } catch (err) {
    return [`The saved withdrawal is not consistent: ${errorMessage(err) ?? String(err)}`];
  }
}

function echoOf(
  quote: OneClickQuoteResponse,
  status: OneClickStatusResponse | null
): { state: SwapEchoState | null; problem: string | null } {
  if (!status) return { state: null, problem: null };
  try {
    assertStatusMatchesQuote(quote, status);
    return { state: 'matched', problem: null };
  } catch (err) {
    if (err instanceof StatusEchoMismatchError && err.field === 'quoteResponse') {
      return { state: 'missing', problem: null };
    }
    return { state: 'mismatch', problem: errorMessage(err) ?? String(err) };
  }
}

function describe(err: unknown, source: string): string {
  return `${source}: ${errorMessage(err) ?? String(err)}`;
}

export async function observeWithdrawal(
  config: WithdrawalFlowConfig,
  watched: WatchedWithdrawal,
  rawSwapStatus: unknown,
  options: { fetchFn?: FetchLike; now?: Date; priorSoftMismatches?: number } = {}
): Promise<WithdrawalObservation> {
  const fetchFn = options.fetchFn;
  const now = options.now ?? new Date();
  const errors: string[] = [];
  const mismatches = receiptProblems(watched);

  let swapStatus: OneClickStatusResponse | null = null;
  if (rawSwapStatus !== null && rawSwapStatus !== undefined) {
    try {
      swapStatus = parseOneClickStatus(rawSwapStatus);
    } catch (err) {
      errors.push(describe(err, 'Swap status'));
    }
  }

  let stacks: WithdrawalStatus | null = null;
  let stacksTxid = watched.stacksTxid;
  try {
    const followed = await followWithdrawalStatus(
      config,
      watched.stacksTxid,
      {
        sender: watched.sender,
        amountSats: watched.amountSats,
        maxFeeSats: watched.maxFeeSats,
        recipient: watched.recipient,
      },
      fetchFn
    );
    stacks = followed.status;
    stacksTxid = followed.stacksTxid;
  } catch (err) {
    errors.push(describe(err, 'Stacks'));
  }
  if (stacks?.kind === 'tx-dropped' && stacks.lookupError) {
    errors.push(`Replacement lookup: ${stacks.lookupError}`);
  }
  const softMismatches =
    stacks?.kind === 'mismatch' && stacks.soft ? (options.priorSoftMismatches ?? 0) + 1 : 0;

  let payout: PayoutVerification | null = null;
  if (stacks?.kind === 'accepted') {
    if (stacks.payoutError) errors.push(`Payout lookup: ${stacks.payoutError}`);
    const txid = stacks.payout?.bitcoinTxid ?? stacks.sweep?.sweepTxid ?? null;
    if (txid && mismatches.length === 0) {
      try {
        const fetched = await fetchAndVerifyWithdrawalPayout(
          config,
          {
            txid,
            vout: stacks.payout?.outputIndex ?? null,
            amountSats: watched.amountSats,
            scriptPubKey: decodeWithdrawalRecipient(watched.recipient).scriptPubKey,
          },
          fetchFn
        );
        payout = fetched.verification;
        if (fetched.tipError) errors.push(`Bitcoin tip: ${fetched.tipError}`);
        for (const problem of payout.problems) {
          if (problem !== 'tx-not-found') mismatches.push(describePayoutProblem(problem));
        }
      } catch (err) {
        errors.push(describe(err, 'Bitcoin'));
      }
    } else if (!txid) {
      errors.push('The sBTC registry does not name a sweep transaction yet.');
    }
  }

  const echo = echoOf(watched.quoteResponse, swapStatus);
  if (echo.problem) mismatches.push(echo.problem);

  let refund: SwapRefund | null = null;
  try {
    refund = refundOf(swapStatus);
  } catch (err) {
    errors.push(describe(err, 'Swap refund'));
  }

  const deadline = Date.parse(watched.quoteDeadline);
  const deadlinePassed = Number.isFinite(deadline) && now.getTime() > deadline;
  const swap = swapStatus?.status ?? null;
  const request = stacks && 'request' in stacks ? stacks.request : null;
  const accepted = stacks?.kind === 'accepted' ? stacks : null;

  const facts: WithdrawalFacts = {
    stacksTxid,
    requestId: request?.requestId ?? (stacks?.kind === 'mismatch' ? stacks.requestId : null),
    request,
    txFailure: stacks?.kind === 'tx-failed' ? stacks.failure : null,
    feeSats: accepted?.payout?.feeSats ?? null,
    payoutTxid: payout?.txid ?? accepted?.payout?.bitcoinTxid ?? null,
    payoutVout: payout?.vout ?? accepted?.payout?.outputIndex ?? null,
    payoutConfirmations: payout?.confirmations ?? null,
    payoutVerified: payout?.ok ?? false,
    swapStatus: swap,
    swapEcho: echo.state,
    destinationTxHashes: deliveryTxHashesOf(
      swapStatus,
      watched.quoteResponse.quoteRequest.recipient
    ),
    refund,
    deadlinePassed,
    mismatches,
    softMismatches,
    errors,
  };

  return {
    stacks,
    payout,
    facts,
    progress: deriveWithdrawalProgress({
      stacks,
      payout,
      swap,
      swapEcho: echo.state,
      mismatches,
      deadlinePassed,
      rejectionBlocks: config.rejectionBlocks,
      softMismatches,
    }),
  };
}
