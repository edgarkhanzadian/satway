import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  buildQuoteRequest,
  MAINNET_CONFIG as config,
} from '@satway/core';

import {
  AlreadyRegistered,
  BadRequest,
  DEADLINE_MARGIN_MINUTES,
  registerDeposit,
  sanitizeQuoteRequest,
} from '../src/http/index.js';
import { handle } from '../src/index.js';
import {
  CRON_PERIOD_MS,
  RUN_TIME_BUDGET_MS,
  WORKER_REQUEST_TIMEOUT_MS,
  runNotifier,
} from '../src/notifier/index.js';
import { listWatchedAddresses, loadWatched } from '../src/store/index.js';
import {
  CHAIN,
  D,
  NOW,
  REAL_TX_HEX,
  bodyJson,
  endpoints,
  goodBody,
  handleOptions,
  indexedBody,
  indexedDeposit,
  jsonRes,
  memoryKv,
  outpointsPosted,
  payoutTx,
  postJson,
  record,
  registerDeps,
  testEnv,
  watchKeys,
  watching,
  world,
} from './support.js';

const USDC_BASE = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const REFUND = '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';

function goodQuote(now: Date = new Date()) {
  return buildQuoteRequest(config, {
    originAsset: USDC_BASE,
    amount: '25000000',
    refundTo: REFUND,
    depositAddress: D.address,
    dry: true,
    now,
  });
}

const run = { now: NOW };

