import { describe, expect, it } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as C,
  type OneClickQuoteResponse,
  type WatchedWithdrawal,
  decodeWithdrawalRecipient,
  observeWithdrawal,
  oneClickQuoteResponseSchema,
  parseOneClickStatus,
  parseWith,
} from '../../src/index.js';
import { type FakeApiRoutes, fakeWithdrawalApis, routesFor } from '../fake-withdrawal-apis.js';
import { defined, jsonResponse } from '../fixtures.js';
import { REAL_BTC_ORIGIN_QUOTE, REAL_BTC_ORIGIN_STATUS } from '../real-withdrawal-quotes.js';
import { REAL_FAILED_REQUESTS, REAL_TIP_HEIGHT, REAL_WITHDRAWALS } from '../real-withdrawals.js';

const W = defined(REAL_WITHDRAWALS.find(r => r.id === 5131));
const REJECTED = defined(REAL_WITHDRAWALS.find(r => r.id === 5092));
const BEFORE_DEADLINE = new Date('2026-11-14T12:00:00.000Z');
const AFTER_DEADLINE = new Date('2026-11-16T00:00:00.000Z');

function quoteFor(depositAddress: string, amount: number): OneClickQuoteResponse {
  const real = parseWith(oneClickQuoteResponseSchema, REAL_BTC_ORIGIN_QUOTE, 'fixture');
  return {
    ...real,
    quoteRequest: { ...real.quoteRequest, amount: String(amount) },
    quote: {
      ...real.quote,
      amountIn: String(amount),
      minAmountIn: String(amount),
      depositAddress,
    },
  };
}

function watchedFor(w: typeof W): WatchedWithdrawal {
  const address =
    w.address ?? decodeWithdrawalRecipient({ version: w.version, hashbytes: w.hashbytes }).address;
  return {
    stacksTxid: w.requestTxid,
    sender: w.sender,
    amountSats: w.amountSats,
    maxFeeSats: w.maxFeeSats,
    depositAddress: address,
    recipient: { version: w.version, hashbytes: w.hashbytes },
    quoteResponse: quoteFor(address, w.amountSats),
    quoteDeadline: '2026-11-15T12:00:00.000Z',
  };
}

function statusOf(quote: OneClickQuoteResponse, status: string, extra: object = {}): unknown {
  const base = parseOneClickStatus(REAL_BTC_ORIGIN_STATUS);
  return {
    ...base,
    status,
    swapDetails: { ...base.swapDetails, ...extra },
    quoteResponse: {
      timestamp: quote.timestamp,
      signature: quote.signature,
      quoteRequest: quote.quoteRequest,
      quote: quote.quote,
    },
  };
}

async function observe(
  watched: WatchedWithdrawal,
  routes: FakeApiRoutes,
  status: unknown,
  now = BEFORE_DEADLINE
) {
  const api = fakeWithdrawalApis(routes);
  return { ...(await observeWithdrawal(C, watched, status, { fetchFn: api.fetchFn, now })), api };
}

