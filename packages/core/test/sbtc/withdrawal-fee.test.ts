import { describe, expect, it } from 'vitest';

import {
  FeeCapError,
  MAINNET_WITHDRAWAL_CONFIG as W,
  parseWith,
  withdrawalFeeCap,
  z,
} from '../../src/index.js';
import { defined } from '../fixtures.js';
import { REAL_WITHDRAWALS } from '../real-withdrawals.js';

const sweepSchema = z.looseObject({
  weight: z.number(),
  fee: z.number(),
  vin: z.array(z.unknown()),
  vout: z.array(z.unknown()),
});

describe('withdrawalFeeCap', () => {
  it('never goes below the floor', () => {
    expect(withdrawalFeeCap(W, 0.1)).toBe(3_000);
    expect(withdrawalFeeCap(W, 1)).toBe(3_000);
    expect(withdrawalFeeCap(W, 3.75)).toBe(3_000);
  });

  it('scales with the fee rate, solo sweep size and margin, rounding up', () => {
    expect(withdrawalFeeCap(W, 3.8)).toBe(3_040);
    expect(withdrawalFeeCap(W, 4)).toBe(3_200);
    expect(withdrawalFeeCap(W, 10)).toBe(8_000);
    expect(withdrawalFeeCap(W, 10.01)).toBe(Math.ceil(10.01 * 400 * 2));
    expect(withdrawalFeeCap(W, 100)).toBe(80_000);
  });

  it('refuses when the cap would exceed the upper bound', () => {
    expect(withdrawalFeeCap(W, 125)).toBe(100_000);
    expect(() => withdrawalFeeCap(W, 125.01)).toThrow(FeeCapError);
    expect(() => withdrawalFeeCap(W, 126)).toThrow(/too high right now/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a fee rate of %s', rate => {
    expect(() => withdrawalFeeCap(W, rate)).toThrow(/positive number/);
  });

  it('refuses an implausible fee rate', () => {
    expect(() => withdrawalFeeCap(W, 501)).toThrow(/implausibly high/);
  });

  it('covers the real solo withdrawal sweep (request 5131) at the fee rate it paid', () => {
    const w = defined(REAL_WITHDRAWALS.find(r => r.id === 5131));
    const sweep = parseWith(sweepSchema, w.btcTx, 'fixture');
    expect(sweep.vin).toHaveLength(1);
    const vsize = sweep.weight / 4;
    expect(vsize).toBe(377.75);
    expect(vsize).toBeLessThanOrEqual(W.soloSweepVsize);
    expect(sweep.fee).toBe(defined(w.feeSats));
    const rate = sweep.fee / vsize;
    expect(withdrawalFeeCap(W, rate)).toBeGreaterThanOrEqual(sweep.fee * 2);
  });

  it('would have covered the fee charged on every real accepted withdrawal at its sweep fee rate', () => {
    for (const w of REAL_WITHDRAWALS.filter(r => r.btcTx !== null)) {
      const sweep = parseWith(sweepSchema, w.btcTx, 'fixture');
      const rate = sweep.fee / (sweep.weight / 4);
      expect(withdrawalFeeCap(W, rate)).toBeGreaterThanOrEqual(defined(w.feeSats));
    }
  });
});