describe('sanitizeQuoteRequest', () => {
  it('passes a request built by core unchanged', () => {
    const req = goodQuote();
    expect(sanitizeQuoteRequest(req, config)).toEqual(req);
    expect(sanitizeQuoteRequest(goodQuote(NOW), config, NOW)).toEqual(goodQuote(NOW));
  });

  it('drops fields it does not know', () => {
    const clean = sanitizeQuoteRequest(
      {
        ...goodQuote(NOW),
        customRecipientMsg: 'x',
        rebates: [{ recipient: 'a', share: 100 }],
        virtualChainRecipient: '0x1',
      },
      config,
      NOW
    );
    expect(clean).toEqual(goodQuote(NOW));
  });

  it('accepts the deadline the web app asks for, and a client clock up to the margin ahead', () => {
    expect(sanitizeQuoteRequest(goodQuote(NOW), config, NOW).deadline).toBe(
      '2026-11-14T14:00:00.000Z'
    );
    const fast = new Date(NOW.getTime() + DEADLINE_MARGIN_MINUTES * 60_000);
    expect(() => sanitizeQuoteRequest(goodQuote(fast), config, NOW)).not.toThrow();
    const slow = new Date(NOW.getTime() - 119 * 60_000);
    expect(() => sanitizeQuoteRequest(goodQuote(slow), config, NOW)).not.toThrow();
  });

  it.each([
    ['in the past', '2026-11-14T11:59:59.000Z'],
    ['exactly now', '2026-11-14T12:00:00.000Z'],
    ['past the window', '2026-11-14T15:00:00.001Z'],
    ['a week away', '2026-11-21T12:00:00.000Z'],
  ])('rejects a deadline %s', (_name, deadline) => {
    expect(() => sanitizeQuoteRequest({ ...goodQuote(NOW), deadline }, config, NOW)).toThrow(
      /deadline/
    );
  });

  it('accepts the far edge of the deadline window', () => {
    const deadline = '2026-11-14T15:00:00.000Z';
    expect(sanitizeQuoteRequest({ ...goodQuote(NOW), deadline }, config, NOW).deadline).toBe(
      deadline
    );
  });

  it.each([
    ['fractional slippage', { slippageTolerance: 100.5 }],
    ['negative slippage', { slippageTolerance: -1 }],
    ['slippage as text', { slippageTolerance: '100' }],
  ])('rejects %s', (_name, change) => {
    expect(() => sanitizeQuoteRequest({ ...goodQuote(NOW), ...change }, config, NOW)).toThrow(
      /slippageTolerance/
    );
  });

  it.each([
    ['a non-BTC destination', { destinationAsset: 'nep141:zec.omft.near' }],
    ['a non-taproot recipient', { recipient: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys' }],
    ['an Intents recipient', { recipientType: 'INTENTS' }],
    ['an Intents refund', { refundType: 'INTENTS' }],
    ['another swap type', { swapType: 'ANY_INPUT' }],
    ['a caller-supplied fee', { appFees: [{ recipient: 'thief.near', fee: 100 }] }],
    ['a bad amount', { amount: '1e9' }],
    ['huge slippage', { slippageTolerance: 5000 }],
    ['a missing refund address', { refundTo: '' }],
    ['a bad deadline', { deadline: 'tomorrow' }],
    ['BTC as origin', { originAsset: config.btcAssetId }],
  ])('rejects %s', (_name, change) => {
    expect(() => sanitizeQuoteRequest({ ...goodQuote(NOW), ...change }, config, NOW)).toThrow(
      BadRequest
    );
  });

  it('requires exactly the configured fee when one is set', () => {
    const withFee = { ...config, appFeeBps: 25, appFeeRecipient: 'fees.near' };
    const req = buildQuoteRequest(withFee, {
      originAsset: USDC_BASE,
      amount: '25000000',
      refundTo: REFUND,
      depositAddress: D.address,
      dry: true,
    });
    expect(sanitizeQuoteRequest(req, withFee).appFees).toEqual([
      { recipient: 'fees.near', fee: 25 },
    ]);
    expect(() => sanitizeQuoteRequest({ ...req, appFees: [] }, withFee)).toThrow(BadRequest);
    expect(() =>
      sanitizeQuoteRequest({ ...req, appFees: [{ recipient: 'fees.near', fee: 99 }] }, withFee)
    ).toThrow(BadRequest);
  });

  it('charges no fee, and accepts none, when a fee is set without a recipient', () => {
    const noRecipient = { ...config, appFeeBps: 25, appFeeRecipient: '' };
    expect(sanitizeQuoteRequest(goodQuote(NOW), noRecipient, NOW).appFees).toBeUndefined();
    expect(() =>
      sanitizeQuoteRequest(
        { ...goodQuote(NOW), appFees: [{ recipient: '', fee: 25 }] },
        noRecipient,
        NOW
      )
    ).toThrow(BadRequest);
  });

  it.each([null, 'x', 5, []])('rejects a non-object body: %j', body => {
    expect(() => sanitizeQuoteRequest(body, config)).toThrow(BadRequest);
  });
});

describe('HTTP handler', () => {
  const env = testEnv;
  const post = postJson;

  it('forwards a clean quote with the API key, which never reaches the client', async () => {
    const quote = goodQuote();
    let upstream: { url: string; init?: RequestInit } | undefined;
    function fetchFn(url: string, init?: RequestInit): Promise<Response> {
      upstream = { url, init };
      return Promise.resolve(jsonRes({ quote: { amountOut: '35000' } }));
    }
    const res = await handle(
      post('/quote', { ...quote, extra: 1 }),
      env({ ONECLICK_JWT: 'secret' }),
      fetchFn
    );
    expect(res.status).toBe(200);
    expect(upstream?.url).toBe('https://1click.chaindefuser.com/v0/quote');
    expect(new Headers(upstream?.init?.headers).get('authorization')).toBe('Bearer secret');
    expect(bodyJson(upstream?.init)).toEqual(quote);
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(res.headers.get('authorization')).toBeNull();
  });

  it('answers 504 when 1Click does not answer a status read in time', async () => {
    vi.useFakeTimers();
    try {
      const pending = handle(
        new Request('https://api.example/status?depositAddress=0xswap', {
          headers: { origin: 'https://app.example' },
        }),
        env(),
        () => new Promise<Response>(() => undefined)
      );
      await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
      const res = await pending;
      expect(res.status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a tampered quote without calling upstream', async () => {
    let called = false;
    function fetchFn(): Promise<Response> {
      called = true;
      return Promise.resolve(jsonRes({}));
    }
    const res = await handle(
      post('/quote', { ...goodQuote(), appFees: [{ recipient: 'thief.near', fee: 50 }] }),
      env(),
      fetchFn
    );
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it('relays upstream errors with their status', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(jsonRes({ message: 'refundTo is not valid' }, 400));
    }
    const res = await handle(post('/quote', goodQuote()), env(), fetchFn);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: 'refundTo is not valid' });
  });

  it('only grants CORS to listed origins', async () => {
    const ok = await handle(
      new Request('https://api.example/health', { headers: { origin: 'https://app.example' } }),
      env()
    );
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const bad = await handle(
      new Request('https://api.example/health', { headers: { origin: 'https://evil.example' } }),
      env()
    );
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects oversized and malformed bodies', async () => {
    const big = await handle(post('/deposits', { depositScript: 'a'.repeat(5000) }), env());
    expect(big.status).toBe(413);
    const bad = await handle(
      new Request('https://api.example/quote', { method: 'POST', body: '{nope' }),
      env()
    );
    expect(bad.status).toBe(400);
  });

  it('registers a deposit and returns the derived address and the swap deadline', async () => {
    const e = env();
    const w = world({ btc: config.btcApiUrl });
    const res = await handle(post('/deposits', goodBody()), e, w.fetchFn, handleOptions());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ address: D.address, deadline: '2026-11-14T14:00:00.000Z' });
    expect((await listWatchedAddresses(e.DEPOSITS)).addresses).toEqual([D.address]);
  });

  it('404s unknown routes', async () => {
    expect((await handle(new Request('https://api.example/nope'), env())).status).toBe(404);
  });
});

