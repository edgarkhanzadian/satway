import { describe, expect, it } from 'vitest';

import {
  MAINNET_CONFIG,
  OneClickClient,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  assertQuoteMatchesRequest,
  buildQuoteRequest,
  providerFeesOf,
} from '../src/index.js';
import { REAL_DEPOSIT as D, jsonBody, jsonResponse } from './fixtures.js';

const USDC_BASE = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const REFUND = '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';
const NOW = new Date('2026-11-14T12:00:00.000Z');

const input = {
  originAsset: USDC_BASE,
  amount: '25000000',
  refundTo: REFUND,
  depositAddress: D.address,
  dry: true,
  now: NOW,
};

function respond(request: OneClickQuoteRequest, change: object = {}): OneClickQuoteResponse {
  return {
    correlationId: 'c',
    timestamp: NOW.toISOString(),
    signature: 'sig',
    quoteRequest: Object.assign({ ...request }, change),
    quote: {
      depositAddress: request.dry ? undefined : '0x76b4c56085ED136a8744D52bE956396624a730E8',
      amountIn: request.amount,
      amountInFormatted: '25',
      amountInUsd: '25',
      minAmountIn: request.amount,
      amountOut: '37000',
      amountOutFormatted: '0.00037',
      amountOutUsd: '24.6',
      minAmountOut: '36630',
      timeEstimate: 600,
    },
  };
}

