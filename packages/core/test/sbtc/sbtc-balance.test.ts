import { describe, expect, it } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as C,
  balanceShortfall,
  describeBalanceShortfall,
  fetchSbtcBalance,
} from '../../src/index.js';
import { fakeWithdrawalApis } from '../fake-withdrawal-apis.js';
import { jsonResponse } from '../fixtures.js';
import {
  REAL_SBTC_BALANCE,
  REAL_SBTC_BALANCE_ADDRESS,
  REAL_SBTC_BALANCE_URL,
} from '../real-withdrawal-quotes.js';

describe('fetchSbtcBalance', () => {
  it('reads the real Hiro answer for the sBTC token of an address', async () => {
    const api = fakeWithdrawalApis({
      overrides: { [REAL_SBTC_BALANCE_URL]: jsonResponse(REAL_SBTC_BALANCE) },
    });
    await expect(fetchSbtcBalance(C, REAL_SBTC_BALANCE_ADDRESS, api.fetchFn)).resolves.toBe(2_700);
    expect(api.urls).toEqual([REAL_SBTC_BALANCE_URL]);
  });

  it('refuses a non-mainnet or contract address before any request', async () => {
    const api = fakeWithdrawalApis({});
    await expect(
      fetchSbtcBalance(C, 'ST2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWJ7T3AKW', api.fetchFn)
    ).rejects.toThrow(/sender/);
    await expect(
      fetchSbtcBalance(C, `${REAL_SBTC_BALANCE_ADDRESS}.some-contract`, api.fetchFn)
    ).rejects.toThrow(/sender/);
    expect(api.urls).toHaveLength(0);
  });

  it.each([{ balance: 2700 }, { balance: '-1' }, { balance: '1.5' }, { balance: '01' }, {}])(
    'refuses a malformed answer %j',
    async body => {
      const api = fakeWithdrawalApis({
        overrides: { [REAL_SBTC_BALANCE_URL]: jsonResponse(body) },
      });
      await expect(fetchSbtcBalance(C, REAL_SBTC_BALANCE_ADDRESS, api.fetchFn)).rejects.toThrow(
        /Unexpected data/
      );
    }
  );

  it('refuses a balance too large to handle', async () => {
    const api = fakeWithdrawalApis({
      overrides: { [REAL_SBTC_BALANCE_URL]: jsonResponse({ balance: '9007199254740993' }) },
    });
    await expect(fetchSbtcBalance(C, REAL_SBTC_BALANCE_ADDRESS, api.fetchFn)).rejects.toThrow(
      /too large/
    );
  });

  it('passes on HTTP errors', async () => {
    const api = fakeWithdrawalApis({
      overrides: { [REAL_SBTC_BALANCE_URL]: jsonResponse({ error: 'rate limited' }, 429) },
    });
    await expect(fetchSbtcBalance(C, REAL_SBTC_BALANCE_ADDRESS, api.fetchFn)).rejects.toThrow(
      /HTTP 429/
    );
  });
});

describe('balanceShortfall', () => {
  it('is null when the balance covers the locked amount exactly or more', () => {
    expect(balanceShortfall(13_000, 13_000)).toBeNull();
    expect(balanceShortfall(13_001, 13_000)).toBeNull();
  });

  it('says how much is missing', () => {
    const shortfall = balanceShortfall(12_000, 13_000);
    expect(shortfall).toEqual({ balanceSats: 12_000, neededSats: 13_000, missingSats: 1_000 });
    expect(shortfall && describeBalanceShortfall(shortfall)).toBe(
      'Your sBTC balance is 12,000 sats, but this withdrawal locks 13,000 sats: the amount plus the signers’ fee cap. Withdraw 1,000 sats less.'
    );
  });
});