describe('registerDeposit', () => {
  function deps() {
    return registerDeps(world({}));
  }

  it('ignores any address the caller sends and derives its own', async () => {
    const kv = memoryKv();
    const { address } = await registerDeposit(
      kv,
      { ...goodBody(), address: 'bc1pattacker' },
      deps()
    );
    expect(address).toBe(D.address);
    expect([...kv.data.keys()].filter(k => k.startsWith('dep:'))).toEqual([`dep:${D.address}`]);
  });

  it.each([
    ['missing scripts', {}],
    [
      'non-hex',
      { depositScript: 'zz'.repeat(20), reclaimScript: D.reclaimScript, swapDepositAddress: '0xs' },
    ],
    [
      'uppercase hex',
      {
        depositScript: D.depositScript.toUpperCase(),
        reclaimScript: D.reclaimScript,
        swapDepositAddress: '0xs',
      },
    ],
    [
      'a script that is not a deposit script',
      { depositScript: D.reclaimScript, reclaimScript: D.reclaimScript, swapDepositAddress: '0xs' },
    ],
    [
      'a swap address that is not a short string',
      { depositScript: D.depositScript, reclaimScript: D.reclaimScript, swapDepositAddress: 5 },
    ],
  ])('rejects %s', async (_name, body) => {
    await expect(registerDeposit(memoryKv(), body, deps())).rejects.toThrow(BadRequest);
  });

  it('writes one record per deposit address, once, with no snapshot of the address', async () => {
    const w = world({});
    const kv = await watching(w, memoryKv(), '0xswapA');
    expect(kv.writes().filter(k => k.startsWith('dep:'))).toEqual([`dep:${D.address}`]);
    expect(record(kv)).toEqual({
      depositScript: D.depositScript,
      reclaimScript: D.reclaimScript,
      createdAt: NOW.toISOString(),
      swapDepositAddress: '0xswapA',
      deadline: '2026-11-14T14:00:00.000Z',
      registered: [],
    });
    expect(w.calls.some(c => c.url.includes('/address/'))).toBe(false);
    expect(kv.ttls.get(`dep:${D.address}`)).toBe(14 * 24 * 60 * 60);
  });

  it('is idempotent: a second registration of the address is refused as already registered', async () => {
    const w = world({});
    const kv = await watching(w, memoryKv(), '0xswapA');
    const stored = kv.data.get(`dep:${D.address}`);
    await expect(watching(w, kv, '0xswapA')).rejects.toThrow(AlreadyRegistered);
    await expect(watching(w, kv, '0xswapB')).rejects.toThrow(AlreadyRegistered);
    expect(kv.data.get(`dep:${D.address}`)).toBe(stored);
  });

  it('keeps two deposits from one wallet apart, one record each', async () => {
    const w = world({});
    const kv = memoryKv();
    for (const n of [0, 7]) {
      await registerDeposit(kv, indexedBody(n), registerDeps(w));
    }
    expect(watchKeys(kv).sort()).toEqual(
      [`dep:${indexedDeposit(0).address}`, `dep:${indexedDeposit(7).address}`].sort()
    );
  });

  it('a registration while the notifier is mid-run cannot lose either deposit', async () => {
    const w = world({ txs: [payoutTx(0)] });
    const kv = await watching(w);
    const gate = { open: () => undefined };
    const held = new Promise<undefined>(resolve => {
      gate.open = () => {
        resolve(undefined);
        return undefined;
      };
    });
    let paused = false;
    async function slowFetch(url: string, init?: RequestInit): Promise<Response> {
      if (!paused && url.endsWith('/utxo')) {
        paused = true;
        await held;
      }
      return w.fetchFn(url, init);
    }
    const running = runNotifier(kv, endpoints, slowFetch, run);
    await vi.waitFor(() => expect(paused).toBe(true));
    const other = indexedBody(3);
    await registerDeposit(kv, other, registerDeps(w));
    await expect(registerDeposit(kv, goodBody('0xswapLate'), registerDeps(w))).rejects.toThrow(
      AlreadyRegistered
    );
    gate.open();
    const report = await running;
    expect(report.finished).toEqual([D.address]);
    expect(watchKeys(kv)).toEqual([`dep:${indexedDeposit(3).address}`]);
    expect(JSON.parse(kv.data.get(`dep:${indexedDeposit(3).address}`) ?? '{}')).toMatchObject({
      swapDepositAddress: other.swapDepositAddress,
      registered: [],
    });
  });
});

