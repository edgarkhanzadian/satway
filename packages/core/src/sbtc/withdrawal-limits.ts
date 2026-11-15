import type { WithdrawalLimits } from './emily-withdrawal.js';
import { SBTC_WITHDRAWAL_DUST_LIMIT_SATS } from './withdrawal-request.js';

export type WithdrawalAmountProblem =
  | 'not-an-integer'
  | 'below-dust'
  | 'below-minimum'
  | 'above-withdrawal-cap'
  | 'above-available-capacity';

export interface WithdrawalAmountCheck {
  ok: boolean;
  problems: WithdrawalAmountProblem[];
  minimumSats: number;
  maximumSats: number | null;
}

export function checkWithdrawalAmount(
  amountSats: number,
  limits: WithdrawalLimits,
  minimumSats: number
): WithdrawalAmountCheck {
  const floor = Math.max(minimumSats, SBTC_WITHDRAWAL_DUST_LIMIT_SATS + 1);
  const caps = [limits.perWithdrawalCap, limits.availableToWithdraw].filter(c => c !== null);
  const maximumSats = caps.length > 0 ? Math.min(...caps) : null;
  const base = { minimumSats: floor, maximumSats };

  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    return { ...base, ok: false, problems: ['not-an-integer'] };
  }
  const problems: WithdrawalAmountProblem[] = [];
  if (amountSats <= SBTC_WITHDRAWAL_DUST_LIMIT_SATS) problems.push('below-dust');
  if (amountSats < floor) problems.push('below-minimum');
  if (limits.perWithdrawalCap !== null && amountSats > limits.perWithdrawalCap) {
    problems.push('above-withdrawal-cap');
  }
  if (limits.availableToWithdraw !== null && amountSats > limits.availableToWithdraw) {
    problems.push('above-available-capacity');
  }
  return { ...base, ok: problems.length === 0, problems };
}

export function describeWithdrawalAmountProblem(
  problem: WithdrawalAmountProblem,
  check: WithdrawalAmountCheck
): string {
  switch (problem) {
    case 'not-an-integer':
      return 'Amount must be a whole number of sats.';
    case 'below-dust':
      return `The sBTC withdrawal contract only accepts amounts above ${SBTC_WITHDRAWAL_DUST_LIMIT_SATS} sats.`;
    case 'below-minimum':
      return `Amount is too small. Withdraw at least ${check.minimumSats} sats.`;
    case 'above-withdrawal-cap':
      return 'Amount is above the sBTC per-withdrawal cap. The signers would reject it. Withdraw a smaller amount.';
    case 'above-available-capacity':
      return check.maximumSats === null
        ? 'Amount is above what the sBTC signers can pay out right now.'
        : `Amount is above what the sBTC signers can pay out right now (${check.maximumSats} sats). Withdraw less or try later.`;
    default:
      throw new Error(`Unknown withdrawal amount problem: ${String(problem satisfies never)}`);
  }
}