describe('observeWithdrawal on the real accepted withdrawal 5131', () => {
  const watched = watchedFor(W);

  it('verifies the request, the payout and its confirmations, then waits for the swap', async () => {
    const result = await observe(
      watched,
      routesFor(W),
      statusOf(watched.quoteResponse, 'PENDING_DEPOSIT')
    );
    expect(result.progress.stage).toBe('payout-confirmed');
    expect(result.facts).toMatchObject({
      requestId: 5131,
      feeSats: 1_455,
      payoutTxid: W.payoutTxid,
      payoutVout: 2,
      payoutConfirmations: REAL_TIP_HEIGHT - 975_459 + 1,
      payoutVerified: true,
      swapStatus: 'PENDING_DEPOSIT',
      swapEcho: 'matched',
      deadlinePassed: false,
      mismatches: [],
      errors: [],
    });
  });

  it('reports done only with the swap provider success and its destination hashes', async () => {
    const hash = `0x${'ab'.repeat(32)}`;
    const status = statusOf(watched.quoteResponse, 'SUCCESS', {
      amountOut: '6515571',
      destinationChainTxHashes: [{ hash, explorerUrl: 'https://example.invalid' }],
    });
    const result = await observe(watched, routesFor(W), status);
    expect(result.progress).toMatchObject({ stage: 'done', terminal: true });
    expect(result.facts.destinationTxHashes).toEqual(['ab'.repeat(32)]);
  });

  it('reports a refund with its details', async () => {
    const status = statusOf(watched.quoteResponse, 'REFUNDED', {
      refundedAmount: '1852485',
      refundReason: 'Slippage exceeded',
    });
    const result = await observe(watched, routesFor(W), status);
    expect(result.progress.stage).toBe('refunded');
    expect(result.facts.refund).toEqual({
      refunded: true,
      refundedAmount: '1852485',
      refundReason: 'Slippage exceeded',
      refundFee: '1900',
    });
  });

  it('warns once the deadline passed and the swap has not reported the BTC', async () => {
    const result = await observe(
      watched,
      routesFor(W),
      statusOf(watched.quoteResponse, 'PENDING_DEPOSIT'),
      AFTER_DEADLINE
    );
    expect(result.progress).toMatchObject({
      stage: 'deadline-passed',
      warning: true,
      terminal: false,
    });
    expect(result.facts.deadlinePassed).toBe(true);
  });

  it('finds the payout by scanning the sweep when Emily is down', async () => {
    const routes = routesFor(W);
    const result = await observe(
      watched,
      { ...routes, overrides: { [`${C.sbtcApiUrl}/withdrawal/5131`]: jsonResponse({}, 503) } },
      null
    );
    expect(result.progress.stage).toBe('payout-confirmed');
    expect(result.facts.payoutVout).toBe(2);
    expect(result.facts.feeSats).toBeNull();
    expect(result.facts.errors.join(' ')).toMatch(/Payout lookup: HTTP 503/);
  });

  it('keeps waiting when the Bitcoin API is down', async () => {
    const routes = routesFor(W);
    const result = await observe(
      watched,
      {
        ...routes,
        overrides: { [`${C.btcApiUrl}/tx/${defined(W.payoutTxid)}`]: jsonResponse({}, 500) },
      },
      null
    );
    expect(result.progress.stage).toBe('payout-broadcast');
    expect(result.facts.errors.join(' ')).toMatch(/Bitcoin: HTTP 500/);
  });

  it('keeps going when the Stacks API is down, and trusts a swap success', async () => {
    const routes: FakeApiRoutes = {
      overrides: {
        [`${C.stxApiUrl}/extended/v1/tx/0x${W.requestTxid}?event_limit=50`]: jsonResponse({}, 500),
      },
    };
    const waiting = await observe(watched, routes, null);
    expect(waiting.progress.stage).toBe('awaiting-stacks-tx');
    expect(waiting.facts.errors.join(' ')).toMatch(/Stacks: HTTP 500/);
    const done = await observe(watched, routes, statusOf(watched.quoteResponse, 'SUCCESS'));
    expect(done.progress.stage).toBe('done');
  });

  it('records an unreadable swap status as an error, not a stage', async () => {
    const result = await observe(watched, routesFor(W), { status: 'WHATEVER' });
    expect(result.facts.swapStatus).toBeNull();
    expect(result.facts.errors.join(' ')).toMatch(/Swap status/);
    expect(result.progress.stage).toBe('payout-confirmed');
  });

  it('reports a status that echoes another quote as a mismatch', async () => {
    const other = quoteFor('bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86', 10_000);
    const result = await observe(watched, routesFor(W), statusOf(other, 'SUCCESS'));
    expect(result.progress.stage).toBe('mismatch');
    expect(result.facts.swapEcho).toBe('mismatch');
  });

  it('treats a status without an echo as unverified, not a mismatch', async () => {
    const plain = parseOneClickStatus(REAL_BTC_ORIGIN_STATUS);
    const result = await observe(watched, routesFor(W), {
      status: 'PROCESSING',
      updatedAt: plain.updatedAt,
      swapDetails: plain.swapDetails,
    });
    expect(result.facts.swapEcho).toBe('missing');
    expect(result.progress.stage).toBe('swapping');
  });

  it('reports a mismatch when the receipt amount differs from the chain', async () => {
    const result = await observe({ ...watched, amountSats: W.amountSats + 1 }, routesFor(W), null);
    expect(result.progress.stage).toBe('mismatch');
    expect(result.facts.requestId).toBe(5131);
    expect(result.payout).toBeNull();
  });

  it('reports a mismatch when the receipt pays another address than its quote', async () => {
    const result = await observe(
      {
        ...watched,
        quoteResponse: quoteFor('bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86', W.amountSats),
      },
      routesFor(W),
      null
    );
    expect(result.progress.stage).toBe('mismatch');
    expect(result.facts.mismatches.join(' ')).toMatch(/different address than its saved quote/);
  });

  it('reports a mismatch when the receipt recipient is not the deposit address', async () => {
    const result = await observe(
      { ...watched, recipient: { version: '04', hashbytes: W.hashbytes } },
      routesFor(W),
      null
    );
    expect(result.progress.stage).toBe('mismatch');
  });

  it('reports a mismatch when the payout output carries another amount', async () => {
    const routes = routesFor(W);
    const sweep = defined(W.btcTxHex);
    const amountLe = W.amountSats.toString(16).padStart(16, '0').match(/../g)?.reverse().join('');
    const bumped = (W.amountSats + 1)
      .toString(16)
      .padStart(16, '0')
      .match(/../g)
      ?.reverse()
      .join('');
    const forged = sweep.replace(defined(amountLe), defined(bumped));
    expect(forged).not.toBe(sweep);
    const result = await observe(
      watched,
      { ...routes, btcHexes: { [defined(W.payoutTxid)]: forged } },
      null
    );
    expect(result.progress.stage).toBe('mismatch');
    expect(result.facts.mismatches.join(' ')).toMatch(/different transaction|could not be parsed/);
  });
});

describe('observeWithdrawal on other real outcomes', () => {
  it('reports the real rejection', async () => {
    const watched = watchedFor(REJECTED);
    const result = await observe(watched, routesFor(REJECTED), null);
    expect(result.progress).toMatchObject({ stage: 'rejected', terminal: true });
    expect(result.facts.requestId).toBe(5092);
  });

  it('reports the real failed request', async () => {
    const f = defined(REAL_FAILED_REQUESTS[0]);
    const watched = { ...watchedFor(W), stacksTxid: f.txid };
    const result = await observe(watched, { stacksTxs: { [f.txid]: f.requestTx } }, null);
    expect(result.progress).toMatchObject({ stage: 'request-failed', terminal: true });
    expect(result.facts.txFailure?.code).toBe('post-condition');
  });

  it('waits for a transaction the Stacks API does not know yet', async () => {
    const result = await observe(watchedFor(W), {}, null);
    expect(result.progress.stage).toBe('awaiting-stacks-tx');
    expect(result.facts.errors).toEqual([]);
  });
});
