import { describe, expect, it } from 'vitest';

import {
  QUOTE_REFERRAL,
  ResponseShapeError,
  StatusEchoMismatchError,
  appFeesFor,
  assertAppFeeConfig,
  assertStatusMatchesQuote,
  oneClickQuoteResponseSchema,
  oneClickStatusResponseSchema,
  parseOneClickStatus,
  parseWith,
  refundOf,
  statusQuoteEchoOf,
} from '../../src/index.js';
import { REAL_BTC_ORIGIN_QUOTE, REAL_BTC_ORIGIN_STATUS } from '../real-withdrawal-quotes.js';

const quote = parseWith(oneClickQuoteResponseSchema, REAL_BTC_ORIGIN_QUOTE, 'fixture');

function statusWith(patch: (raw: Record<string, unknown>) => void) {
  const raw: Record<string, unknown> = structuredClone({
    ...parseOneClickStatus(REAL_BTC_ORIGIN_STATUS),
  });
  patch(raw);
  return parseOneClickStatus(raw);
}

describe('parseOneClickStatus', () => {
  it('reads the real pending BTC-origin status, whose empty fields are null', () => {
    const status = parseOneClickStatus(REAL_BTC_ORIGIN_STATUS);
    expect(status.status).toBe('PENDING_DEPOSIT');
    expect(status.swapDetails.amountOut).toBeUndefined();
    expect(status.swapDetails.refundReason).toBeUndefined();
    expect(status.swapDetails.refundedAmount).toBe('0');
  });

  it('reads that real response with the one status schema every reader uses', () => {
    expect(parseWith(oneClickStatusResponseSchema, REAL_BTC_ORIGIN_STATUS, 'x')).toEqual(
      parseOneClickStatus(REAL_BTC_ORIGIN_STATUS)
    );
  });

  it('still refuses an unknown status', () => {
    const raw = { ...parseOneClickStatus(REAL_BTC_ORIGIN_STATUS), status: 'LOST' };
    expect(() => parseOneClickStatus(raw)).toThrow(ResponseShapeError);
  });
});

function echoed(raw: Record<string, unknown>): {
  quoteRequest: Record<string, unknown>;
  quote: Record<string, unknown>;
} & Record<string, unknown> {
  const echo = raw.quoteResponse;
  if (typeof echo !== 'object' || echo === null) throw new Error('no echo');
  const out: Record<string, unknown> = { ...echo };
  const quoteRequest = out.quoteRequest;
  const q = out.quote;
  if (typeof quoteRequest !== 'object' || quoteRequest === null) throw new Error('no request');
  if (typeof q !== 'object' || q === null) throw new Error('no quote');
  const result = { ...out, quoteRequest: { ...quoteRequest }, quote: { ...q } };
  raw.quoteResponse = result;
  return result;
}

