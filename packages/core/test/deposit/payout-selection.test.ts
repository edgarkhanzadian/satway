import { describe, expect, it } from 'vitest';

import {
  type AddressOutput,
  type OneClickStatusResponse,
  PRIOR_CLOCK_MARGIN_SECONDS,
  type PayoutSelectionInput,
  blocksUntilReclaimFor,
  destinationTxHashesOf,
  findReclaimOption,
  isPriorOutput,
  normalizeTxHash,
  outputsToRegister,
  payoutLowerBound,
  planReclaim,
  priorOutputsOf,
  reclaimAmountProblem,
  reclaimFeeSats,
  reportedAmountOutOf,
  selectPayout,
} from '../../src/index.js';

const REAL = 'aa'.repeat(32);
const DUST = 'dd'.repeat(32);
const OLD = 'cc'.repeat(32);
const ATTACKER = 'ee'.repeat(32);
const CREATED = '2026-11-14T12:00:00.000Z';
const CREATED_S = Date.parse(CREATED) / 1000;
const TIP = 976_000;

function out(txid: string, amountSats: number, over: Partial<AddressOutput> = {}): AddressOutput {
  return {
    txid,
    vout: 0,
    amountSats,
    confirmed: true,
    blockHeight: TIP - 2,
    blockTime: CREATED_S + 3_600,
    spent: false,
    ...over,
  };
}
const unconfirmed = { confirmed: false, blockHeight: null, blockTime: null };

function input(over: Partial<PayoutSelectionInput>): PayoutSelectionInput {
  return {
    outputs: [],
    prior: priorOutputsOf({ createdAt: CREATED, priorOutpoints: [] }),
    minAmountOutSats: 35_260,
    reportedAmountOutSats: null,
    destinationTxHashes: [],
    perDepositMinimum: 10_000,
    swapStatus: null,
    ...over,
  };
}

describe('selectPayout', () => {
  it('a later unconfirmed 546-sat output does not hijack the real payout', () => {
    const real = out(REAL, 35_500);
    const dust = out(DUST, 546, unconfirmed);
    const s = selectPayout(input({ outputs: [dust, real] }));
    expect(s.payout).toBe(real);
    expect(s.basis).toBe('amount');
    expect(s.belowMinimum).toEqual([dust]);
    expect(s.others).toEqual([]);
  });

  it('dust alone is never the payout', () => {
    const s = selectPayout(input({ outputs: [out(DUST, 546, unconfirmed)] }));
    expect(s.payout).toBeNull();
    expect(s.ambiguous).toBe(false);
    expect(s.belowMinimum).toHaveLength(1);
  });

  it('the 1Click destination hash beats an attacker output in the amount range', () => {
    const attacker = out(ATTACKER, 36_000, unconfirmed);
    const real = out(REAL, 35_500);
    const s = selectPayout(
      input({ outputs: [attacker, real], destinationTxHashes: [`0x${REAL.toUpperCase()}`] })
    );
    expect(s.payout).toBe(real);
    expect(s.basis).toBe('hash');
    expect(s.ambiguous).toBe(false);
    expect(s.others).toEqual([attacker]);
  });

  it('without a hash, two candidates are ambiguous and neither is picked silently', () => {
    const a = out(ATTACKER, 36_000, unconfirmed);
    const b = out(REAL, 35_500);
    const s = selectPayout(input({ outputs: [a, b] }));
    expect(s.payout).toBeNull();
    expect(s.basis).toBeNull();
    expect(s.ambiguous).toBe(true);
    expect(s.candidates).toEqual([a, b]);
  });

  it('the amount 1Click reports settles a tie when exactly one output matches it', () => {
    const a = out(ATTACKER, 36_000, unconfirmed);
    const b = out(REAL, 35_617);
    const s = selectPayout(input({ outputs: [a, b], reportedAmountOutSats: 35_617 }));
    expect(s.payout).toBe(b);
    expect(s.basis).toBe('amount');
  });

  it('has no upper bound, so a price improvement is still found', () => {
    const big = out(REAL, 90_000);
    expect(selectPayout(input({ outputs: [big] })).payout).toBe(big);
  });

  it('allows a small shortfall below the quoted minimum, but not dust or the sBTC minimum', () => {
    expect(payoutLowerBound(35_260, 10_000)).toBe(34_554);
    expect(payoutLowerBound(9_000, 10_000)).toBe(10_000);
    expect(payoutLowerBound(null, null)).toBe(330);
    const short = out(REAL, 34_600);
    expect(selectPayout(input({ outputs: [short] })).payout).toBe(short);
    expect(selectPayout(input({ outputs: [out(REAL, 30_000)] })).payout).toBeNull();
  });

  it('never considers an output that was on the address when the deposit was created', () => {
    const old = out(OLD, 50_000, { blockHeight: TIP - 5_000, blockTime: CREATED_S - 86_400 });
    const s = selectPayout(
      input({
        outputs: [old],
        prior: priorOutputsOf({ createdAt: CREATED, priorOutpoints: [`${OLD}:0`] }),
      })
    );
    expect(s.payout).toBeNull();
    expect(s.prior).toEqual([old]);
    expect(s.ambiguous).toBe(false);
  });

  it('an output in the snapshot is prior even if 1Click is silent, and a hash match still wins', () => {
    const real = out(REAL, 35_500);
    const prior = priorOutputsOf({ createdAt: CREATED, priorOutpoints: [`${REAL}:0`] });
    expect(selectPayout(input({ outputs: [real], prior })).payout).toBeNull();
    expect(
      selectPayout(input({ outputs: [real], prior, destinationTxHashes: [REAL] })).payout
    ).toBe(real);
  });

  it.each([
    'PENDING_DEPOSIT',
    'INCOMPLETE_DEPOSIT',
    'KNOWN_DEPOSIT_TX',
    'PROCESSING',
    'REFUNDED',
    'FAILED',
  ] as const)(
    'does not adopt an output by amount while the swap is %s, because 1Click has not paid out',
    swapStatus => {
      const other = out(REAL, 35_500);
      const s = selectPayout(input({ outputs: [other], swapStatus }));
      expect(s.payout).toBeNull();
      expect(s.basis).toBeNull();
      expect(s.ambiguous).toBe(false);
      expect(s.candidates).toEqual([]);
      expect(s.others).toEqual([other]);
    }
  );

  it('does not call two outputs ambiguous candidates while the swap is still waiting for funds', () => {
    const a = out(ATTACKER, 36_000);
    const b = out(REAL, 35_500);
    const s = selectPayout(input({ outputs: [a, b], swapStatus: 'PENDING_DEPOSIT' }));
    expect(s.ambiguous).toBe(false);
    expect(s.candidates).toEqual([]);
    expect(s.others).toEqual([a, b]);
  });

  it.each(['SUCCESS', null] as const)('still matches by amount once the swap is %s', swapStatus => {
    const real = out(REAL, 35_500);
    const s = selectPayout(input({ outputs: [real], swapStatus }));
    expect(s.payout).toBe(real);
    expect(s.basis).toBe('amount');
  });

  it('a hash match is used whatever the swap status says', () => {
    const real = out(REAL, 35_500);
    const s = selectPayout(
      input({ outputs: [real], destinationTxHashes: [REAL], swapStatus: 'PENDING_DEPOSIT' })
    );
    expect(s.payout).toBe(real);
    expect(s.basis).toBe('hash');
  });

  it('picks the biggest output of the hash transaction when it pays the address twice', () => {
    const small = out(REAL, 600, { vout: 0 });
    const big = out(REAL, 35_500, { vout: 1 });
    const s = selectPayout(input({ outputs: [small, big], destinationTxHashes: [REAL] }));
    expect(s.payout).toBe(big);
    expect(s.belowMinimum).toEqual([small]);
  });
});

