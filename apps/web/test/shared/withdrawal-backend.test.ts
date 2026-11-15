import { describe, expect, it } from 'vitest';

import { MAINNET_WITHDRAWAL_FLOW_CONFIG as W, buildWithdrawalQuoteRequest } from '@satway/core';

import { createWithdrawalBackend } from '../../src/shared/withdrawal-backend.js';
import { BASE_USDC, EVM_RECIPIENT, QUOTE, REFUND } from './withdrawal-fixtures.js';

const REQUEST = buildWithdrawalQuoteRequest(W, {
  destinationAsset: BASE_USDC,
  recipient: EVM_RECIPIENT,
  refundTo: REFUND,
  amountSats: 10_000,
  dry: false,
});

function fake(response: Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  function fetchFn(input: string, init?: RequestInit): Promise<Response> {
    calls.push({ url: input, init });
    return Promise.resolve(response);
  }
  return { calls, fetchFn };
}

describe('createWithdrawalBackend', () => {
  it('posts the request to the Worker withdrawal-quote route and parses the answer', async () => {
    const f = fake(new Response(JSON.stringify(QUOTE), { status: 200 }));
    const quote = await createWithdrawalBackend('https://api.example/', f.fetchFn).quote(REQUEST);
    expect(quote.quote.depositAddress).toBe(QUOTE.quote.depositAddress);
    expect(f.calls[0]?.url).toBe('https://api.example/withdrawal-quote');
    expect(f.calls[0]?.init?.method).toBe('POST');
    expect(f.calls[0]?.init?.body).toBe(JSON.stringify(REQUEST));
  });

  it('passes on the Worker’s message for a refused request', async () => {
    const f = fake(new Response(JSON.stringify({ message: '"refundTo" is bad' }), { status: 400 }));
    await expect(
      createWithdrawalBackend('https://api.example', f.fetchFn).quote(REQUEST)
    ).rejects.toThrow('"refundTo" is bad');
    const blank = fake(new Response('<html>', { status: 502 }));
    await expect(
      createWithdrawalBackend('https://api.example', blank.fetchFn).quote(REQUEST)
    ).rejects.toThrow('Request failed (502)');
  });

  it('refuses an answer that is not a quote', async () => {
    const f = fake(new Response(JSON.stringify({ nope: true }), { status: 200 }));
    await expect(
      createWithdrawalBackend('https://api.example', f.fetchFn).quote(REQUEST)
    ).rejects.toThrow(/Unexpected data from the backend at \/withdrawal-quote/);
  });
});