describe('assertStatusMatchesQuote with the real BTC-origin quote and status', () => {
  it('accepts the real status echo of the real quote', () => {
    const status = statusWith(() => undefined);
    expect(() => assertStatusMatchesQuote(quote, status)).not.toThrow();
    expect(statusQuoteEchoOf(status)?.quote.depositAddress).toBe(
      'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86'
    );
  });

  it.each([
    [
      'quoteRequest.recipient',
      'quoteRequest',
      'recipient',
      '0x0000000000000000000000000000000000000001',
    ],
    [
      'quoteRequest.refundTo',
      'quoteRequest',
      'refundTo',
      'bc1qudw5dtalvhtfen35wt6tlxug3sm4jscqpm0uz4',
    ],
    ['quoteRequest.originAsset', 'quoteRequest', 'originAsset', 'nep141:eth.omft.near'],
    ['quoteRequest.destinationAsset', 'quoteRequest', 'destinationAsset', 'nep141:sol.omft.near'],
    ['quoteRequest.amount', 'quoteRequest', 'amount', '10001'],
    ['quoteRequest.slippageTolerance', 'quoteRequest', 'slippageTolerance', 300],
    ['quoteRequest.refundType', 'quoteRequest', 'refundType', 'INTENTS'],
    ['quoteRequest.deadline', 'quoteRequest', 'deadline', '2026-11-21T16:41:40.000Z'],
    [
      'quote.depositAddress',
      'quote',
      'depositAddress',
      'bc1qudw5dtalvhtfen35wt6tlxug3sm4jscqpm0uz4',
    ],
    ['quote.amountIn', 'quote', 'amountIn', '9999'],
    ['quote.minAmountIn', 'quote', 'minAmountIn', '10001'],
    ['quote.minAmountOut', 'quote', 'minAmountOut', '1'],
    ['quote.amountOut', 'quote', 'amountOut', '1'],
    ['quote.depositMemo', 'quote', 'depositMemo', 'memo'],
  ])('refuses a status whose %s differs', (field, part, key, value) => {
    const status = statusWith(raw => {
      const echo = echoed(raw);
      const target = part === 'quote' ? echo.quote : echo.quoteRequest;
      target[key] = value;
    });
    expect(() => assertStatusMatchesQuote(quote, status)).toThrow(StatusEchoMismatchError);
    expect(() => assertStatusMatchesQuote(quote, status)).toThrow(`"${field}" differs`);
  });

  it('refuses a different signature or timestamp', () => {
    const signed = statusWith(raw => {
      echoed(raw).signature = 'ed25519:other';
    });
    expect(() => assertStatusMatchesQuote(quote, signed)).toThrow('"signature" differs');
    const timed = statusWith(raw => {
      echoed(raw).timestamp = '2026-11-14T16:41:40.981Z';
    });
    expect(() => assertStatusMatchesQuote(quote, timed)).toThrow('"timestamp" differs');
  });

  it('refuses a status that does not echo a quote', () => {
    const status = statusWith(raw => {
      delete raw.quoteResponse;
    });
    expect(statusQuoteEchoOf(status)).toBeNull();
    expect(() => assertStatusMatchesQuote(quote, status)).toThrow('"quoteResponse" differs');
  });

  it('refuses an echo of the wrong shape', () => {
    const status = statusWith(raw => {
      raw.quoteResponse = { quoteRequest: 'nope', quote: {} };
    });
    expect(() => statusQuoteEchoOf(status)).toThrow(StatusEchoMismatchError);
  });
});

describe('refundOf', () => {
  it('reads the real pending status as not refunded', () => {
    expect(refundOf(statusWith(() => undefined))).toEqual({
      refunded: false,
      refundedAmount: '0',
      refundedAmountFormatted: '0',
      refundReason: null,
      refundFee: '1900',
    });
  });

  it('reads a refund', () => {
    const status = statusWith(raw => {
      raw.status = 'REFUNDED';
      const details = raw.swapDetails;
      if (typeof details !== 'object' || details === null) throw new Error('no details');
      raw.swapDetails = {
        ...details,
        refundedAmount: '8100',
        refundedAmountFormatted: '0.000081',
        refundReason: 'Price moved',
      };
    });
    expect(refundOf(status)).toEqual({
      refunded: true,
      refundedAmount: '8100',
      refundedAmountFormatted: '0.000081',
      refundReason: 'Price moved',
      refundFee: '1900',
    });
  });

  it('drops a formatted refund amount that does not match the base units', () => {
    const status = statusWith(raw => {
      raw.status = 'REFUNDED';
      const details = raw.swapDetails;
      if (typeof details !== 'object' || details === null) throw new Error('no details');
      raw.swapDetails = { ...details, refundedAmount: '8100', refundedAmountFormatted: '0' };
    });
    expect(refundOf(status)?.refundedAmountFormatted).toBeNull();
  });

  it('is null without a status and ignores amounts that are not whole numbers', () => {
    expect(refundOf(null)).toBeNull();
    const status = statusWith(raw => {
      const details = raw.swapDetails;
      if (typeof details !== 'object' || details === null) throw new Error('no details');
      raw.swapDetails = { ...details, refundedAmount: '0.5', refundFee: undefined };
    });
    expect(refundOf(status)).toMatchObject({
      refunded: false,
      refundedAmount: null,
      refundFee: null,
    });
  });
});

describe('quote attribution shared by both flows', () => {
  it('uses the satway referral and the configured app fee', () => {
    expect(QUOTE_REFERRAL).toBe('satway');
    expect(appFeesFor({ appFeeBps: 0, appFeeRecipient: null })).toBeUndefined();
    expect(appFeesFor({ appFeeBps: 20, appFeeRecipient: 'abc' })).toEqual([
      { recipient: 'abc', fee: 20 },
    ]);
    expect(() => appFeesFor({ appFeeBps: 20, appFeeRecipient: null })).toThrow(/no recipient/);
    expect(() => assertAppFeeConfig({ appFeeBps: 101, appFeeRecipient: 'abc' })).toThrow(
      /between 0 and 100/
    );
    expect(() => assertAppFeeConfig({ appFeeBps: -1, appFeeRecipient: 'abc' })).toThrow(
      /between 0 and 100/
    );
  });
});