describe('prior outputs for receipts without a snapshot', () => {
  const prior = priorOutputsOf({ createdAt: CREATED });

  it('treats outputs confirmed well before the receipt as prior', () => {
    const old = out(OLD, 50_000, { blockTime: CREATED_S - PRIOR_CLOCK_MARGIN_SECONDS - 1 });
    expect(isPriorOutput(old, prior)).toBe(true);
  });

  it('keeps a clock margin, so a payout with a lagging block time is not hidden', () => {
    const near = out(REAL, 35_500, { blockTime: CREATED_S - PRIOR_CLOCK_MARGIN_SECONDS + 60 });
    expect(isPriorOutput(near, prior)).toBe(false);
  });

  it('never treats an unconfirmed output as prior by time', () => {
    expect(isPriorOutput(out(REAL, 35_500, unconfirmed), prior)).toBe(false);
  });

  it('uses the earlier of the receipt time and the quote time', () => {
    const p = priorOutputsOf({ createdAt: CREATED, quoteTimestamp: '2026-11-13T12:00:00.000Z' });
    const o = out(OLD, 1, { blockTime: CREATED_S - PRIOR_CLOCK_MARGIN_SECONDS - 10 });
    expect(isPriorOutput(o, p)).toBe(false);
  });

  it('also applies the time rule when the snapshot was truncated', () => {
    const p = priorOutputsOf({ createdAt: CREATED, priorOutpoints: [], priorTruncated: true });
    const old = out(OLD, 50_000, { blockTime: CREATED_S - 86_400 });
    expect(isPriorOutput(old, p)).toBe(true);
    const complete = priorOutputsOf({ createdAt: CREATED, priorOutpoints: [] });
    expect(isPriorOutput(old, complete)).toBe(false);
  });

  it('a second deposit with an old receipt does not see the first payout', () => {
    const old = out(OLD, 50_000, { blockHeight: TIP - 5_000, blockTime: CREATED_S - 86_400 });
    const s = selectPayout(input({ outputs: [old], prior }));
    expect(s.payout).toBeNull();
  });
});

describe('1Click status helpers', () => {
  function status(hashes: string[], amountOut?: string): OneClickStatusResponse {
    return {
      status: 'SUCCESS',
      updatedAt: '',
      swapDetails: {
        amountOut,
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

  it('reads the reported amount only when it is a whole number', () => {
    expect(reportedAmountOutOf(status([], '35617'))).toBe(35_617);
    expect(reportedAmountOutOf(status([], '0.1'))).toBeNull();
    expect(reportedAmountOutOf(null)).toBeNull();
  });
});

describe('outputsToRegister', () => {
  const policy = {
    isPrior: (o: AddressOutput) => o.txid === OLD,
    minimumSats: 10_000,
    tipHeight: TIP,
    reclaimLockBlocks: 950,
  };

  it('registers every unspent, non-prior output at or above the minimum, and nothing else', () => {
    const real = out(REAL, 35_500);
    const other = out(ATTACKER, 12_000, unconfirmed);
    const outputs = [
      out(DUST, 546, unconfirmed),
      real,
      other,
      out(OLD, 50_000),
      out('bb'.repeat(32), 40_000, { spent: true }),
      out('ab'.repeat(32), 40_000, { blockHeight: TIP - 2_000 }),
    ];
    expect(outputsToRegister(outputs, policy)).toEqual([real, other]);
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
    expect(reclaimFeeSats(5)).toBe(630);
    expect(reclaimAmountProblem(546, 5)).toMatch(/cannot cover the reclaim fee/);
    expect(reclaimAmountProblem(2_000, 5)).toBeNull();
    expect(reclaimAmountProblem(2_000, 20)).toMatch(/2000 sats/);
  });
});
