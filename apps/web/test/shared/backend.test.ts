import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type OneClickQuoteRequest,
  RequestTimeoutError,
  ResponseShapeError,
  SLOW_REQUEST_TIMEOUT_MS,
  SwapNotListedError,
} from '@satway/core';

import { createBackend } from '../../src/shared/backend.js';

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
      (b: ReturnType<typeof createBackend>) => b.register('aa', 'bb', 'cc'),
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

  it('reads a real pending status, whose empty fields are null', async () => {
    answer({
      status: 'PENDING_DEPOSIT',
      updatedAt: '2026-11-14T16:56:57.169Z',
      correlationId: '113e0005-b8a2-4373-9542-76038e41b67a',
      swapDetails: {
        depositedAmount: null,
        depositedAmountUsd: null,
        depositedAmountFormatted: null,
        intentHashes: [],
        nearTxHashes: [],
        amountIn: null,
        amountInFormatted: null,
        amountInUsd: null,
        amountOut: null,
        amountOutFormatted: null,
        amountOutUsd: null,
        slippage: null,
        refundedAmount: '0',
        refundedAmountFormatted: '0',
        refundedAmountUsd: '0',
        refundReason: null,
        refundFee: '9972',
        withdrawFee: '1900',
        originChainTxHashes: [],
        destinationChainTxHashes: [],
      },
    });
    const status = await createBackend(BASE).status('2CXBDfuKKrEmmo5vXnYbCEbUbDyweZcbL12gXC4vHC4G');
    expect(status.status).toBe('PENDING_DEPOSIT');
    expect(status.swapDetails.amountOut).toBeUndefined();
    expect(status.swapDetails.refundReason).toBeUndefined();
  });

  it('gives up on a status read the backend never answers, so the page can say so', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', () => new Promise(() => undefined));
      const pending = createBackend(BASE).status('0xabc');
      const outcome = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
      await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
      await outcome;
      vi.stubGlobal('fetch', () => new Promise(() => undefined));
      const registration = createBackend(BASE).register('aa', 'bb', 'cc');
      await vi.advanceTimersByTimeAsync(SLOW_REQUEST_TIMEOUT_MS);
      expect(await registration).toMatchObject({ kind: 'unavailable', status: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a 200 answer that is not JSON instead of returning null', async () => {
    answer('<html>proxy page</html>');
    await expect(createBackend(BASE).tokens()).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it('still surfaces the server message on an error status', async () => {
    answer({ message: 'refundTo is not valid' }, 400);
    await expect(createBackend(BASE).tokens()).rejects.toThrow('refundTo is not valid');
  });

  it('marks a status the swap provider has not listed yet', async () => {
    answer({ message: 'Deposit address bc1qabc not found', statusCode: 404 }, 404);
    const attempt = createBackend(BASE).status('bc1qabc');
    await expect(attempt).rejects.toBeInstanceOf(SwapNotListedError);
    await expect(attempt).rejects.toThrow('Deposit address bc1qabc not found');
    answer({ message: 'Upstream error' }, 502);
    await expect(createBackend(BASE).status('bc1qabc')).rejects.not.toBeInstanceOf(
      SwapNotListedError
    );
  });
});

describe('createBackend register', () => {
  function sentBody() {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(typeof init.body === 'string' ? JSON.parse(init.body) : null);
      return Promise.resolve(
        new Response(JSON.stringify({ address: 'bc1pwatched' }), { status: 201 })
      );
    });
    return bodies;
  }

  it('always sends the swap deposit address', async () => {
    const bodies = sentBody();
    expect(await createBackend(BASE).register('aa', 'bb', '0xswap')).toEqual({
      kind: 'registered',
      address: 'bc1pwatched',
    });
    expect(bodies).toEqual([
      { depositScript: 'aa', reclaimScript: 'bb', swapDepositAddress: '0xswap' },
    ]);
  });

  it.each([
    [
      409,
      { message: 'This swap is already registered', address: 'bc1pw' },
      { kind: 'registered', address: 'bc1pw' },
    ],
    [
      400,
      { message: 'The swap does not pay this deposit address' },
      { kind: 'rejected', status: 400, message: 'The swap does not pay this deposit address' },
    ],
    [
      400,
      { message: 'not a known 1Click swap', code: 'unknown-swap' },
      { kind: 'rejected', status: 400, message: 'not a known 1Click swap', code: 'unknown-swap' },
    ],
    [
      400,
      { message: 'not a known 1Click swap', code: 'something-else' },
      { kind: 'rejected', status: 400, message: 'not a known 1Click swap' },
    ],
    [
      413,
      { message: 'Body too large' },
      { kind: 'rejected', status: 413, message: 'Body too large' },
    ],
    [
      429,
      { message: 'Too many requests. Try again later.' },
      { kind: 'unavailable', status: 429, message: 'Too many requests. Try again later.' },
    ],
    [
      503,
      { message: 'Background tracking is at capacity.' },
      { kind: 'unavailable', status: 503, message: 'Background tracking is at capacity.' },
    ],
    [500, 'oops', { kind: 'unavailable', status: 500, message: 'Request failed (500)' }],
  ])('returns a %i answer as a value instead of throwing', async (status, body, expected) => {
    answer(body, status);
    expect(await createBackend(BASE).register('aa', 'bb', 'cc')).toEqual(expected);
  });

  it('passes on the Worker’s Retry-After for a busy answer', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Too many requests. Try again later.' }), {
          status: 429,
          headers: { 'retry-after': '60' },
        })
      )
    );
    expect(await createBackend(BASE).register('aa', 'bb', 'cc')).toEqual({
      kind: 'unavailable',
      status: 429,
      message: 'Too many requests. Try again later.',
      retryAfterSeconds: 60,
    });
  });

  it('ignores a Retry-After that is not a number of seconds', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('{}', {
          status: 503,
          headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' },
        })
      )
    );
    expect(await createBackend(BASE).register('aa', 'bb', 'cc')).toEqual({
      kind: 'unavailable',
      status: 503,
      message: 'Request failed (503)',
    });
  });

  it('returns an unreachable backend as unavailable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await createBackend(BASE).register('aa', 'bb', 'cc')).toEqual({
      kind: 'unavailable',
      status: null,
      message: 'The backend could not be reached',
    });
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
