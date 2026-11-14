import { afterEach, describe, expect, it, vi } from 'vitest';

import { type OneClickQuoteRequest, ResponseShapeError } from '@stxonector/core';

import { createBackend } from '../src/backend.js';

const BASE = 'https://api.example';

function answer(body: unknown, status = 200) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    urls.push(url);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return Promise.resolve(new Response(text, { status }));
  });
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createBackend', () => {
  it('passes well-formed tokens through with extra fields kept', async () => {
    const tokens = [
      { assetId: 'a', decimals: 6, blockchain: 'base', symbol: 'USDC', price: 1, coingeckoId: 'c' },
    ];
    answer(tokens);
    expect(await createBackend(BASE).tokens()).toEqual(tokens);
  });

  it.each([
    ['tokens', (b: ReturnType<typeof createBackend>) => b.tokens(), { tokens: [] }],
    ['a quote', (b: ReturnType<typeof createBackend>) => b.quote(quoteRequest()), { quote: {} }],
    [
      'a status',
      (b: ReturnType<typeof createBackend>) => b.status('0xabc', 'memo'),
      { status: 'DONE' },
    ],
    [
      'a registration',
      (b: ReturnType<typeof createBackend>) => b.register('aa', 'bb'),
      { address: 7 },
    ],
  ])('rejects malformed %s', async (_name, run, body) => {
    answer(body);
    const attempt = run(createBackend(BASE));
    await expect(attempt).rejects.toBeInstanceOf(ResponseShapeError);
    await expect(attempt).rejects.toThrow(
      /^Unexpected data from the backend at https:\/\/api\.example\//
    );
  });

  it('names the endpoint without the query string', async () => {
    answer({ status: 'DONE' });
    await expect(createBackend(BASE).status('0xabc', 'memo')).rejects.toThrow(
      /^Unexpected data from the backend at https:\/\/api\.example\/status: status: /
    );
  });

  it('rejects a 200 answer that is not JSON instead of returning null', async () => {
    answer('<html>proxy page</html>');
    await expect(createBackend(BASE).tokens()).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it('still surfaces the server message on an error status', async () => {
    answer({ message: 'refundTo is not valid' }, 400);
    await expect(createBackend(BASE).tokens()).rejects.toThrow('refundTo is not valid');
  });
});

function quoteRequest(): OneClickQuoteRequest {
  return {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: 'nep141:btc.omft.near',
    amount: '25000000',
    refundTo: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
    refundType: 'ORIGIN_CHAIN',
    recipient: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
    recipientType: 'DESTINATION_CHAIN',
    deadline: '2026-11-14T14:00:00.000Z',
  };
}
