import { describe, expect, it } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as C,
  HttpError,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type PrepareWithdrawalInput,
  SWAP_LISTING_RETRY_DELAYS_MS,
  SwapNotListedError,
  assertRecipientRoundTrip,
  decodeWithdrawalArguments,
  oneClickQuoteResponseSchema,
  parseOneClickStatus,
  parseWith,
  prepareWithdrawal,
} from '../../src/index.js';
import { type FakeApiRoutes, fakeWithdrawalApis } from '../fake-withdrawal-apis.js';
import {
  BASE_USDC,
  PLACEHOLDER_EVM_RECIPIENT,
  PLACEHOLDER_REFUND_P2WPKH,
  REAL_ACTIVE_WITHDRAWAL_CONTRACT,
  REAL_BTC_ORIGIN_QUOTE,
  REAL_BTC_ORIGIN_STATUS,
  REAL_LIMITS,
} from '../real-withdrawal-quotes.js';

const NOW = new Date('2026-11-14T16:41:38.000Z');
const DEPOSIT_ADDRESS = 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86';
const SENDER = 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6';
const real = parseWith(oneClickQuoteResponseSchema, REAL_BTC_ORIGIN_QUOTE, 'fixture');

const input: PrepareWithdrawalInput = {
  sender: SENDER,
  amountSats: 10_000,
  destinationAsset: BASE_USDC,
  recipient: PLACEHOLDER_EVM_RECIPIENT,
  refundTo: PLACEHOLDER_REFUND_P2WPKH,
};

function quoteFor(request: OneClickQuoteRequest): OneClickQuoteResponse {
  return {
    ...structuredClone(real),
    quoteRequest: { ...request },
    quote: { ...structuredClone(real.quote), deadline: '2026-11-19T16:41:38.000Z' },
  };
}

function statusFor(quote: OneClickQuoteResponse, status = 'PENDING_DEPOSIT'): unknown {
  const base = parseOneClickStatus(REAL_BTC_ORIGIN_STATUS);
  return {
    ...base,
    status,
    quoteResponse: {
      timestamp: quote.timestamp,
      signature: quote.signature,
      quoteRequest: quote.quoteRequest,
      quote: quote.quote,
    },
  };
}

const ROUTES: FakeApiRoutes = {
  limits: REAL_LIMITS,
  readOnly: { 'get-active-protocol': REAL_ACTIVE_WITHDRAWAL_CONTRACT },
  feeEstimates: { '1': 2.5, '2': 2.1, '6': 1.2 },
};

function deps(
  options: {
    routes?: FakeApiRoutes;
    quote?(r: OneClickQuoteRequest): unknown;
    status?(q: OneClickQuoteResponse): unknown;
  } = {}
) {
  const api = fakeWithdrawalApis(options.routes ?? ROUTES);
  const seen: { requests: OneClickQuoteRequest[]; statusFor: string[] } = {
    requests: [],
    statusFor: [],
  };
  let last: OneClickQuoteResponse | null = null;
  return {
    api,
    seen,
    deps: {
      fetchFn: api.fetchFn,
      now: () => NOW,
      requestQuote(request: OneClickQuoteRequest): Promise<unknown> {
        seen.requests.push(request);
        last = quoteFor(request);
        return Promise.resolve(options.quote ? options.quote(request) : last);
      },
      fetchSwapStatus(depositAddress: string): Promise<unknown> {
        seen.statusFor.push(depositAddress);
        if (!last) throw new Error('status before quote');
        return Promise.resolve(options.status ? options.status(last) : statusFor(last));
      },
    },
  };
}

