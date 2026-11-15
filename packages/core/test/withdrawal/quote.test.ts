import { describe, expect, it } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as C,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  buildWithdrawalQuoteRequest,
  checkWithdrawalQuoteEcho,
  oneClickQuoteResponseSchema,
  parseWith,
  resolveWithdrawalSlippage,
  verifyWithdrawalQuote,
} from '../../src/index.js';
import {
  BASE_USDC,
  PLACEHOLDER_EVM_RECIPIENT,
  PLACEHOLDER_REFUND_P2WPKH,
  REAL_BTC_ORIGIN_DRY_QUOTE,
  REAL_BTC_ORIGIN_QUOTE,
} from '../real-withdrawal-quotes.js';

const NOW = new Date('2026-11-15T12:00:00.000Z');

const input = {
  destinationAsset: BASE_USDC,
  recipient: PLACEHOLDER_EVM_RECIPIENT,
  refundTo: PLACEHOLDER_REFUND_P2WPKH,
  amountSats: 10_000,
  dry: false,
  now: NOW,
};

describe('buildWithdrawalQuoteRequest', () => {
  it('builds an EXACT_INPUT BTC-origin request with a 48 hour deadline', () => {
    expect(buildWithdrawalQuoteRequest(C, input)).toEqual({
      dry: false,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: 'nep141:btc.omft.near',
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: BASE_USDC,
      amount: '10000',
      refundTo: PLACEHOLDER_REFUND_P2WPKH,
      refundType: 'ORIGIN_CHAIN',
      recipient: PLACEHOLDER_EVM_RECIPIENT,
      recipientType: 'DESTINATION_CHAIN',
      deadline: '2026-11-17T12:00:00.000Z',
      referral: 'satway',
    });
  });

  it('adds the app fee like the deposit request does', () => {
    const request = buildWithdrawalQuoteRequest(
      { ...C, appFeeBps: 20, appFeeRecipient: 'fees.near' },
      input
    );
    expect(request.appFees).toEqual([{ recipient: 'fees.near', fee: 20 }]);
    expect(() =>
      buildWithdrawalQuoteRequest({ ...C, appFeeBps: 20, appFeeRecipient: null }, input)
    ).toThrow(/no recipient/);
    expect(() => buildWithdrawalQuoteRequest({ ...C, appFeeBps: 101 }, input)).toThrow(
      /between 0 and 100/
    );
  });

  it('accepts the allowed slippage values only', () => {
    expect(buildWithdrawalQuoteRequest(C, { ...input, slippageBps: 300 }).slippageTolerance).toBe(
      300
    );
    expect(() => buildWithdrawalQuoteRequest(C, { ...input, slippageBps: 50 })).toThrow(
      /one of 100, 300/
    );
    expect(resolveWithdrawalSlippage(C, undefined)).toBe(100);
  });

  it('normalises an upper-case bech32 refund address', () => {
    expect(
      buildWithdrawalQuoteRequest(C, {
        ...input,
        refundTo: PLACEHOLDER_REFUND_P2WPKH.toUpperCase(),
      }).refundTo
    ).toBe(PLACEHOLDER_REFUND_P2WPKH);
  });

  it.each([
    [{ amountSats: 9_999 }, /at least 10000/],
    [{ amountSats: 10_000.5 }, /whole number/],
    [{ amountSats: 546 }, /at least/],
    [{ destinationAsset: 'nep141:btc.omft.near' }, /withdraw sBTC to Bitcoin directly/],
    [{ destinationAsset: '' }, /destination asset is required/],
    [{ destinationAsset: ` ${BASE_USDC}` }, /destination asset is required/],
    [{ recipient: '' }, /recipient address/],
    [{ recipient: '0xb5660bca 47faae' }, /recipient address/],
    [{ recipient: 'x'.repeat(201) }, /recipient address/],
    [{ refundTo: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' }, /testnet/],
    [{ refundTo: PLACEHOLDER_EVM_RECIPIENT }, /not a valid mainnet Bitcoin address/],
    [{ refundTo: '' }, /empty/],
  ])('refuses %j', (patch, message) => {
    expect(() => buildWithdrawalQuoteRequest(C, { ...input, ...patch })).toThrow(message);
  });

  it('refuses a broken deadline setting', () => {
    expect(() =>
      buildWithdrawalQuoteRequest({ ...C, withdrawalDeadlineMinutes: 0 }, input)
    ).toThrow(/deadline/);
  });
});

const real = parseWith(oneClickQuoteResponseSchema, REAL_BTC_ORIGIN_QUOTE, 'fixture');
const realSent: OneClickQuoteRequest = { ...real.quoteRequest };

function tampered(patch: (q: OneClickQuoteResponse) => void): OneClickQuoteResponse {
  const copy = structuredClone(real);
  patch(copy);
  return copy;
}

describe('verifyWithdrawalQuote on the real BTC-origin quote', () => {
  it('accepts it and encodes its P2WPKH deposit address', () => {
    const verified = verifyWithdrawalQuote(C, realSent, real);
    expect(verified).toMatchObject({
      depositAddress: 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86',
      amountSats: 10_000,
      amountOut: '6515571',
      minAmountOut: '6450415',
      refundFeeSats: 1_900,
      providerFees: [],
    });
    expect(verified.recipient.kind).toBe('p2wpkh');
    expect(verified.recipient.recipient.version).toBe('04');
    expect(verified.recipient.scriptPubKey).toBe(`0014${verified.recipient.recipient.hashbytes}`);
  });

  it.each<[string, (q: OneClickQuoteResponse) => void, RegExp]>([
    ['no deposit address', q => delete q.quote.depositAddress, /no deposit address/],
    [
      'a testnet deposit address',
      q => (q.quote.depositAddress = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'),
      /testnet/,
    ],
    [
      'a garbage deposit address',
      q => (q.quote.depositAddress = 'deadbeef'),
      /not a valid mainnet/,
    ],
    [
      'a deposit address equal to the refund address',
      q => (q.quote.depositAddress = PLACEHOLDER_REFUND_P2WPKH),
      /is the refund address/,
    ],
    ['a memo', q => (q.quote.depositMemo = '12345'), /deposit memo/],
    ['another amountIn', q => (q.quote.amountIn = '10001'), /"amountIn" is not the requested/],
    ['a decimal amountIn', q => (q.quote.amountIn = '10000.0'), /whole number/],
    ['a higher minAmountIn', q => (q.quote.minAmountIn = '10001'), /would be refunded/],
    [
      'an earlier quote deadline',
      q => (q.quote.deadline = '2026-11-21T16:41:30.000Z'),
      /expires before/,
    ],
    ['a changed recipient', q => (q.quoteRequest.recipient = '0x00'), /"recipient" was changed/],
    [
      'a changed refund address',
      q => (q.quoteRequest.refundTo = 'bc1qudw5dtalvhtfen35wt6tlxug3sm4jscqpm0uz4'),
      /"refundTo" was changed/,
    ],
    ['a changed amount', q => (q.quoteRequest.amount = '20000'), /"amount" was changed/],
    [
      'a changed destination',
      q => (q.quoteRequest.destinationAsset = 'nep141:sol.omft.near'),
      /"destinationAsset" was changed/,
    ],
    [
      'an extra provider fee',
      q => q.quoteRequest.appFees?.push({ recipient: 'x', fee: 60 }),
      /unexpected fees/,
    ],
    [
      'a loose minimum output',
      q => (q.quote.minAmountOut = '6000000'),
      /more than the requested slippage/,
    ],
  ])('refuses %s', (_name, patch, message) => {
    expect(() => verifyWithdrawalQuote(C, realSent, tampered(patch))).toThrow(message);
  });

  it('refuses a request that does not swap from BTC or that is below the minimum', () => {
    const fromUsdc = { ...realSent, originAsset: BASE_USDC };
    const echo = tampered(q => (q.quoteRequest.originAsset = BASE_USDC));
    expect(() => verifyWithdrawalQuote(C, fromUsdc, echo)).toThrow(/must swap from BTC/);
    expect(() =>
      verifyWithdrawalQuote({ ...C, minWithdrawalSats: 20_000 }, realSent, real)
    ).toThrow(/below the 20000 sat minimum/);
  });

  it('refuses a dry quote for a withdrawal but checks its echo', () => {
    const dry = parseWith(oneClickQuoteResponseSchema, REAL_BTC_ORIGIN_DRY_QUOTE, 'fixture');
    const sent = { ...dry.quoteRequest };
    expect(() => verifyWithdrawalQuote(C, sent, dry)).toThrow(/dry quote/);
    expect(checkWithdrawalQuoteEcho(C, sent, dry)).toMatchObject({
      amountSats: 10_000,
      refundFeeSats: 1_900,
    });
  });

  it('accepts a request we built when the quote echoes it', () => {
    const sent = buildWithdrawalQuoteRequest(C, {
      ...input,
      now: new Date('2026-11-14T16:41:38Z'),
    });
    const response = tampered(q => {
      q.quoteRequest = { ...sent };
      q.quote.deadline = '2026-11-19T16:41:38.000Z';
    });
    expect(verifyWithdrawalQuote(C, sent, response).depositAddress).toBe(
      'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86'
    );
  });
});
