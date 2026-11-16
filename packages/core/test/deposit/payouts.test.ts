import { describe, expect, it } from 'vitest';

import {
  type AddressOutput,
  type OneClickStatusResponse,
  blocksUntilReclaimFor,
  depositPayouts,
  destinationTxHashesOf,
  findReclaimOption,
  mintMinimumOf,
  normalizeTxHash,
  outputsToRegister,
  planReclaim,
  reclaimAmountProblem,
  reclaimFeeSats,
} from '../../src/index.js';

const REAL = 'aa'.repeat(32);
const DUST = 'dd'.repeat(32);
const OLD = 'cc'.repeat(32);
const ATTACKER = 'ee'.repeat(32);
const TIP = 976_000;

function out(txid: string, amountSats: number, over: Partial<AddressOutput> = {}): AddressOutput {
  return {
    txid,
    vout: 0,
    amountSats,
    confirmed: true,
    blockHeight: TIP - 2,
    blockTime: 1_800_000_000,
    spent: false,
    ...over,
  };
}
const unconfirmed = { confirmed: false, blockHeight: null, blockTime: null };

describe('depositPayouts', () => {
  it('every output at or above the sBTC minimum at the per-deposit address is a payout', () => {
    const real = out(REAL, 35_500);
    const dust = out(DUST, 546, unconfirmed);
    const p = depositPayouts([dust, real], 10_000);
    expect(p.payouts).toEqual([real]);
    expect(p.belowMinimum).toEqual([dust]);
    expect(p.mintMinimumSats).toBe(10_000);
  });

  it('keeps several payments, earliest first, whatever their amounts', () => {
    const late = out(ATTACKER, 90_000, unconfirmed);
    const early = out(REAL, 35_500, { blockHeight: TIP - 5 });
    const middle = out(OLD, 12_000, { blockHeight: TIP - 1, spent: true });
    const p = depositPayouts([late, middle, early], 10_000);
    expect(p.payouts).toEqual([early, middle, late]);
    expect(p.belowMinimum).toEqual([]);
  });

  it('dust alone is never a payout, and an unknown minimum falls back to the dust limit', () => {
    expect(depositPayouts([out(DUST, 546, unconfirmed)], 10_000).payouts).toEqual([]);
    expect(mintMinimumOf(null)).toBe(330);
    expect(depositPayouts([out(DUST, 546)], null).payouts).toHaveLength(1);
    expect(depositPayouts([out(DUST, 300)], null).belowMinimum).toHaveLength(1);
  });
});

describe('1Click status helpers', () => {
  function status(hashes: string[]): OneClickStatusResponse {
    return {
      status: 'SUCCESS',
      updatedAt: '',
      swapDetails: {
        originChainTxHashes: [],
        destinationChainTxHashes: hashes.map(hash => ({ hash, explorerUrl: '' })),
      },
    };
  }

  it('normalises case and an optional 0x prefix, and drops anything else', () => {
    expect(normalizeTxHash(`0x${REAL.toUpperCase()}`)).toBe(REAL);
    expect(normalizeTxHash('nope')).toBeNull();
    expect(destinationTxHashesOf(status([REAL, `0x${REAL}`, 'near-tx-id']))).toEqual([REAL]);
    expect(destinationTxHashesOf(null)).toEqual([]);
  });
});

describe('outputsToRegister', () => {
  const policy = {
    minimumSats: 10_000,
    tipHeight: TIP,
    reclaimLockBlocks: 950,
  };

  it('registers every unspent output at or above the minimum, biggest first, and nothing else', () => {
    const real = out(REAL, 35_500);
    const other = out(ATTACKER, 12_000, unconfirmed);
    const second = out(OLD, 50_000);
    const outputs = [
      out(DUST, 546, unconfirmed),
      real,
      other,
      second,
      out('bb'.repeat(32), 40_000, { spent: true }),
      out('ab'.repeat(32), 40_000, { blockHeight: TIP - 2_000 }),
    ];
    expect(outputsToRegister(outputs, policy)).toEqual([second, real, other]);
  });

  it('never registers dust, even with a lower minimum', () => {
    expect(outputsToRegister([out(DUST, 300)], { ...policy, minimumSats: 1 })).toEqual([]);
  });

  it('registers nothing when the minimum is unknown', () => {
    expect(outputsToRegister([out(REAL, 35_500)], { ...policy, minimumSats: null })).toEqual([]);
  });

  it('bounds the work per check', () => {
    const many = Array.from({ length: 9 }, (_, i) => out(i.toString(16).repeat(64), 20_000 + i));
    expect(outputsToRegister(many, policy)).toHaveLength(5);
  });
});

