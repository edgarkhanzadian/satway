import { describe, expect, it } from 'vitest';

import {
  FeeRateTooHighError,
  FeeRateUnavailableError,
  MAINNET_WITHDRAWAL_CONFIG,
  MAX_FEE_RATE_SATS_PER_VBYTE,
  broadcastTransaction,
  fetchReclaimFeeRate,
} from '../../src/index.js';

const BTC_API = 'https://mempool.example/api';

function answer(body: string, status = 200) {
  const seen: { url: string; init?: RequestInit }[] = [];
  function fetchFn(url: string, init?: RequestInit): Promise<Response> {
    seen.push({ url, init });
    return Promise.resolve(new Response(body, { status }));
  }
  return { seen, fetchFn };
}

describe('fetchReclaimFeeRate', () => {
  it('reads the half-hour fee rate, at least 1 sat/vB', async () => {
    const ok = answer(JSON.stringify({ fastestFee: 9, halfHourFee: 4, hourFee: 3 }));
    expect(await fetchReclaimFeeRate(BTC_API, ok.fetchFn)).toBe(4);
    expect(ok.seen[0]?.url).toBe(`${BTC_API}/v1/fees/recommended`);
    const zero = answer(JSON.stringify({ halfHourFee: 0 }));
    expect(await fetchReclaimFeeRate(BTC_API, zero.fetchFn)).toBe(1);
  });

  it.each([
    ['an error status, even with a fee-shaped body', answer('{"halfHourFee":4}', 503)],
    ['a body that is not JSON', answer('<html>down</html>')],
    ['a body without the rate', answer('{"fastestFee":9}')],
  ])('refuses to guess on %s, with copy saying nothing was signed', async (_name, net) => {
    const pending = fetchReclaimFeeRate(BTC_API, net.fetchFn);
    await expect(pending).rejects.toBeInstanceOf(FeeRateUnavailableError);
    await expect(pending).rejects.toThrow(/nothing was signed or sent\. Try again in a moment\.$/);
  });

  it('accepts the cap itself and refuses anything above it, saying nothing was signed', async () => {
    expect(MAX_FEE_RATE_SATS_PER_VBYTE).toBe(500);
    expect(MAINNET_WITHDRAWAL_CONFIG.maxFeeRateSatsPerVbyte).toBe(MAX_FEE_RATE_SATS_PER_VBYTE);
    const atCap = answer(JSON.stringify({ halfHourFee: 500 }));
    expect(await fetchReclaimFeeRate(BTC_API, atCap.fetchFn)).toBe(500);
    const pending = fetchReclaimFeeRate(
      BTC_API,
      answer(JSON.stringify({ halfHourFee: 501 })).fetchFn
    );
    await expect(pending).rejects.toBeInstanceOf(FeeRateTooHighError);
    await expect(pending).rejects.toThrow(
      'The current Bitcoin fee rate is 501 sat/vB, above the 500 sat/vB this page pays for a reclaim, so no reclaim was built and nothing was signed or sent. Your BTC stays reclaimable: try again when fees are lower.'
    );
  });

  it('says why when the network fails', async () => {
    function offline(): Promise<Response> {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    await expect(fetchReclaimFeeRate(BTC_API, offline)).rejects.toThrow(
      /^Could not read the current Bitcoin fee rate \(Failed to fetch\)/
    );
  });
});

describe('broadcastTransaction', () => {
  it('posts the raw transaction and returns the txid', async () => {
    const net = answer(`${'ab'.repeat(32)}\n`);
    expect(await broadcastTransaction(BTC_API, '0200', net.fetchFn)).toBe('ab'.repeat(32));
    expect(net.seen[0]).toMatchObject({
      url: `${BTC_API}/tx`,
      init: { method: 'POST', body: '0200' },
    });
  });

  it('reports a rejection with the node message', async () => {
    const net = answer(
      'sendrawtransaction RPC error: {"code":-26,"message":"non-BIP68-final"}',
      400
    );
    await expect(broadcastTransaction(BTC_API, '0200', net.fetchFn)).rejects.toThrow(
      'The Bitcoin network rejected the transaction: sendrawtransaction RPC error: {"code":-26,"message":"non-BIP68-final"}'
    );
  });
});
