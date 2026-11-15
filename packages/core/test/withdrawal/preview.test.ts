import { describe, expect, it } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as C,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type PreviewWithdrawalInput,
  compareWithdrawalQuotes,
  oneClickQuoteResponseSchema,
  parseWith,
  previewWithdrawal,
} from '../../src/index.js';
import { type FakeApiRoutes, fakeWithdrawalApis } from '../fake-withdrawal-apis.js';
import {
  BASE_USDC,
  PLACEHOLDER_EVM_RECIPIENT,
  PLACEHOLDER_REFUND_P2WPKH,
  REAL_BTC_ORIGIN_DRY_QUOTE,
  REAL_LIMITS,
} from '../real-withdrawal-quotes.js';

const NOW = new Date('2026-11-14T16:40:40.000Z');
const real = parseWith(oneClickQuoteResponseSchema, REAL_BTC_ORIGIN_DRY_QUOTE, 'fixture');

const input: PreviewWithdrawalInput = {
  amountSats: 10_000,
  destinationAsset: BASE_USDC,
  recipient: PLACEHOLDER_EVM_RECIPIENT,
  refundTo: PLACEHOLDER_REFUND_P2WPKH,
};

const ROUTES: FakeApiRoutes = {
  limits: REAL_LIMITS,
  feeEstimates: { '1': 2.5, '2': 2.1, '6': 1.2 },
};

function dryQuoteFor(request: OneClickQuoteRequest): OneClickQuoteResponse {
  return {
    ...structuredClone(real),
    quoteRequest: { ...request, appFees: real.quoteRequest.appFees },
  };
}

function deps(options: { routes?: FakeApiRoutes; quote?(r: OneClickQuoteRequest): unknown } = {}) {
  const api = fakeWithdrawalApis(options.routes ?? ROUTES);
  const requests: OneClickQuoteRequest[] = [];
  return {
    api,
    requests,
    deps: {
      fetchFn: api.fetchFn,
      now: () => NOW,
      requestQuote(request: OneClickQuoteRequest): Promise<unknown> {
        requests.push(request);
        return Promise.resolve(options.quote ? options.quote(request) : dryQuoteFor(request));
      },
    },
  };
}

describe('previewWithdrawal', () => {
  it('composes limits, fee cap and a dry quote without touching Stacks', async () => {
    const d = deps();
    const previewed = await previewWithdrawal(C, input, d.deps);
    if (!previewed.ok) throw new Error('expected a preview');
    expect(previewed.preview).toMatchObject({
      amountSats: 10_000,
      maxFeeSats: 3_000,
      lockedSats: 13_000,
      feeRateSatsPerVbyte: 2.5,
      amountOut: '6517200',
      minAmountOut: '6452028',
      refundFeeSats: 1_900,
    });
    expect(previewed.preview.providerFees).toEqual([
      { recipient: '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd', fee: 20 },
    ]);
    expect(d.requests).toHaveLength(1);
    expect(d.requests[0]).toMatchObject({
      dry: true,
      originAsset: C.btcAssetId,
      destinationAsset: BASE_USDC,
      amount: '10000',
      refundTo: PLACEHOLDER_REFUND_P2WPKH,
      recipient: PLACEHOLDER_EVM_RECIPIENT,
      deadline: '2026-11-16T16:40:40.000Z',
      referral: 'satway',
    });
    expect(d.api.urls).toEqual([
      'https://sbtc-emily.com/limits',
      'https://mempool.space/api/fee-estimates',
    ]);
  });

  it('uses a given fee rate', async () => {
    const d = deps();
    const previewed = await previewWithdrawal(C, { ...input, feeRateSatsPerVbyte: 10 }, d.deps);
    expect(previewed.ok ? previewed.preview.maxFeeSats : null).toBe(7_600);
    expect(d.api.urls).not.toContain('https://mempool.space/api/fee-estimates');
  });

  it('returns the amount problems without asking for a quote', async () => {
    const d = deps();
    const previewed = await previewWithdrawal(C, { ...input, amountSats: 9_999 }, d.deps);
    expect(previewed.ok ? null : previewed.amountCheck.problems).toEqual(['below-minimum']);
    expect(d.requests).toHaveLength(0);
  });

  it('refuses when fees are too high, before any quote', async () => {
    const d = deps({ routes: { ...ROUTES, feeEstimates: { '1': 400 } } });
    await expect(previewWithdrawal(C, input, d.deps)).rejects.toThrow(/too high right now/);
    expect(d.requests).toHaveLength(0);
  });

  it('refuses a bad refund address or recipient before any quote', async () => {
    const d = deps();
    await expect(
      previewWithdrawal(
        C,
        { ...input, refundTo: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' },
        d.deps
      )
    ).rejects.toThrow(/testnet/);
    await expect(previewWithdrawal(C, { ...input, recipient: 'a b' }, d.deps)).rejects.toThrow(
      /recipient/
    );
    expect(d.requests).toHaveLength(0);
  });

  it('refuses a dry quote that does not echo the request', async () => {
    const d = deps({
      quote: r => ({ ...dryQuoteFor(r), quoteRequest: { ...r, recipient: '0x00' } }),
    });
    await expect(previewWithdrawal(C, input, d.deps)).rejects.toThrow(/"recipient" was changed/);
    const memo = deps({
      quote: r => ({ ...dryQuoteFor(r), quote: { ...real.quote, depositMemo: '7' } }),
    });
    await expect(previewWithdrawal(C, input, memo.deps)).rejects.toThrow(/deposit memo/);
    const junk = deps({ quote: () => ({ nope: true }) });
    await expect(previewWithdrawal(C, input, junk.deps)).rejects.toThrow(/Unexpected data/);
  });
});

describe('compareWithdrawalQuotes', () => {
  const preview = { amountOut: '6517200', minAmountOut: '6452028', maxFeeSats: 3_000 };

  it('is not worse when the live quote is the same or better', () => {
    expect(compareWithdrawalQuotes(preview, preview).worse).toBe(false);
    expect(
      compareWithdrawalQuotes(preview, {
        amountOut: '6600000',
        minAmountOut: '6500000',
        maxFeeSats: 3_000,
      })
    ).toEqual({
      amountOutDropped: false,
      minAmountOutDropped: false,
      feeCapRose: false,
      worse: false,
    });
  });

  it('flags a lower expected or minimum output and a higher fee cap', () => {
    expect(
      compareWithdrawalQuotes(preview, {
        ...preview,
        amountOut: '6515571',
        minAmountOut: '6450415',
      })
    ).toEqual({
      amountOutDropped: true,
      minAmountOutDropped: true,
      feeCapRose: false,
      worse: true,
    });
    expect(compareWithdrawalQuotes(preview, { ...preview, maxFeeSats: 3_040 })).toMatchObject({
      feeCapRose: true,
      worse: true,
    });
  });

  it('compares large base-unit amounts exactly', () => {
    expect(
      compareWithdrawalQuotes(
        { ...preview, amountOut: '1000000000000000000001' },
        { ...preview, amountOut: '1000000000000000000000' }
      ).amountOutDropped
    ).toBe(true);
  });
});