describe('blocksUntilReclaimFor', () => {
  it('counts from the output’s own confirmation height', () => {
    expect(blocksUntilReclaimFor({ confirmed: true, blockHeight: 1_000 }, 1_002, 950)).toBe(947);
    expect(blocksUntilReclaimFor({ confirmed: true, blockHeight: 1_000 }, 1_949, 950)).toBe(0);
    expect(blocksUntilReclaimFor({ confirmed: false, blockHeight: null }, 1_949, 950)).toBeNull();
    expect(blocksUntilReclaimFor({ confirmed: true, blockHeight: 1_000 }, null, 950)).toBeNull();
  });
});

describe('planReclaim', () => {
  const lock = 950;
  const expired = { blockHeight: TIP - 2_000 };

  it('targets the selected payout when dust is also present', () => {
    const real = out(REAL, 35_500, expired);
    const dust = out(DUST, 546, unconfirmed);
    const plan = planReclaim({
      outputs: [dust, real],
      selected: real,
      tipHeight: TIP,
      reclaimLockBlocks: lock,
    });
    expect(plan.target?.output).toBe(real);
    expect(plan.target?.ready).toBe(true);
    expect(plan.options.map(o => o.output)).toEqual([real, dust]);
  });

  it('never defaults to a 2,000-sat output when there is no selected payout', () => {
    const dust = out(DUST, 2_000, expired);
    const plan = planReclaim({
      outputs: [dust],
      selected: null,
      tipHeight: TIP,
      reclaimLockBlocks: lock,
    });
    expect(plan.target).toBeNull();
    expect(plan.nothingLeft).toBe(false);
    expect(plan.options).toHaveLength(1);
  });

  it('does not target a spent payout, and still offers what is left', () => {
    const real = out(REAL, 35_500, { ...expired, spent: true });
    const second = out(ATTACKER, 20_000, { blockHeight: TIP - 10 });
    const plan = planReclaim({
      outputs: [real, second],
      selected: real,
      tipHeight: TIP,
      reclaimLockBlocks: lock,
    });
    expect(plan.target).toBeNull();
    expect(plan.options.map(o => o.output)).toEqual([second]);
    expect(plan.options[0]?.blocksUntilReclaim).toBe(939);
    expect(plan.options[0]?.ready).toBe(false);
    expect(findReclaimOption(plan, `${ATTACKER.toUpperCase()}:0`)?.output).toBe(second);
    expect(findReclaimOption(plan, `${REAL}:0`)).toBeNull();
  });

  it('says nothing is left only when no output is unspent', () => {
    const plan = planReclaim({
      outputs: [out(REAL, 35_500, { spent: true })],
      selected: null,
      tipHeight: TIP,
      reclaimLockBlocks: lock,
    });
    expect(plan.nothingLeft).toBe(true);
  });

  it('refuses an output that cannot cover the fee', () => {
    expect(reclaimFeeSats(5, 126)).toBe(630);
    expect(reclaimFeeSats(5, 138)).toBe(690);
    expect(reclaimAmountProblem(546, 5, 126)).toMatch(/cannot cover the reclaim fee/);
    expect(reclaimAmountProblem(2_000, 5, 126)).toBeNull();
    expect(reclaimAmountProblem(2_000, 20, 126)).toMatch(/2000 sats/);
  });
});
