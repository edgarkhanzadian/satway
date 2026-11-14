import { P2TR_DUST_SATS } from './config.js';
import type { SbtcLimits } from './emily.js';

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

export function checkDepositAmount(
  amountSats: number,
  limits: SbtcLimits,
  maxSignerFeeSats: number
): AmountCheck {
  const problems: AmountProblem[] = [];
  const depositMinimum = limits.perDepositMinimum ?? 0;
  const minimumSats = Math.max(depositMinimum, P2TR_DUST_SATS);

  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    return { ok: false, problems: ['not-an-integer'], minimumSats, feeCapCoversWholeAmount: false };
  }
  if (amountSats < P2TR_DUST_SATS) problems.push('below-dust');
  if (amountSats < depositMinimum) problems.push('below-deposit-minimum');
  if (limits.perDepositCap !== null && amountSats > limits.perDepositCap) {
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
      return 'Amount is above the sBTC per-deposit cap.';
    default:
      throw new Error(`Unknown amount problem: ${String(problem satisfies never)}`);
  }
}