describe('prepareWithdrawal', () => {
  it('composes limits, fee cap, quote, status echo and the wallet request', async () => {
    const d = deps();
    const prepared = await prepareWithdrawal(C, input, d.deps);
    if (!prepared.ok) throw new Error('expected a prepared withdrawal');
    const r = prepared.receipt;
    expect(r).toMatchObject({
      version: 1,
      preparedAt: NOW.toISOString(),
      sender: SENDER,
      amountSats: 10_000,
      maxFeeSats: 3_000,
      lockedSats: 13_000,
      feeRateSatsPerVbyte: 2.5,
      destinationAsset: BASE_USDC,
      destinationRecipient: PLACEHOLDER_EVM_RECIPIENT,
      refundTo: PLACEHOLDER_REFUND_P2WPKH,
      depositAddress: DEPOSIT_ADDRESS,
      quoteDeadline: '2026-11-16T16:41:38.000Z',
      amountOut: '6515571',
      minAmountOut: '6450415',
      refundFeeSats: 1_900,
    });
    expect(r.quoteResponse.signature).toBe(real.signature);
    expect(r.quoteResponse.timestamp).toBe(real.timestamp);
    expect(r.contractCall.postConditions[0]).toMatchObject({ address: SENDER, amount: '13000' });
    expect(decodeWithdrawalArguments(r.contractCall.functionArgs)).toEqual({
      amountSats: 10_000,
      recipient: r.recipient.recipient,
      maxFeeSats: 3_000,
    });
    expect(
      assertRecipientRoundTrip(DEPOSIT_ADDRESS, r.contractCall.arguments.recipient).scriptPubKey
    ).toBe(r.recipient.scriptPubKey);
    expect(d.seen.requests).toHaveLength(1);
    expect(d.seen.requests[0]?.dry).toBe(false);
    expect(d.seen.statusFor).toEqual([DEPOSIT_ADDRESS]);
    expect(d.api.urls).toEqual([
      'https://sbtc-emily.com/limits',
      'https://api.hiro.so/v2/contracts/call-read/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4/sbtc-registry/get-active-protocol',
      'https://mempool.space/api/fee-estimates',
    ]);
  });

  it('uses a given fee rate instead of fetching one', async () => {
    const d = deps();
    const prepared = await prepareWithdrawal(C, { ...input, feeRateSatsPerVbyte: 10 }, d.deps);
    expect(prepared.ok ? prepared.receipt.maxFeeSats : null).toBe(8_000);
    expect(d.api.urls).not.toContain('https://mempool.space/api/fee-estimates');
  });

  it('returns the amount problems without asking for a quote', async () => {
    const limits = {
      perWithdrawalCap: 5_100_000_000,
      rollingWithdrawalBlocks: 150,
      rollingWithdrawalCap: 15_100_000_000,
      availableToWithdraw: 9_000,
    };
    const d = deps({ routes: { ...ROUTES, limits } });
    const prepared = await prepareWithdrawal(C, { ...input, amountSats: 9_500 }, d.deps);
    expect(prepared.ok ? null : prepared.amountCheck.problems).toEqual([
      'below-minimum',
      'above-available-capacity',
    ]);
    expect(d.seen.requests).toHaveLength(0);
  });

  it('refuses when the limits cannot be read', async () => {
    const d = deps({ routes: { ...ROUTES, limits: undefined } });
    await expect(prepareWithdrawal(C, input, d.deps)).rejects.toThrow(/HTTP 404/);
  });

  it('refuses when the registry names another withdrawal contract', async () => {
    const d = deps({ routes: { ...ROUTES, readOnly: { 'get-active-protocol': '0x09' } } });
    await expect(prepareWithdrawal(C, input, d.deps)).rejects.toThrow(/names no contract/);
    expect(d.seen.requests).toHaveLength(0);
  });

  it('refuses a bad sender before any request', async () => {
    const d = deps();
    await expect(prepareWithdrawal(C, { ...input, sender: 'bc1qxyz' }, d.deps)).rejects.toThrow(
      /sender/
    );
    expect(d.api.urls).toHaveLength(0);
  });

  it('refuses when Bitcoin fees are too high', async () => {
    const d = deps({ routes: { ...ROUTES, feeEstimates: { '1': 400 } } });
    await expect(prepareWithdrawal(C, input, d.deps)).rejects.toThrow(/too high right now/);
    expect(d.seen.requests).toHaveLength(0);
  });

  it('refuses a quote that pays another address than its status echo', async () => {
    const d = deps({
      status: q =>
        statusFor({ ...q, quote: { ...q.quote, depositAddress: PLACEHOLDER_REFUND_P2WPKH } }),
    });
    await expect(prepareWithdrawal(C, input, d.deps)).rejects.toThrow(
      /"quote.depositAddress" differs/
    );
  });

  it('refuses a status without an echo', async () => {
    const d = deps({ status: () => parseOneClickStatus(REAL_BTC_ORIGIN_STATUS) });
    const raw = deps({
      status() {
        const s = { ...parseOneClickStatus(REAL_BTC_ORIGIN_STATUS) };
        return { status: s.status, updatedAt: s.updatedAt, swapDetails: s.swapDetails };
      },
    });
    await expect(prepareWithdrawal(C, input, d.deps)).rejects.toThrow(/differs/);
    await expect(prepareWithdrawal(C, input, raw.deps)).rejects.toThrow(/"quoteResponse" differs/);
  });

  it('refuses a swap address that is not waiting for a deposit', async () => {
    const d = deps({ status: q => statusFor(q, 'PROCESSING') });
    await expect(prepareWithdrawal(C, input, d.deps)).rejects.toThrow(/not waiting for a deposit/);
  });

  it('refuses a tampered quote', async () => {
    const d = deps({
      quote: r => ({ ...quoteFor(r), quote: { ...quoteFor(r).quote, amountIn: '9999' } }),
    });
    await expect(prepareWithdrawal(C, input, d.deps)).rejects.toThrow(
      /"amountIn" is not the requested amount/
    );
    const bad = deps({ quote: () => ({ nope: true }) });
    await expect(prepareWithdrawal(C, input, bad.deps)).rejects.toThrow(
      /Unexpected data from 1Click quote/
    );
  });

  it('refuses a quote with a non-standard deposit address', async () => {
    const d = deps({
      quote: r => ({
        ...quoteFor(r),
        quote: {
          ...quoteFor(r).quote,
          depositAddress: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
        },
      }),
    });
    await expect(prepareWithdrawal(C, input, d.deps)).rejects.toThrow(/testnet/);
  });

  it('waits for 1Click to list a fresh swap before reading its status', async () => {
    const slept: number[] = [];
    let misses = 2;
    const d = deps({
      status(q) {
        if (misses > 0) {
          misses -= 1;
          throw new SwapNotListedError('Deposit address not found');
        }
        return statusFor(q);
      },
    });
    const prepared = await prepareWithdrawal(C, input, {
      ...d.deps,
      sleep(ms) {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    expect(prepared.ok).toBe(true);
    expect(slept).toEqual(SWAP_LISTING_RETRY_DELAYS_MS.slice(0, 2));
    expect(d.seen.statusFor).toHaveLength(3);
    expect(d.seen.requests).toHaveLength(1);
  });

  it('treats an HTTP 404 from 1Click as a swap that is not listed yet', async () => {
    let misses = 1;
    const d = deps({
      status(q) {
        if (misses > 0) {
          misses -= 1;
          throw new HttpError(404, 'https://1click/v0/status', 'not found');
        }
        return statusFor(q);
      },
    });
    const prepared = await prepareWithdrawal(C, input, {
      ...d.deps,
      sleep: () => Promise.resolve(),
    });
    expect(prepared.ok).toBe(true);
    expect(d.seen.statusFor).toHaveLength(2);
  });

  it('gives up with a clear message when the swap never gets listed', async () => {
    const slept: number[] = [];
    const d = deps({
      status() {
        throw new SwapNotListedError('Deposit address not found');
      },
    });
    const attempt = prepareWithdrawal(C, input, {
      ...d.deps,
      sleep(ms) {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    await expect(attempt).rejects.toThrow(/1Click has not listed the new swap yet/);
    expect(slept).toEqual([...SWAP_LISTING_RETRY_DELAYS_MS]);
    expect(d.seen.statusFor).toHaveLength(SWAP_LISTING_RETRY_DELAYS_MS.length + 1);
    const total = SWAP_LISTING_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeGreaterThanOrEqual(5_000);
    expect(total).toBeLessThanOrEqual(10_000);
  });

  it('does not retry a status that answers with a mismatch or another failure', async () => {
    const slept: number[] = [];
    function sleep(ms: number) {
      slept.push(ms);
      return Promise.resolve();
    }
    const mismatch = deps({
      status: q =>
        statusFor({ ...q, quote: { ...q.quote, depositAddress: PLACEHOLDER_REFUND_P2WPKH } }),
    });
    await expect(prepareWithdrawal(C, input, { ...mismatch.deps, sleep })).rejects.toThrow(
      /differs/
    );
    expect(mismatch.seen.statusFor).toHaveLength(1);
    const down = deps({
      status() {
        throw new HttpError(500, 'https://1click/v0/status', 'boom');
      },
    });
    await expect(prepareWithdrawal(C, input, { ...down.deps, sleep })).rejects.toThrow(/HTTP 500/);
    expect(down.seen.statusFor).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('stops waiting for the swap listing when aborted', async () => {
    const controller = new AbortController();
    const d = deps({
      status() {
        throw new SwapNotListedError('Deposit address not found');
      },
    });
    const attempt = prepareWithdrawal(C, input, {
      ...d.deps,
      signal: controller.signal,
      sleep() {
        controller.abort(new Error('user left'));
        return Promise.resolve();
      },
    });
    await expect(attempt).rejects.toThrow(/user left/);
    expect(d.seen.statusFor).toHaveLength(1);
  });

  it('passes upstream errors from the quote call', async () => {
    const d = deps({
      quote() {
        throw new Error('quote service down');
      },
    });
    await expect(prepareWithdrawal(C, input, d.deps)).rejects.toThrow(/quote service down/);
  });
});
