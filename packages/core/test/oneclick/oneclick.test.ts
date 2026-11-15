import { describe, expect, it } from 'vitest';

import {
  MAINNET_CONFIG,
  OneClickClient,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  assertQuoteMatchesRequest,
  buildQuoteRequest,
  oneClickQuoteResponseSchema,
  providerFeesOf,
} from '../../src/index.js';
import { REAL_DEPOSIT as D, jsonBody, jsonResponse } from '../fixtures.js';
import { LIVE_PROBE_QUOTE, REAL_DRY_QUOTE, REAL_LIVE_QUOTE } from '../real-responses.js';

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

  it('matches our fee in a real live echo, which adds limitOrderId: null to each entry', () => {
    const real = oneClickQuoteResponseSchema.parse(REAL_LIVE_QUOTE);
    const [echoedFee] = real.quoteRequest.appFees ?? [];
    expect(echoedFee).toMatchObject({ limitOrderId: null });
    const ours: OneClickQuoteRequest = {
      ...real.quoteRequest,
      appFees: [{ recipient: String(echoedFee?.recipient), fee: Number(echoedFee?.fee) }],
    };
    expect(providerFeesOf(ours, real)).toEqual([]);
    expect(() =>
      providerFeesOf({ ...ours, appFees: [{ recipient: 'thief.near', fee: 20 }] }, real)
    ).toThrow(/appFees/);
    expect(() =>
      providerFeesOf(
        { ...ours, appFees: [{ recipient: String(echoedFee?.recipient), fee: 25 }] },
        real
      )
    ).toThrow(/appFees/);
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

  it.each([
    ['slippageTolerance', { slippageTolerance: 500 }],
    ['slippageTolerance', { slippageTolerance: undefined }],
    ['dry', { dry: true }],
    ['deadline', { deadline: '2026-11-21T14:00:00.000Z' }],
    ['deadline', { deadline: '2026-11-14T14:00:01.000Z' }],
    ['deadline', { deadline: 'soon' }],
    ['deadline', { deadline: undefined }],
  ])('rejects a response whose %s echo differs: %j', (field, change) => {
    expect(() => assertQuoteMatchesRequest(sent, respond(sent, change))).toThrow(new RegExp(field));
  });

  it.each([
    ['without milliseconds', '2026-11-14T14:00:00Z'],
    ['truncated to the second', '2026-11-14T13:59:59.001Z'],
    ['in another time zone', '2026-11-14T16:00:00.000+02:00'],
  ])('accepts a deadline echoed %s', (_name, deadline) => {
    expect(() => assertQuoteMatchesRequest(sent, respond(sent, { deadline }))).not.toThrow();
  });

  function withAmounts(amountOut: string, minAmountOut: string): OneClickQuoteResponse {
    const res = respond(sent);
    res.quote.amountOut = amountOut;
    res.quote.minAmountOut = minAmountOut;
    return res;
  }

  it.each([
    ['exactly the slippage floor', '37000', '36630'],
    ['one unit of rounding below the floor', '36031', '35669'],
    ['a tighter minimum', '37000', '36900'],
    ['a minimum equal to the expected output', '37000', '37000'],
  ])('accepts %s', (_name, amountOut, minAmountOut) => {
    expect(() =>
      assertQuoteMatchesRequest(sent, withAmounts(amountOut, minAmountOut))
    ).not.toThrow();
  });

  it.each([
    ['a minimum looser than the slippage', '37000', '36628', /slippage/],
    ['a minimum of zero', '37000', '0', /slippage/],
    ['a minimum above the expected output', '37000', '37001', /above its expected/],
    ['a non-numeric amount', '37000.5', '36630', /whole numbers/],
  ])('rejects %s', (_name, amountOut, minAmountOut, message) => {
    expect(() => assertQuoteMatchesRequest(sent, withAmounts(amountOut, minAmountOut))).toThrow(
      message
    );
  });

  function withInput(amountIn: string, minAmountIn: string): OneClickQuoteResponse {
    const res = respond(sent);
    res.quote.amountIn = amountIn;
    res.quote.minAmountIn = minAmountIn;
    return res;
  }

  it.each([
    ['a doubled amountIn', '50000000', '25000000', /"amountIn" is not the requested amount/],
    ['a smaller amountIn', '24999999', '24999999', /"amountIn" is not the requested amount/],
    ['an amountIn with a decimal point', '25000000.0', '25000000', /whole numbers/],
    ['a minAmountIn above amountIn', '25000000', '25000001', /minimum input/],
    ['a minAmountIn that is not a number', '25000000', 'all', /whole numbers/],
  ])('rejects %s, which the page would show and the wallet would send', (_n, a, min, message) => {
    expect(() => assertQuoteMatchesRequest(sent, withInput(a, min))).toThrow(message);
  });

  it('accepts a minAmountIn below amountIn, since exactly amountIn is sent', () => {
    expect(() => assertQuoteMatchesRequest(sent, withInput('25000000', '24750000'))).not.toThrow();
  });

  it.each([
    ['the recorded dry quote', REAL_DRY_QUOTE, '2026-11-14T19:50:54.640Z'],
    ['a live probe with milliseconds echoed', LIVE_PROBE_QUOTE, '2026-11-15T10:15:02.350Z'],
    ['a recorded live quote', REAL_LIVE_QUOTE, '2026-11-14T17:26:56.298Z'],
  ])('accepts %s, echoed by 1Click', (_name, raw, requestedDeadline) => {
    const real = oneClickQuoteResponseSchema.parse(raw);
    const echoed = real.quoteRequest;
    const ours: OneClickQuoteRequest = {
      dry: echoed.dry,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: echoed.originAsset,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: MAINNET_CONFIG.btcAssetId,
      amount: echoed.amount,
      refundTo: echoed.refundTo,
      refundType: 'ORIGIN_CHAIN',
      recipient: echoed.recipient,
      recipientType: 'DESTINATION_CHAIN',
      deadline: requestedDeadline,
      referral: 'portage',
    };
    expect(() => assertQuoteMatchesRequest(ours, real)).not.toThrow();
    expect(() => assertQuoteMatchesRequest({ ...ours, dry: !ours.dry }, real)).toThrow(/dry/);
    expect(() => assertQuoteMatchesRequest({ ...ours, slippageTolerance: 50 }, real)).toThrow(
      /slippageTolerance/
    );
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
