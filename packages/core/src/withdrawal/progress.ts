import type { OneClickSwapStatus } from '../oneclick/index.js';
import type { PayoutVerification, WithdrawalStatus } from '../sbtc/index.js';

export type WithdrawalStage =
  | 'awaiting-stacks-tx'
  | 'tx-replaced'
  | 'request-failed'
  | 'awaiting-signers'
  | 'rejected'
  | 'payout-broadcast'
  | 'payout-confirmed'
  | 'swapping'
  | 'done'
  | 'refunded'
  | 'swap-failed'
  | 'needs-support'
  | 'deadline-passed'
  | 'rechecking'
  | 'mismatch';

export type SwapEchoState = 'matched' | 'missing' | 'mismatch';

export interface WithdrawalObservations {
  stacks: WithdrawalStatus | null;
  payout: PayoutVerification | null;
  swap: OneClickSwapStatus | null;
  swapEcho: SwapEchoState | null;
  mismatches: readonly string[];
  deadlinePassed: boolean;
  rejectionBlocks: number;
  softMismatches?: number;
}

export const SOFT_MISMATCH_CONFIRMATIONS = 3;

function softMismatchPending(o: WithdrawalObservations): boolean {
  return (
    o.stacks?.kind === 'mismatch' &&
    o.stacks.soft &&
    (o.softMismatches ?? 1) < SOFT_MISMATCH_CONFIRMATIONS
  );
}

export interface WithdrawalProgress {
  stage: WithdrawalStage;
  message: string;
  terminal: boolean;
  warning: boolean;
}

function progress(
  stage: WithdrawalStage,
  message: string,
  terminal: boolean,
  warning = false
): WithdrawalProgress {
  return { stage, message, terminal, warning };
}

const SWAP_SEEN: ReadonlySet<OneClickSwapStatus> = new Set([
  'KNOWN_DEPOSIT_TX',
  'PROCESSING',
  'INCOMPLETE_DEPOSIT',
  'SUCCESS',
  'REFUNDED',
  'FAILED',
]);

function mismatchOf(o: WithdrawalObservations): string | null {
  if (o.mismatches.length > 0) return o.mismatches.join(' ');
  if (o.stacks?.kind === 'mismatch' && !softMismatchPending(o)) {
    return o.stacks.problems.join(' ');
  }
  if (o.stacks?.kind === 'not-a-withdrawal') return o.stacks.message;
  if (o.payout && !o.payout.ok && !o.payout.problems.includes('tx-not-found')) {
    return 'The Bitcoin payout does not match the request.';
  }
  if (o.swapEcho === 'mismatch') {
    return 'The swap provider reports a different quote than the one this withdrawal was made for.';
  }
  const neverPaid = o.stacks?.kind === 'tx-failed' || o.stacks?.kind === 'rejected';
  if (neverPaid && o.swap !== null && SWAP_SEEN.has(o.swap)) {
    return 'The swap provider reports activity, but the sBTC withdrawal never paid out.';
  }
  return null;
}

const MISMATCH_ADVICE =
  ' Do not sign anything else for this withdrawal. Keep this page and contact support.';

function swapProgress(swap: OneClickSwapStatus): WithdrawalProgress | null {
  switch (swap) {
    case 'SUCCESS':
      return progress('done', 'The swap is complete and the funds were delivered.', true);
    case 'REFUNDED':
      return progress(
        'refunded',
        'The swap did not complete. The swap provider refunded the BTC to your Bitcoin refund address, minus its refund fee.',
        true
      );
    case 'FAILED':
      return progress(
        'swap-failed',
        'The swap failed. Contact the swap provider with the swap deposit address to recover the funds.',
        true
      );
    case 'INCOMPLETE_DEPOSIT':
      return progress(
        'needs-support',
        'The swap provider says less BTC arrived than quoted. This should not happen with an sBTC withdrawal. Contact support with the swap deposit address.',
        false,
        true
      );
    case 'KNOWN_DEPOSIT_TX':
    case 'PROCESSING':
      return progress('swapping', 'The BTC arrived at the swap. Swapping now.', false);
    case 'PENDING_DEPOSIT':
      return null;
    default:
      throw new Error(`Unknown swap status: ${String(swap satisfies never)}`);
  }
}

function lateWarning(): WithdrawalProgress {
  return progress(
    'deadline-passed',
    'The quote deadline has passed and the swap provider has not reported receiving the BTC. If the BTC reaches it too late, it will most likely be refunded to your Bitcoin refund address.',
    false,
    true
  );
}

export function deriveWithdrawalProgress(o: WithdrawalObservations): WithdrawalProgress {
  const mismatch = mismatchOf(o);
  if (mismatch !== null) return progress('mismatch', `${mismatch}${MISMATCH_ADVICE}`, true, true);
  if (softMismatchPending(o)) {
    return progress(
      'rechecking',
      'The withdrawal data does not add up yet. This is often a short delay between Stacks API servers, so this page is checking again before drawing a conclusion.',
      false,
      true
    );
  }

  const fromSwap = o.swap === null ? null : swapProgress(o.swap);
  if (fromSwap) return fromSwap;

  const stacks = o.stacks;
  if (stacks === null) {
    if (o.deadlinePassed) return lateWarning();
    return progress(
      'awaiting-stacks-tx',
      'Could not read the Stacks network right now. Checking again shortly.',
      false
    );
  }
  switch (stacks.kind) {
    case 'unknown-tx':
    case 'tx-pending':
      if (o.deadlinePassed) return lateWarning();
      return progress(
        'awaiting-stacks-tx',
        stacks.kind === 'unknown-tx'
          ? 'Waiting for the withdrawal transaction to reach the Stacks network.'
          : 'Waiting for the withdrawal transaction to confirm on Stacks.',
        false
      );
    case 'tx-dropped':
      return progress(
        'tx-replaced',
        'The withdrawal transaction was replaced or dropped from the Stacks mempool before it confirmed. A replacement with a higher fee makes the same withdrawal, so this page keeps checking for it.',
        false,
        true
      );
    case 'tx-failed':
      return progress('request-failed', stacks.failure.message, true);
    case 'requested':
      if (o.deadlinePassed) return lateWarning();
      return progress(
        'awaiting-signers',
        `The withdrawal request is on chain. Waiting for the sBTC signers to send the BTC. If they reject it, your sBTC is returned automatically, usually within about ${o.rejectionBlocks} Bitcoin blocks.`,
        false
      );
    case 'rejected':
      return progress(
        'rejected',
        'The sBTC signers rejected this withdrawal. The full amount and fee cap were returned to your wallet as sBTC.',
        true
      );
    case 'accepted':
      if (o.payout?.ok && o.payout.confirmed) {
        if (o.deadlinePassed) return lateWarning();
        return progress(
          'payout-confirmed',
          'The sBTC signers sent the BTC to the swap and it is confirmed. Waiting for the swap provider to pick it up.',
          false
        );
      }
      return progress(
        'payout-broadcast',
        'The sBTC signers accepted the withdrawal. Confirming the BTC payout on the Bitcoin network.',
        false
      );
    case 'mismatch':
    case 'not-a-withdrawal':
      return progress(
        'mismatch',
        `The withdrawal data does not add up.${MISMATCH_ADVICE}`,
        true,
        true
      );
    default:
      throw new Error(`Unknown withdrawal status: ${String(stacks satisfies never)}`);
  }
}
