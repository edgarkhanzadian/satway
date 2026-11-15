import { describe, expect, it } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as C,
  HttpError,
  ResponseShapeError,
  type WithdrawalLimits,
  checkWithdrawalAmount,
  describeWithdrawalAmountProblem,
  fetchEmilyWithdrawal,
  fetchWithdrawalLimits,
} from '../../src/index.js';
import { defined, jsonResponse } from '../fixtures.js';
import { REAL_LIMITS } from '../real-withdrawal-quotes.js';
import { REAL_WITHDRAWALS } from '../real-withdrawals.js';

const LIMITS: WithdrawalLimits = {
  perWithdrawalCap: 5_100_000_000,
  rollingWithdrawalBlocks: 150,
  rollingWithdrawalCap: 15_100_000_000,
  availableToWithdraw: 14_793_645_086,
};

function served(body: unknown, status = 200) {
  const urls: string[] = [];
  return {
    urls,
    fetchFn(url: string) {
      urls.push(url);
      return Promise.resolve(jsonResponse(body, status));
    },
  };
}

describe('fetchWithdrawalLimits', () => {
  it('reads the withdrawal fields of the real Emily limits response', async () => {
    const api = served(REAL_LIMITS);
    expect(await fetchWithdrawalLimits(C.sbtcApiUrl, api.fetchFn)).toMatchObject(LIMITS);
    expect(api.urls).toEqual(['https://sbtc-emily.com/limits']);
  });

  it('accepts null caps', async () => {
    const api = served({
      perWithdrawalCap: null,
      rollingWithdrawalBlocks: null,
      rollingWithdrawalCap: null,
      availableToWithdraw: null,
    });
    expect(await fetchWithdrawalLimits(C.sbtcApiUrl, api.fetchFn)).toEqual({
      perWithdrawalCap: null,
      rollingWithdrawalBlocks: null,
      rollingWithdrawalCap: null,
      availableToWithdraw: null,
    });
  });

  it.each([
    [{ ...LIMITS, perWithdrawalCap: '5100000000' }],
    [{ ...LIMITS, availableToWithdraw: -1 }],
    [{ ...LIMITS, availableToWithdraw: 1.5 }],
    [{ perWithdrawalCap: 1 }],
  ])('refuses malformed limits %j', async body => {
    await expect(fetchWithdrawalLimits(C.sbtcApiUrl, served(body).fetchFn)).rejects.toThrow(
      ResponseShapeError
    );
  });

  it('passes HTTP errors through', async () => {
    await expect(fetchWithdrawalLimits(C.sbtcApiUrl, served({}, 503).fetchFn)).rejects.toThrow(
      HttpError
    );
  });
});

describe('checkWithdrawalAmount', () => {
  it('accepts an amount inside every limit', () => {
    expect(checkWithdrawalAmount(10_000, LIMITS, 10_000)).toEqual({
      ok: true,
      problems: [],
      minimumSats: 10_000,
      maximumSats: 5_100_000_000,
    });
  });

  it('reports our minimum', () => {
    const check = checkWithdrawalAmount(9_999, LIMITS, 10_000);
    expect(check.problems).toEqual(['below-minimum']);
    expect(describeWithdrawalAmountProblem('below-minimum', check)).toMatch(/at least 10000/);
  });

  it('reports the contract dust limit even with a low minimum', () => {
    const check = checkWithdrawalAmount(546, LIMITS, 0);
    expect(check.problems).toEqual(['below-dust', 'below-minimum']);
    expect(check.minimumSats).toBe(547);
  });

  it('reports the per-withdrawal cap', () => {
    const check = checkWithdrawalAmount(5_100_000_001, LIMITS, 10_000);
    expect(check.problems).toEqual(['above-withdrawal-cap']);
  });

  it('reports the rolling capacity', () => {
    const limits = { ...LIMITS, availableToWithdraw: 50_000 };
    const check = checkWithdrawalAmount(50_001, limits, 10_000);
    expect(check.problems).toEqual(['above-available-capacity']);
    expect(check.maximumSats).toBe(50_000);
    expect(describeWithdrawalAmountProblem('above-available-capacity', check)).toMatch(
      /50000 sats/
    );
    expect(checkWithdrawalAmount(50_000, limits, 10_000).ok).toBe(true);
  });

  it('treats null caps as no published cap', () => {
    const open = {
      perWithdrawalCap: null,
      rollingWithdrawalBlocks: null,
      rollingWithdrawalCap: null,
      availableToWithdraw: null,
    };
    const check = checkWithdrawalAmount(1_000_000_000_000, open, 10_000);
    expect(check).toMatchObject({ ok: true, maximumSats: null });
    expect(describeWithdrawalAmountProblem('above-available-capacity', check)).toMatch(/right now/);
  });

  it.each([0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])('refuses %s', amount => {
    expect(checkWithdrawalAmount(amount, LIMITS, 10_000).problems).toEqual(['not-an-integer']);
  });

  it('describes every problem', () => {
    const check = checkWithdrawalAmount(10_000, LIMITS, 10_000);
    for (const p of [
      'not-an-integer',
      'below-dust',
      'below-minimum',
      'above-withdrawal-cap',
      'above-available-capacity',
    ] as const) {
      expect(describeWithdrawalAmountProblem(p, check)).toMatch(/\w/);
    }
  });
});

describe('fetchEmilyWithdrawal', () => {
  it('reads a real accepted withdrawal with its fulfillment', async () => {
    const w = defined(REAL_WITHDRAWALS.find(r => r.id === 5131));
    const api = served(w.emily);
    const found = await fetchEmilyWithdrawal(C.sbtcApiUrl, 5131, api.fetchFn);
    expect(found?.fulfillment).toMatchObject({
      BitcoinTxid: w.payoutTxid,
      BitcoinTxIndex: w.payoutVout,
      BtcFee: w.feeSats,
    });
    expect(api.urls).toEqual(['https://sbtc-emily.com/withdrawal/5131']);
  });

  it('reads a real rejected withdrawal without fulfillment', async () => {
    const w = defined(REAL_WITHDRAWALS.find(r => r.outcome === 'rejected'));
    const found = await fetchEmilyWithdrawal(C.sbtcApiUrl, w.id, served(w.emily).fetchFn);
    expect(found?.status).toBe('failed');
    expect(found?.fulfillment ?? null).toBeNull();
  });

  it('returns null for an unknown id and refuses bad ids', async () => {
    expect(await fetchEmilyWithdrawal(C.sbtcApiUrl, 1, served({}, 404).fetchFn)).toBeNull();
    await expect(fetchEmilyWithdrawal(C.sbtcApiUrl, -1, served({}).fetchFn)).rejects.toThrow(
      /non-negative integer/
    );
  });
});
