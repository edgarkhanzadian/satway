import { describe, expect, it } from 'vitest';

import { checkDepositAmount, describeAmountProblem } from '../src/index.js';
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
