import type { SbtcLimits } from '../sbtc/index.js';
import { P2TR_DUST_SATS } from '../shared/index.js';

export const PAYOUT_AMOUNT_TOLERANCE_BPS = 200;

export type AmountProblem =
  | 'not-an-integer'
  | 'below-dust'
  | 'below-deposit-minimum'
  | 'above-deposit-cap';

export interface AmountCheck {
  ok: boolean;
  problems: AmountProblem[];
  minimumSats: number;
  feeCapCoversWholeAmount: boolean;
}

export function largestPayoutSats(quote: { amountOut: string; minAmountOut: string }): number {
  const largest = Math.max(Number(quote.amountOut), Number(quote.minAmountOut));
  return Math.ceil((largest * (10_000 + PAYOUT_AMOUNT_TOLERANCE_BPS)) / 10_000);
}

export function checkDepositAmount(
  amountSats: number,
  limits: SbtcLimits,
  maxSignerFeeSats: number,
  largestSats: number = amountSats
): AmountCheck {
  const problems: AmountProblem[] = [];
  const depositMinimum = limits.perDepositMinimum ?? 0;
  const minimumSats = Math.max(depositMinimum, P2TR_DUST_SATS);

  if (
    !Number.isSafeInteger(amountSats) ||
    amountSats <= 0 ||
    !Number.isSafeInteger(largestSats) ||
    largestSats < amountSats
  ) {
    return { ok: false, problems: ['not-an-integer'], minimumSats, feeCapCoversWholeAmount: false };
  }
  if (amountSats < P2TR_DUST_SATS) problems.push('below-dust');
  if (amountSats < depositMinimum) problems.push('below-deposit-minimum');
  if (limits.perDepositCap !== null && largestSats > limits.perDepositCap) {
    problems.push('above-deposit-cap');
  }

  return {
    ok: problems.length === 0,
    problems,
    minimumSats,
    feeCapCoversWholeAmount: amountSats <= maxSignerFeeSats,
  };
}

export function describeAmountProblem(problem: AmountProblem, check: AmountCheck): string {
  switch (problem) {
    case 'not-an-integer':
      return 'Amount must be a whole number of sats.';
    case 'below-dust':
      return 'Amount is below the Bitcoin dust limit.';
    case 'below-deposit-minimum':
      return `Amount is too small. The swap must deliver at least ${check.minimumSats} sats.`;
    case 'above-deposit-cap':
      return 'The swap could deliver more than the sBTC per-deposit cap, and a deposit above the cap is not minted. Send a smaller amount.';
    default:
      throw new Error(`Unknown amount problem: ${String(problem satisfies never)}`);
  }
}
