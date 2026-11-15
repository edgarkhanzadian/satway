import { describe, expect, it } from 'vitest';

import {
  PAYOUT_AMOUNT_TOLERANCE_BPS,
  checkDepositAmount,
  describeAmountProblem,
  largestPayoutSats,
} from '../src/index.js';
import { LIMITS } from './fixtures.js';

describe('checkDepositAmount', () => {
  it('accepts the deposit minimum exactly', () => {
    const check = checkDepositAmount(10_000, LIMITS, 80_000);
    expect(check.ok).toBe(true);
    expect(check.minimumSats).toBe(10_000);
  });

  it('rejects one sat below the minimum', () => {
    const check = checkDepositAmount(9_999, LIMITS, 80_000);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual(['below-deposit-minimum']);
    expect(describeAmountProblem('below-deposit-minimum', check)).toContain('10000');
  });

  it('rejects amounts above the cap', () => {
    const check = checkDepositAmount(
      2_000,
      { ...LIMITS, perDepositMinimum: 0, perDepositCap: 1_000 },
      80_000
    );
    expect(check.problems).toEqual(['above-deposit-cap']);
  });

  it('checks the cap against the largest payout and the minimum against the smallest', () => {
    const limits = { ...LIMITS, perDepositMinimum: 10_000, perDepositCap: 50_000 };
    expect(checkDepositAmount(40_000, limits, 80_000, 50_000).ok).toBe(true);
    expect(checkDepositAmount(40_000, limits, 80_000, 50_001).problems).toEqual([
      'above-deposit-cap',
    ]);
    expect(checkDepositAmount(9_000, limits, 80_000, 60_000).problems).toEqual([
      'below-deposit-minimum',
      'above-deposit-cap',
    ]);
    expect(describeAmountProblem('above-deposit-cap', checkDepositAmount(1, limits, 1))).toMatch(
      /cap/
    );
  });

  it.each([Number.NaN, 39_999, 1.5])('rejects an invalid largest payout %s', largest => {
    expect(checkDepositAmount(40_000, LIMITS, 80_000, largest).problems).toEqual([
      'not-an-integer',
    ]);
  });

  it('allows a margin above the quoted output for the payout to come in higher', () => {
    expect(largestPayoutSats({ amountOut: '35617', minAmountOut: '35260' })).toBe(
      Math.ceil((35_617 * (10_000 + PAYOUT_AMOUNT_TOLERANCE_BPS)) / 10_000)
    );
    expect(largestPayoutSats({ amountOut: '100', minAmountOut: '200' })).toBe(204);
    expect(largestPayoutSats({ amountOut: '10000', minAmountOut: '9900' })).toBe(10_200);
    expect(largestPayoutSats({ amountOut: 'x', minAmountOut: '9900' })).toBeNaN();
  });

  it('rejects dust even when the API reports no minimum', () => {
    const check = checkDepositAmount(
      329,
      { pegCap: null, perDepositMinimum: null, perDepositCap: null },
      80_000
    );
    expect(check.problems).toEqual(['below-dust']);
    expect(check.minimumSats).toBe(330);
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', amount => {
    expect(checkDepositAmount(amount, LIMITS, 80_000).problems).toEqual(['not-an-integer']);
  });

  it('warns, without failing, when the fee cap covers the whole amount', () => {
    expect(checkDepositAmount(80_000, LIMITS, 80_000)).toMatchObject({
      ok: true,
      feeCapCoversWholeAmount: true,
    });
    expect(checkDepositAmount(80_001, LIMITS, 80_000)).toMatchObject({
      ok: true,
      feeCapCoversWholeAmount: false,
    });
  });
});