describe('buildQuoteRequest', () => {
  it('pays out native BTC to the deposit address and refunds to the user', () => {
    const req = buildQuoteRequest(MAINNET_CONFIG, input);
    expect(req).toMatchObject({
      dry: true,
      swapType: 'EXACT_INPUT',
      originAsset: USDC_BASE,
      destinationAsset: 'nep141:btc.omft.near',
      recipient: D.address,
      recipientType: 'DESTINATION_CHAIN',
      refundTo: REFUND,
      refundType: 'ORIGIN_CHAIN',
      depositType: 'ORIGIN_CHAIN',
      slippageTolerance: 100,
      deadline: '2026-11-14T14:00:00.000Z',
    });
    expect(req.appFees).toBeUndefined();
  });

  it('adds the fee only from config', () => {
    const req = buildQuoteRequest(
      { ...MAINNET_CONFIG, appFeeBps: 25, appFeeRecipient: 'fees.near' },
      input
    );
    expect(req.appFees).toEqual([{ recipient: 'fees.near', fee: 25 }]);
  });

  it('refuses a fee with no recipient or out of range', () => {
    expect(() => buildQuoteRequest({ ...MAINNET_CONFIG, appFeeBps: 25 }, input)).toThrow(
      /recipient/
    );
    expect(() =>
      buildQuoteRequest({ ...MAINNET_CONFIG, appFeeBps: 101, appFeeRecipient: 'x.near' }, input)
    ).toThrow();
    expect(() => buildQuoteRequest({ ...MAINNET_CONFIG, appFeeBps: -1 }, input)).toThrow();
  });

  it.each([
    [
      'a non-taproot payout address',
      { depositAddress: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys' },
    ],
    ['an EVM payout address', { depositAddress: REFUND }],
    ['a decimal amount', { amount: '0.5' }],
    ['a zero amount', { amount: '0' }],
    ['a negative amount', { amount: '-1' }],
    ['a missing refund address', { refundTo: '  ' }],
    ['BTC as the origin asset', { originAsset: 'nep141:btc.omft.near' }],
  ])('rejects %s', (_name, change) => {
    expect(() => buildQuoteRequest(MAINNET_CONFIG, { ...input, ...change })).toThrow();
  });
});

describe('assertQuoteMatchesRequest', () => {
  const sent = buildQuoteRequest(MAINNET_CONFIG, { ...input, dry: false });

  it('accepts a faithful echo', () => {
    expect(() => assertQuoteMatchesRequest(sent, respond(sent))).not.toThrow();
  });

  it.each([
    ['recipient', { recipient: 'bc1pattackerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' }],
    ['refundTo', { refundTo: '0x000000000000000000000000000000000000dEaD' }],
    ['destinationAsset', { destinationAsset: 'nep141:zec.omft.near' }],
    ['originAsset', { originAsset: 'nep141:eth.omft.near' }],
    ['amount', { amount: '1' }],
    ['recipientType', { recipientType: 'INTENTS' }],
    ['appFees', { appFees: [{ recipient: 'thief.near', fee: 100 }] }],
  ])('rejects a response whose %s was rewritten', (field, change) => {
    expect(() => assertQuoteMatchesRequest(sent, respond(sent, change))).toThrow(new RegExp(field));
  });

  it('allows the provider keyless fee and reports it', () => {
    const res = respond(sent, { appFees: [{ recipient: 'provider', fee: 20 }] });
    expect(() => assertQuoteMatchesRequest(sent, res)).not.toThrow();
    expect(providerFeesOf(sent, res)).toEqual([{ recipient: 'provider', fee: 20 }]);
    expect(providerFeesOf(sent, respond(sent))).toEqual([]);
  });

  it('keeps our fee first and unchanged when the provider adds its own', () => {
    const withFee = buildQuoteRequest(
      { ...MAINNET_CONFIG, appFeeBps: 25, appFeeRecipient: 'fees.near' },
      { ...input, dry: false }
    );
    const good = respond(withFee, {
      appFees: [
        { recipient: 'fees.near', fee: 25 },
        { recipient: 'provider', fee: 20 },
      ],
    });
    expect(providerFeesOf(withFee, good)).toEqual([{ recipient: 'provider', fee: 20 }]);
    const redirected = respond(withFee, {
      appFees: [
        { recipient: 'thief.near', fee: 25 },
        { recipient: 'provider', fee: 20 },
      ],
    });
    expect(() => assertQuoteMatchesRequest(withFee, redirected)).toThrow(/appFees/);
    const dropped = respond(withFee, { appFees: [{ recipient: 'provider', fee: 20 }] });
    expect(() => assertQuoteMatchesRequest(withFee, dropped)).toThrow(/appFees/);
  });

  it('rejects a live quote with no deposit address', () => {
    const res = respond(sent);
    delete res.quote.depositAddress;
    expect(() => assertQuoteMatchesRequest(sent, res)).toThrow(/deposit address/);
  });
});

describe('OneClickClient', () => {
  it('sends the JWT and verifies the echoed request', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const req = buildQuoteRequest(MAINNET_CONFIG, input);
    function fetchFn(url: string, init?: RequestInit): Promise<Response> {
      seen.push({ url, init });
      expect(jsonBody(init)).toEqual(req);
      return Promise.resolve(jsonResponse(respond(req)));
    }
    const client = new OneClickClient('https://1click.example', { jwt: 'token', fetchFn });
    const res = await client.quote(req);
    expect(res.quote.minAmountOut).toBe('36630');
    expect(seen[0]?.url).toBe('https://1click.example/v0/quote');
    expect(new Headers(seen[0]?.init?.headers).get('authorization')).toBe('Bearer token');
  });

  it('throws when the server rewrites the recipient', async () => {
    const req = buildQuoteRequest(MAINNET_CONFIG, input);
    function fetchFn(_url: string, init?: RequestInit): Promise<Response> {
      expect(jsonBody(init)).toEqual(req);
      return Promise.resolve(jsonResponse(respond(req, { recipient: 'bc1pevil' })));
    }
    const client = new OneClickClient('https://1click.example', { fetchFn });
    await expect(client.quote(req)).rejects.toThrow(/recipient/);
  });

  it('surfaces HTTP errors with the server message', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(jsonResponse({ message: 'tokenOut is not valid' }, 400));
    }
    const client = new OneClickClient('https://1click.example', { fetchFn });
    await expect(client.quote(buildQuoteRequest(MAINNET_CONFIG, input))).rejects.toThrow(
      /tokenOut is not valid/
    );
  });

  it('encodes status queries', async () => {
    let url = '';
    function fetchFn(u: string): Promise<Response> {
      url = u;
      return Promise.resolve(
        jsonResponse({
          status: 'PROCESSING',
          updatedAt: '',
          swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] },
        })
      );
    }
    const client = new OneClickClient('https://1click.example', { fetchFn });
    expect((await client.status('0xabc', 'm 1')).status).toBe('PROCESSING');
    expect(url).toBe('https://1click.example/v0/status?depositAddress=0xabc&depositMemo=m+1');
  });
});
