import { describe, expect, it } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as W,
  buildWithdrawalQuoteRequest,
  MAINNET_CONFIG as config,
} from '@satway/core';

import { BadRequest, sanitizeWithdrawalQuoteRequest } from '../src/http/index.js';
import { handle } from '../src/index.js';
import { NOW, bodyJson, jsonRes, postJson, testEnv } from './support.js';

const USDC_BASE = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const RECIPIENT = '0xb5660bca47faae88a0c286ca8eec920bbae1d7cf';
const REFUND = 'bc1qep7zv4fslevaxnx2swm3uamfxzkzxn2hau4nfw';

function goodRequest(now: Date = NOW, dry = true) {
  return buildWithdrawalQuoteRequest(W, {
    destinationAsset: USDC_BASE,
    recipient: RECIPIENT,
    refundTo: REFUND,
    amountSats: 10_000,
    dry,
    now,
  });
}

function refused(body: unknown, now: Date = NOW): string {
  try {
    sanitizeWithdrawalQuoteRequest(body, W, now);
  } catch (err) {
    if (err instanceof BadRequest) return err.message;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('sanitizeWithdrawalQuoteRequest', () => {
  it('passes a request built by core unchanged, dry or live', () => {
    expect(sanitizeWithdrawalQuoteRequest(goodRequest(), W, NOW)).toEqual(goodRequest());
    expect(sanitizeWithdrawalQuoteRequest(goodRequest(NOW, false), W, NOW)).toEqual(
      goodRequest(NOW, false)
    );
  });

  it('drops unknown fields and pins the referral', () => {
    const clean = sanitizeWithdrawalQuoteRequest(
      { ...goodRequest(), referral: 'someone-else', virtualChainRecipient: 'x', extra: 1 },
      W,
      NOW
    );
    expect(clean).toEqual(goodRequest());
    expect(clean.referral).toBe('satway');
  });

  it('refuses anything that does not swap native BTC into another asset', () => {
    expect(refused({ ...goodRequest(), originAsset: USDC_BASE })).toMatch(/from native BTC/);
    expect(refused({ ...goodRequest(), destinationAsset: W.btcAssetId })).toMatch(/other than BTC/);
    expect(refused({ ...goodRequest(), destinationAsset: '' })).toMatch(/destinationAsset/);
  });

  it('refuses other swap, deposit, refund and recipient types', () => {
    expect(refused({ ...goodRequest(), swapType: 'EXACT_OUTPUT' })).toMatch(/EXACT_INPUT/);
    expect(refused({ ...goodRequest(), depositType: 'INTENTS' })).toMatch(/origin chain/);
    expect(refused({ ...goodRequest(), refundType: 'INTENTS' })).toMatch(/origin chain/);
    expect(refused({ ...goodRequest(), recipientType: 'INTENTS' })).toMatch(/destination chain/);
  });

  it('requires a standard mainnet Bitcoin refund address', () => {
    expect(refused({ ...goodRequest(), refundTo: RECIPIENT })).toMatch(/mainnet Bitcoin address/);
    expect(
      refused({ ...goodRequest(), refundTo: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' })
    ).toMatch(/mainnet Bitcoin address/);
    expect(refused({ ...goodRequest(), refundTo: REFUND.toUpperCase() })).toMatch(/standard form/);
  });

  it('requires a recipient without spaces', () => {
    expect(refused({ ...goodRequest(), recipient: '' })).toMatch(/recipient/);
    expect(refused({ ...goodRequest(), recipient: `${RECIPIENT} ` })).toMatch(/spaces/);
    expect(refused({ ...goodRequest(), recipient: 'x'.repeat(201) })).toMatch(/recipient/);
  });

  it('requires a whole number of sats at or above the minimum', () => {
    expect(refused({ ...goodRequest(), amount: '9999' })).toMatch(/at least 10000/);
    expect(refused({ ...goodRequest(), amount: '10000.5' })).toMatch(/positive integer/);
    expect(refused({ ...goodRequest(), amount: '010000' })).toMatch(/positive integer/);
    expect(refused({ ...goodRequest(), amount: 10_000 })).toMatch(/non-empty string/);
    expect(refused({ ...goodRequest(), amount: '99999999999999999' })).toMatch(/at least/);
  });

  it('allows only the offered slippage options', () => {
    expect(
      sanitizeWithdrawalQuoteRequest({ ...goodRequest(), slippageTolerance: 300 }, W, NOW)
    ).toMatchObject({ slippageTolerance: 300 });
    expect(refused({ ...goodRequest(), slippageTolerance: 500 })).toMatch(/100, 300/);
    expect(refused({ ...goodRequest(), slippageTolerance: '100' })).toMatch(/slippageTolerance/);
  });

  it('accepts the 48-hour deadline and a client clock up to the margin ahead, nothing beyond', () => {
    const ahead = new Date(NOW.getTime() + 60 * 60_000);
    expect(sanitizeWithdrawalQuoteRequest(goodRequest(ahead), W, NOW).deadline).toBe(
      goodRequest(ahead).deadline
    );
    const tooFar = new Date(NOW.getTime() + 61 * 60_000);
    expect(refused(goodRequest(tooFar))).toMatch(/at most 2940 minutes/);
    expect(refused({ ...goodRequest(), deadline: NOW.toISOString() })).toMatch(/future/);
    expect(refused({ ...goodRequest(), deadline: 'soon' })).toMatch(/ISO date/);
  });

  it('requires exactly the configured fee', () => {
    expect(refused({ ...goodRequest(), appFees: [{ recipient: 'thief.near', fee: 50 }] })).toMatch(
      /appFees/
    );
    const withFee = { ...W, appFeeBps: 25, appFeeRecipient: 'satway.near' };
    const fee = [{ recipient: 'satway.near', fee: 25 }];
    expect(
      sanitizeWithdrawalQuoteRequest({ ...goodRequest(), appFees: fee }, withFee, NOW).appFees
    ).toEqual(fee);
    expect(() => sanitizeWithdrawalQuoteRequest(goodRequest(), withFee, NOW)).toThrow(/appFees/);
  });

  it.each([null, [], 'quote', 7])('refuses a body that is not an object: %j', body => {
    expect(refused(body)).toMatch(/JSON object/);
  });

  it('refuses dry that is not a boolean', () => {
    expect(refused({ ...goodRequest(), dry: 'false' })).toMatch(/"dry"/);
  });
});

describe('POST /withdrawal-quote', () => {
  it('forwards a clean withdrawal quote to 1Click with the API key, which never reaches the client', async () => {
    const request = goodRequest(new Date());
    let upstream: { url: string; init?: RequestInit } | undefined;
    function fetchFn(url: string, init?: RequestInit): Promise<Response> {
      upstream = { url, init };
      return Promise.resolve(jsonRes({ quote: { amountOut: '6515571' } }));
    }
    const res = await handle(
      postJson('/withdrawal-quote', { ...request, extra: 1 }),
      testEnv({ ONECLICK_JWT: 'secret' }),
      fetchFn
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example');
    expect(upstream?.url).toBe(`${config.oneClickBaseUrl}/v0/quote`);
    expect(new Headers(upstream?.init?.headers).get('authorization')).toBe('Bearer secret');
    expect(bodyJson(upstream?.init)).toEqual(request);
    expect(await res.text()).not.toContain('secret');
  });

  it('refuses a deposit-shaped quote and a tampered one without calling upstream', async () => {
    let calls = 0;
    function fetchFn(): Promise<Response> {
      calls += 1;
      return Promise.resolve(jsonRes({}));
    }
    const request = goodRequest(new Date());
    const deposit = { ...request, originAsset: USDC_BASE, destinationAsset: W.btcAssetId };
    expect((await handle(postJson('/withdrawal-quote', deposit), testEnv(), fetchFn)).status).toBe(
      400
    );
    const tampered = { ...request, appFees: [{ recipient: 'thief.near', fee: 50 }] };
    expect((await handle(postJson('/withdrawal-quote', tampered), testEnv(), fetchFn)).status).toBe(
      400
    );
    expect(calls).toBe(0);
  });

  it('keeps the deposit quote route refusing withdrawal quotes', async () => {
    let calls = 0;
    function fetchFn(): Promise<Response> {
      calls += 1;
      return Promise.resolve(jsonRes({}));
    }
    const res = await handle(postJson('/quote', goodRequest(new Date())), testEnv(), fetchFn);
    expect(res.status).toBe(400);
    expect(calls).toBe(0);
  });

  it('relays 1Click errors with their status', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(jsonRes({ message: 'Amount is too low for bridge' }, 400));
    }
    const res = await handle(
      postJson('/withdrawal-quote', goodRequest(new Date())),
      testEnv(),
      fetchFn
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: 'Amount is too low for bridge' });
  });

  it('answers 404 to a GET', async () => {
    const res = await handle(new Request('https://api.example/withdrawal-quote'), testEnv());
    expect(res.status).toBe(404);
  });
});