describe('runNotifier', () => {
  it('does nothing while no payout has arrived', async () => {
    const w = world({});
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(report).toMatchObject({ watched: 1, notified: [], finished: [], errors: [] });
    expect(w.posts()).toEqual([]);
    expect(watchKeys(kv).length).toBe(1);
  });

  it('notifies the signers with the right output index, wherever the payout sits', async () => {
    const w = world({ txs: [payoutTx(3)] });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(report.notified).toEqual([{ address: D.address, txid: CHAIN[3]?.txid, vout: 3 }]);
    const sent = w.calls.find(c => c.method === 'POST' && c.url.endsWith('/deposit'));
    expect(sent?.url).toBe('https://emily.example/deposit');
    expect(sent?.body).toEqual({
      bitcoinTxid: CHAIN[3]?.txid,
      bitcoinTxOutputIndex: 3,
      depositScript: D.depositScript,
      reclaimScript: D.reclaimScript,
      transactionHex: CHAIN[3]?.hex,
    });
    expect(report.finished).toEqual([D.address]);
  });

  it('sends the real raw transaction for the real payout', async () => {
    const w = world({ txs: [payoutTx(0)] });
    const kv = await watching(w);
    await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(w.posts()).toEqual([
      {
        bitcoinTxid: D.txid,
        bitcoinTxOutputIndex: 0,
        depositScript: D.depositScript,
        reclaimScript: D.reclaimScript,
        transactionHex: REAL_TX_HEX,
      },
    ]);
  });

  it('posts nothing, keeps watching and says why when the raw transaction does not match', async () => {
    const w = world({ txs: [payoutTx(0)], txHex: CHAIN[3]?.hex });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(w.posts()).toEqual([]);
    expect(report.notified).toEqual([]);
    expect(report.errors).toMatchObject([{ address: D.address, outpoint: `${D.txid}:0` }]);
    expect(report.errors[0]?.message).toMatch(
      new RegExp(`^Registering ${D.txid}:0 with the sBTC API failed: .*has txid`)
    );
    expect(watchKeys(kv).length).toBe(1);
  });

  it('notifies an unconfirmed payout too, so minting is not delayed', async () => {
    const w = world({ txs: [payoutTx(0, { confirmed: false })] });
    const kv = await watching(w);
    expect((await runNotifier(kv, endpoints, w.fetchFn, run)).notified).toHaveLength(1);
  });

  it('stops watching once the sBTC API has the deposit, without notifying again', async () => {
    const w = world({ txs: [payoutTx(3)], known: true });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(report.finished).toEqual([D.address]);
    expect(report.notified).toEqual([]);
    expect(w.posts()).toEqual([]);
    expect(watchKeys(kv).length).toBe(0);
  });

  it('keeps watching and reports the error when notification fails', async () => {
    const w = world({ txs: [payoutTx(0)], notifyStatus: 500 });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toMatch(/^Registering .* with the sBTC API failed: HTTP 500/);
    expect(watchKeys(kv).length).toBe(1);
  });

  it('registers only the real payout when a 546-sat output arrives after it, then finishes', async () => {
    const dust = payoutTx(0, { txid: 'dd'.repeat(32), value: 546, confirmed: false });
    const w = world({ txs: [dust, payoutTx(0)] });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(outpointsPosted(w)).toEqual([`${D.txid}:0`]);
    expect(report.finished).toEqual([D.address]);
  });

  it('dust before the payout neither ends the watch nor is registered; the payout later does', async () => {
    const dust = payoutTx(0, { txid: 'dd'.repeat(32), value: 546, confirmed: false });
    const w = world({ txs: [dust] });
    const kv = await watching(w);
    const first = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(first).toMatchObject({ notified: [], finished: [], errors: [] });
    expect(watchKeys(kv).length).toBe(1);
    w.arrive(payoutTx(0));
    const second = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(outpointsPosted(w)).toEqual([`${D.txid}:0`]);
    expect(second.finished).toEqual([D.address]);
    expect(watchKeys(kv).length).toBe(0);
  });

  it('ends the watch once a payout is registered, even one the page registered first', async () => {
    const w = world({ txs: [payoutTx(0)], knownOutpoints: [`${D.txid}:0`] });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(report).toMatchObject({ finished: [D.address], notified: [], errors: [] });
    expect(w.posts()).toEqual([]);
  });

  it('registers every eligible payment at the address in one run, then ends the watch', async () => {
    const w = world({ txs: [payoutTx(0), payoutTx(3)] });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(outpointsPosted(w).sort()).toEqual([`${D.txid}:0`, `${CHAIN[3]?.txid}:3`].sort());
    expect(report.finished).toEqual([D.address]);
  });

  it('a failure on one output does not stop the next, and names the outpoint', async () => {
    const w = world({
      txs: [payoutTx(0, { value: 60_000 }), payoutTx(3)],
      failPostFor: `${D.txid}:0`,
    });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(outpointsPosted(w)).toEqual([`${D.txid}:0`, `${CHAIN[3]?.txid}:3`]);
    expect(report.notified).toEqual([{ address: D.address, txid: CHAIN[3]?.txid, vout: 3 }]);
    expect(report.errors).toMatchObject([{ address: D.address, outpoint: `${D.txid}:0` }]);
  });

  it('keeps watching while an eligible output failed to register, and retries it next run', async () => {
    const opts = {
      txs: [payoutTx(0, { value: 60_000 }), payoutTx(3)],
      failPostFor: `${D.txid}:0`,
    };
    const failing = world(opts);
    const kv = await watching(failing);
    const first = await runNotifier(kv, endpoints, failing.fetchFn, run);
    expect(first.notified).toEqual([{ address: D.address, txid: CHAIN[3]?.txid, vout: 3 }]);
    expect(first.finished).toEqual([]);
    expect(watchKeys(kv).length).toBe(1);
    expect(record(kv)).toMatchObject({ registered: [{ outpoint: `${CHAIN[3]?.txid}:3` }] });

    const healthy = world({ txs: opts.txs, knownOutpoints: [`${CHAIN[3]?.txid}:3`] });
    healthy.arrive();
    const second = await runNotifier(kv, endpoints, healthy.fetchFn, run);
    expect(outpointsPosted(healthy)).toEqual([`${D.txid}:0`]);
    expect(second.finished).toEqual([D.address]);
    expect(watchKeys(kv).length).toBe(0);
  });

  it('keeps watching while an eligible output is deferred by the budget', async () => {
    const w = world({ txs: [payoutTx(0, { value: 60_000 }), payoutTx(3)] });
    const kv = await watching(w);
    w.arrive();
    const report = await runNotifier(kv, endpoints, w.fetchFn, { ...run, budget: 12 });
    expect(report.deferred).toEqual([D.address]);
    expect(report.notified).toHaveLength(1);
    expect(report.finished).toEqual([]);
    expect(watchKeys(kv).length).toBe(1);
  });

  it('times a hanging request out well inside the cron period and keeps the watch', async () => {
    vi.useFakeTimers();
    try {
      const w = world({ txs: [payoutTx(0)] });
      const kv = await watching(w);
      w.arrive();
      function hangingUtxo(url: string, init?: RequestInit): Promise<Response> {
        if (url.endsWith('/utxo')) return new Promise(() => undefined);
        return w.fetchFn(url, init);
      }
      const pending = runNotifier(kv, endpoints, hangingUtxo, run);
      await vi.advanceTimersByTimeAsync(WORKER_REQUEST_TIMEOUT_MS);
      const report = await pending;
      expect(report.errors).toMatchObject([{ address: D.address }]);
      expect(report.errors[0]?.message).toMatch(/within 10 seconds/);
      expect(watchKeys(kv).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops making requests once the run is out of time', async () => {
    const w = world({ txs: [payoutTx(0)] });
    const kv = await watching(w);
    w.arrive();
    const before = w.calls.length;
    const report = await runNotifier(kv, endpoints, w.fetchFn, {
      ...run,
      clock: { now: () => 1_000, deadline: 1_000 },
    });
    expect(w.calls.length).toBe(before);
    expect(report.errors[0]?.message).toMatch(/out of time/);
    expect(watchKeys(kv).length).toBe(1);
    expect(RUN_TIME_BUDGET_MS + WORKER_REQUEST_TIMEOUT_MS).toBeLessThan(CRON_PERIOD_MS);
  });

  it('registers nothing and keeps watching when the sBTC minimum cannot be read', async () => {
    const w = world({ txs: [payoutTx(0)], limitsDown: true });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(w.posts()).toEqual([]);
    expect(report.errors[0]?.message).toMatch(/minimum/);
    expect(watchKeys(kv).length).toBe(1);
  });

  it('reports an address with too many unspent outputs instead of treating it as empty', async () => {
    const w = world({ tooManyUtxos: true });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(report.errors[0]?.message).toMatch(/too many/);
    expect(watchKeys(kv).length).toBe(1);
  });

  it('drops a record of another shape as unreadable', async () => {
    const kv = memoryKv();
    kv.data.set(
      `dep:${D.address}`,
      JSON.stringify({
        depositScript: D.depositScript,
        reclaimScript: D.reclaimScript,
        createdAt: NOW.toISOString(),
        registrations: [],
      })
    );
    const w = world({ txs: [payoutTx(0)] });
    w.arrive();
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(report.notified).toEqual([]);
    expect(watchKeys(kv)).toEqual([]);
  });

  it('drops a record whose stored scripts do not match its address', async () => {
    const kv = memoryKv();
    kv.data.set(
      'dep:bc1pforged',
      JSON.stringify({
        depositScript: D.depositScript,
        reclaimScript: D.reclaimScript,
        createdAt: '',
        swapDepositAddress: '0xforged',
        deadline: '',
        registered: [],
      })
    );
    const w = world({ txs: [payoutTx(0)] });
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(report.errors[0]?.message).toMatch(/do not match/);
    expect(w.calls).toHaveLength(0);
    expect(watchKeys(kv).length).toBe(0);
  });

  it('one failing deposit does not block the others', async () => {
    const w = world({ txs: [payoutTx(0)] });
    const kv = await watching(w);
    kv.data.set(
      'dep:bc1pforged',
      JSON.stringify({
        depositScript: D.depositScript,
        reclaimScript: D.reclaimScript,
        createdAt: '',
        swapDepositAddress: '0xforged',
        deadline: '',
        registered: [],
      })
    );
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(report.errors).toHaveLength(1);
    expect(report.notified).toHaveLength(1);
  });

  it('deletes a record it cannot read and still handles the others', async () => {
    const w = world({ txs: [payoutTx(0)] });
    const kv = await watching(w);
    kv.data.set('dep:bc1pbroken', '{oops');
    const report = await runNotifier(kv, endpoints, w.fetchFn, run);
    expect(kv.data.has('dep:bc1pbroken')).toBe(false);
    expect(report.notified).toHaveLength(1);
  });
});

describe('listWatchedAddresses and loadWatched', () => {
  const good = {
    depositScript: D.depositScript,
    reclaimScript: D.reclaimScript,
    createdAt: '2026-11-14T12:00:00.000Z',
    swapDepositAddress: '0xswap0',
    deadline: '2026-11-14T14:00:00.000Z',
    registered: [],
  };

  it('returns stored records with any extra fields intact', async () => {
    const kv = memoryKv();
    kv.data.set(`dep:${D.address}`, JSON.stringify({ ...good, note: 'kept' }));
    expect((await listWatchedAddresses(kv)).addresses).toEqual([D.address]);
    expect(await loadWatched(kv, D.address)).toEqual({
      deposit: { ...good, note: 'kept' },
      broken: false,
    });
  });

  it.each([
    ['not JSON', '{oops'],
    [
      'JSON of the wrong shape',
      JSON.stringify({ depositScript: 42, reclaimScript: D.reclaimScript }),
    ],
    ['a JSON string', JSON.stringify('dep')],
  ])('marks a record that is %s as broken and keeps the rest readable', async (_name, raw) => {
    const kv = memoryKv();
    kv.data.set(`dep:${D.address}`, JSON.stringify(good));
    kv.data.set('dep:bc1pbroken', raw);
    expect((await listWatchedAddresses(kv)).addresses).toEqual(['bc1pbroken', D.address].sort());
    expect(await loadWatched(kv, 'bc1pbroken')).toEqual({ deposit: null, broken: true });
    expect(await loadWatched(kv, D.address)).toEqual({ deposit: good, broken: false });
    expect(await loadWatched(kv, 'bc1pmissing')).toEqual({ deposit: null, broken: false });
  });
});
