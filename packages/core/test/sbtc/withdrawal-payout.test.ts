import { describe, expect, it } from 'vitest';

import {
  type BtcTxStatus,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as C,
  type PayoutProblem,
  describePayoutProblem,
  fetchAndVerifyWithdrawalPayout,
  parseWith,
  verifyPayoutTransaction,
  z,
} from '../../src/index.js';
import { fakeWithdrawalApis, routesFor } from '../fake-withdrawal-apis.js';
import { REAL_DEPOSIT, REAL_DEPOSIT_TX_HEX, defined, jsonResponse } from '../fixtures.js';
import { REAL_TIP_HEIGHT, REAL_WITHDRAWALS } from '../real-withdrawals.js';

const statusSchema: z.ZodType<{ status: BtcTxStatus }> = z.looseObject({
  status: z.looseObject({
    confirmed: z.boolean(),
    block_height: z.number().optional(),
    block_time: z.number().optional(),
  }),
});

const ACCEPTED = REAL_WITHDRAWALS.filter(w => w.btcTx !== null && w.btcTxHex !== null);

function expectationOf(w: (typeof ACCEPTED)[number]) {
  return {
    txid: defined(w.payoutTxid),
    vout: defined(w.payoutVout),
    amountSats: w.amountSats,
    scriptPubKey: w.scriptPubKey,
  };
}

describe('verifyPayoutTransaction on real sweeps', () => {
  it('covers every recipient kind', () => {
    expect(new Set(ACCEPTED.map(w => w.kind))).toEqual(
      new Set(['p2pkh', 'p2sh', 'p2wpkh', 'p2wsh', 'p2tr'])
    );
  });

  it.each(ACCEPTED.map(w => [w.id, w.kind, w] as const))(
    'request %i (%s): the output pays exactly the amount to the recipient script',
    (_id, _kind, w) => {
      const { status } = parseWith(statusSchema, w.btcTx, 'fixture');
      const result = verifyPayoutTransaction(
        defined(w.btcTxHex),
        status,
        REAL_TIP_HEIGHT,
        expectationOf(w)
      );
      expect(result).toEqual({
        ok: true,
        txid: w.payoutTxid,
        vout: w.payoutVout,
        valueSats: w.amountSats,
        problems: [],
        confirmed: true,
        blockHeight: status.block_height,
        confirmations: REAL_TIP_HEIGHT - defined(status.block_height) + 1,
      });
    }
  );

  it.each(ACCEPTED.map(w => [w.id, w] as const))(
    'request %i: without an output index, the unique matching output is found',
    (_id, w) => {
      const result = verifyPayoutTransaction(defined(w.btcTxHex), null, null, {
        ...expectationOf(w),
        vout: null,
      });
      expect(result.ok).toBe(true);
      expect(result.vout).toBe(w.payoutVout);
      expect(result.confirmations).toBeNull();
    }
  );

  const w = defined(ACCEPTED[0]);
  const base = expectationOf(w);

  it.each<[string, Partial<typeof base>, PayoutProblem]>([
    ['one sat less', { amountSats: w.amountSats - 1 }, 'wrong-value'],
    ['one sat more', { amountSats: w.amountSats + 1 }, 'wrong-value'],
    ['another script', { scriptPubKey: `0014${'00'.repeat(20)}` }, 'wrong-script'],
    ['an index past the end', { vout: 99 }, 'no-such-output'],
    ['a negative index', { vout: -1 }, 'no-such-output'],
  ])('flags %s', (_name, patch, problem) => {
    const result = verifyPayoutTransaction(defined(w.btcTxHex), null, null, { ...base, ...patch });
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(problem);
  });

  it('flags another output of the same sweep', () => {
    const vout = defined(w.payoutVout) === 0 ? 1 : 0;
    const result = verifyPayoutTransaction(defined(w.btcTxHex), null, null, { ...base, vout });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining(['wrong-script']));
  });

  it('flags a scan that finds nothing', () => {
    const result = verifyPayoutTransaction(defined(w.btcTxHex), null, null, {
      ...base,
      vout: null,
      amountSats: w.amountSats + 1,
    });
    expect(result.problems).toEqual(['no-matching-output']);
  });

  it('flags data for another transaction and unparseable data', () => {
    expect(verifyPayoutTransaction(REAL_DEPOSIT_TX_HEX, null, null, base).problems).toEqual([
      'txid-mismatch',
    ]);
    expect(verifyPayoutTransaction('00', null, null, base).problems).toEqual(['tx-unparseable']);
    expect(verifyPayoutTransaction(`${defined(w.btcTxHex)}00`, null, null, base).problems).toEqual([
      'tx-unparseable',
    ]);
    expect(REAL_DEPOSIT.txid).not.toBe(base.txid);
  });

  it('describes every problem', () => {
    for (const p of [
      'tx-not-found',
      'tx-unparseable',
      'txid-mismatch',
      'no-such-output',
      'wrong-script',
      'wrong-value',
      'no-matching-output',
      'several-matching-outputs',
    ] as const) {
      expect(describePayoutProblem(p)).toMatch(/\w/);
    }
  });
});

describe('fetchAndVerifyWithdrawalPayout', () => {
  const w = defined(REAL_WITHDRAWALS.find(r => r.id === 5131));

  it('fetches the sweep and tip and verifies the payout', async () => {
    const api = fakeWithdrawalApis(routesFor(w));
    const { verification, tipError } = await fetchAndVerifyWithdrawalPayout(
      C,
      expectationOf(w),
      api.fetchFn
    );
    expect(verification.ok).toBe(true);
    expect(verification.confirmations).toBe(REAL_TIP_HEIGHT - 975459 + 1);
    expect(tipError).toBeNull();
    expect(api.urls).toEqual([
      `https://mempool.space/api/tx/${w.payoutTxid}`,
      `https://mempool.space/api/tx/${w.payoutTxid}/hex`,
      'https://mempool.space/api/blocks/tip/height',
    ]);
  });

  it('reports a missing transaction', async () => {
    const api = fakeWithdrawalApis({});
    const { verification } = await fetchAndVerifyWithdrawalPayout(C, expectationOf(w), api.fetchFn);
    expect(verification.problems).toEqual(['tx-not-found']);
  });

  it('still verifies when the tip height cannot be read', async () => {
    const api = fakeWithdrawalApis({ ...routesFor(w), tipHeight: jsonResponse({}, 503) });
    const { verification, tipError } = await fetchAndVerifyWithdrawalPayout(
      C,
      expectationOf(w),
      api.fetchFn
    );
    expect(verification.ok).toBe(true);
    expect(verification.confirmations).toBeNull();
    expect(tipError).toMatch(/HTTP 503/);
  });

  it('refuses a malformed txid', async () => {
    await expect(
      fetchAndVerifyWithdrawalPayout(C, { ...expectationOf(w), txid: 'xyz' })
    ).rejects.toThrow(/Not a Bitcoin txid/);
  });
});
