import { describe, expect, it } from 'vitest';

import {
  OneClickClient,
  ResponseShapeError,
  assertStatusMatchesQuote,
  destinationTxHashesOf,
  formatBaseUnits,
  oneClickQuoteResponseSchema,
  oneClickStatusResponseSchema,
  parseOneClickStatus,
  parseWith,
  refundOf,
  remainingDepositOf,
} from '../../src/index.js';
import { REAL_LIVE_QUOTE, REAL_LIVE_STATUS } from '../real-responses.js';
import { REAL_BTC_ORIGIN_STATUS } from '../real-withdrawal-quotes.js';

const PAYOUT = '9f6a3c1f1d7a2b6e4c5d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('not an object');
  return { ...value };
}

function derived(
  status: string,
  details: Record<string, unknown>,
  base: unknown = REAL_LIVE_STATUS
): unknown {
  const raw = record(structuredClone(base));
  return { ...raw, status, swapDetails: { ...record(raw.swapDetails), ...details } };
}

const DEPOSITED = {
  depositedAmount: '25000000',
  depositedAmountFormatted: '25.0',
  depositedAmountUsd: '24.99',
  originChainTxHashes: [{ hash: '5sig', explorerUrl: 'https://solscan.io/tx/5sig' }],
};

const SHAPES: [string, unknown][] = [
  ['the real pending Solana-origin status', REAL_LIVE_STATUS],
  ['the real pending BTC-origin status', REAL_BTC_ORIGIN_STATUS],
  ['a known deposit transaction', derived('KNOWN_DEPOSIT_TX', DEPOSITED)],
  ['a short deposit', derived('INCOMPLETE_DEPOSIT', { ...DEPOSITED, depositedAmount: '1000' })],
  ['processing', derived('PROCESSING', { ...DEPOSITED, amountIn: '25000000' })],
  [
    'success',
    derived('SUCCESS', {
      ...DEPOSITED,
      amountIn: '25000000',
      amountOut: '36226',
      amountOutFormatted: '0.00036226',
      slippage: 3,
      destinationChainTxHashes: [{ hash: PAYOUT, explorerUrl: null }],
    }),
  ],
  [
    'refunded',
    derived('REFUNDED', {
      ...DEPOSITED,
      refundedAmount: '24990028',
      refundReason: 'PARTIAL_DEPOSIT',
    }),
  ],
  ['failed', derived('FAILED', DEPOSITED)],
];

function serve(body: unknown) {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

describe('the 1Click status schema reads real responses', () => {
  it.each(SHAPES)('parses %s', async (_name, body) => {
    const parsed = parseOneClickStatus(body);
    expect(parseWith(oneClickStatusResponseSchema, body, 'x')).toEqual(parsed);
    const client = new OneClickClient('https://1click.example', { fetchFn: serve(body) });
    expect(await client.status('2CXBDfuKKrEmmo5vXnYbCEbUbDyweZcbL12gXC4vHC4G')).toEqual(parsed);
  });

  it('maps the nulls of a real pending status to absent values', () => {
    const status = parseOneClickStatus(REAL_LIVE_STATUS);
    expect(status.status).toBe('PENDING_DEPOSIT');
    expect(status.swapDetails.amountOut).toBeUndefined();
    expect(status.swapDetails.amountIn).toBeUndefined();
    expect(status.swapDetails.depositedAmount).toBeUndefined();
    expect(status.swapDetails.refundReason).toBeUndefined();
    expect(destinationTxHashesOf(status)).toEqual([]);
    expect(refundOf(status)?.refunded).toBe(false);
  });

  it('keeps the quote echo of the real status, which matches the real quote it came from', () => {
    const quote = parseWith(oneClickQuoteResponseSchema, REAL_LIVE_QUOTE, 'quote');
    expect(() =>
      assertStatusMatchesQuote(quote, parseOneClickStatus(REAL_LIVE_STATUS))
    ).not.toThrow();
  });

  it('reads the quote 1Click echoes in a real status, whose referral and memo fields are null', () => {
    const raw = record(REAL_LIVE_STATUS);
    const echo = { ...record(raw.quoteResponse), correlationId: raw.correlationId };
    const quote = parseWith(oneClickQuoteResponseSchema, echo, 'echo');
    expect(quote.quoteRequest.referral).toBeUndefined();
    const withNullMemo = {
      ...record(echo),
      quote: { ...record(record(echo).quote), depositMemo: null },
    };
    expect(
      parseWith(oneClickQuoteResponseSchema, withNullMemo, 'echo').quote.depositMemo
    ).toBeUndefined();
  });

  it('reads the payout hash and amount of a success', () => {
    const status = parseOneClickStatus(SHAPES[5]?.[1]);
    expect(destinationTxHashesOf(status)).toEqual([PAYOUT]);
    expect(status.swapDetails.amountOut).toBe('36226');
    expect(status.swapDetails.destinationChainTxHashes[0]?.explorerUrl).toBeUndefined();
  });

  it.each([
    ['an unknown status', derived('LOST', {})],
    ['no hash list', derived('SUCCESS', { destinationChainTxHashes: null })],
    ['a hash that is not text', derived('SUCCESS', { destinationChainTxHashes: [{ hash: 7 }] })],
    ['an amount that is a number', derived('SUCCESS', { amountOut: 36226 })],
  ])('still refuses %s', (_name, body) => {
    expect(() => parseOneClickStatus(body)).toThrow(ResponseShapeError);
  });
});

describe('remainingDepositOf', () => {
  function short(depositedAmount: unknown, status = 'INCOMPLETE_DEPOSIT') {
    return parseOneClickStatus(derived(status, { depositedAmount }));
  }

  it('is what is still owed after a short deposit', () => {
    expect(remainingDepositOf(short('10000000'), '25000000')).toBe(15000000n);
    expect(formatBaseUnits(15000000n, 6)).toBe('15.0');
  });

  it.each([
    ['1Click does not report the deposited amount', short(null)],
    ['the deposited amount is not a whole number', short('10.5')],
    ['nothing was deposited', short('0')],
    ['the whole amount was deposited', short('25000000')],
    ['the swap is not short', short('10000000', 'PROCESSING')],
  ])('is unknown when %s', (_name, status) => {
    expect(remainingDepositOf(status, '25000000')).toBeNull();
  });

  it('is unknown without a status', () => {
    expect(remainingDepositOf(null, '25000000')).toBeNull();
  });
});

describe('formatBaseUnits', () => {
  it.each([
    [60000000n, 6, '60.0'],
    [1n, 6, '0.000001'],
    [123450000000000000n, 18, '0.12345'],
    [0n, 9, '0.0'],
  ])('formats %s with %i decimals as %s', (units, decimals, text) => {
    expect(formatBaseUnits(units, decimals)).toBe(text);
  });
});
