import { describe, expect, it } from 'vitest';

import { buildQuoteRequest, MAINNET_CONFIG as config } from '@stxonector/core';

import { type Env, handle } from '../src/index.js';
import { registerDeposit, runNotifier } from '../src/notifier.js';
import { BadRequest, sanitizeQuoteRequest } from '../src/proxy.js';
import { type KV, listWatched } from '../src/store.js';

const D = {
  txid: '5ab7ae554358d3ffdab7cc48db49ff144c5ae4fdd617b4140eac1b1936109bf5',
  address: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
  scriptPubKey: '512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e',
  depositScript:
    '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
  reclaimScript: '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
};
const REAL_TX_HEX =
  '020000000001028ef08f51a0401825af15c238d7b2136d2405abd9bf02e0c1c8a697db2aeb296c0100000000fdffffff1e6ad5fd73606f585163f958b617134804bf611c2a0a7ffb175fded4280b3d1d0a00000000fdffffff02063031010000000022512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2ecc0a0000000000001600142df601e9bf6db95982ff4579f18ca119f02c053102473044022045ec482d45a32b8f761cd402687ce8f9e6cc2d9b8ed5bba2c71a31fc099e77cd02200a644600d7174977f7185d630323b1f0dda4b5b81b2017bc8000639015bdd23501210251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff20247304402204c18dfb4eb01af4da5f1c66e9c0f79696e55803ec7c257cc7e34014af2c2d97a02202df05db704cbd99c121dd18cb908d5c2a5bd63baca86ad09dbd9c0ad82749b9c01210251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff200000000';
const CHAIN: Record<number, { txid: string; hex: string }> = {
  0: { txid: D.txid, hex: REAL_TX_HEX },
  3: {
    txid: '87fb3b6d3d8abe180aedb1034ff6ab6675260c5f350cf6c80cc4618dc330d14a',
    hex: '02000000018ef08f51a0401825af15c238d7b2136d2405abd9bf02e0c1c8a697db2aeb296c010000000151fdffffff04010000000000000016001411111111111111111111111111111111111111110100000000000000160014111111111111111111111111111111111111111101000000000000001600141111111111111111111111111111111111111111ac8a00000000000022512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e00000000',
  },
};
const USDC_BASE = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const REFUND = '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';

function memoryKv(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: key => Promise.resolve(data.get(key) ?? null),
    put(key, value) {
      data.set(key, value);
      return Promise.resolve();
    },
    delete(key) {
      data.delete(key);
      return Promise.resolve();
    },
    list: ({ prefix }) =>
      Promise.resolve({
        keys: [...data.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })),
        list_complete: true,
      }),
  };
}

const NOW = new Date('2026-11-14T12:00:00.000Z');
function goodQuote() {
  return buildQuoteRequest(config, {
    originAsset: USDC_BASE,
    amount: '25000000',
    refundTo: REFUND,
    depositAddress: D.address,
    dry: true,
    now: NOW,
  });
}

function emilyDeposit(status: string) {
  return {
    bitcoinTxid: D.txid,
    bitcoinTxOutputIndex: 0,
    recipient: '0x051a' + 'ab'.repeat(20),
    amount: 35_000,
    status,
    statusMessage: '',
    reclaimScript: D.reclaimScript,
    depositScript: D.depositScript,
  };
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyJson(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== 'string') throw new Error('Expected a string body');
  const parsed: unknown = JSON.parse(body);
  return parsed;
}

describe('sanitizeQuoteRequest', () => {
  it('passes a request built by core unchanged', () => {
    const req = goodQuote();
    expect(sanitizeQuoteRequest(req, config)).toEqual(req);
  });

  it('drops fields it does not know', () => {
    const clean = sanitizeQuoteRequest(
      {
        ...goodQuote(),
        customRecipientMsg: 'x',
        rebates: [{ recipient: 'a', share: 100 }],
        virtualChainRecipient: '0x1',
      },
      config
    );
    expect(clean).toEqual(goodQuote());
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
    expect(() => sanitizeQuoteRequest({ ...goodQuote(), ...change }, config)).toThrow(BadRequest);
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

  it.each([null, 'x', 5, []])('rejects a non-object body: %j', body => {
    expect(() => sanitizeQuoteRequest(body, config)).toThrow(BadRequest);
  });
});

describe('HTTP handler', () => {
  function env(over: Partial<Env> = {}): Env {
    return {
      DEPOSITS: memoryKv(),
      ALLOWED_ORIGINS: 'https://app.example',
      ...over,
    };
  }
  function post(path: string, body: unknown, origin = 'https://app.example') {
    return new Request(`https://api.example${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('forwards a clean quote with the API key, which never reaches the client', async () => {
    let upstream: { url: string; init?: RequestInit } | undefined;
    function fetchFn(url: string, init?: RequestInit): Promise<Response> {
      upstream = { url, init };
      return Promise.resolve(jsonRes({ quote: { amountOut: '35000' } }));
    }
    const res = await handle(
      post('/quote', { ...goodQuote(), extra: 1 }),
      env({ ONECLICK_JWT: 'secret' }),
      fetchFn
    );
    expect(res.status).toBe(200);
    expect(upstream?.url).toBe('https://1click.chaindefuser.com/v0/quote');
    expect(new Headers(upstream?.init?.headers).get('authorization')).toBe('Bearer secret');
    expect(bodyJson(upstream?.init)).toEqual(goodQuote());
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(res.headers.get('authorization')).toBeNull();
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
    expect(big.status).toBe(400);
    const bad = await handle(
      new Request('https://api.example/quote', { method: 'POST', body: '{nope' }),
      env()
    );
    expect(bad.status).toBe(400);
  });

  it('registers a deposit and returns the derived address', async () => {
    const e = env();
    const res = await handle(
      post('/deposits', { depositScript: D.depositScript, reclaimScript: D.reclaimScript }),
      e
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ address: D.address });
    expect(await listWatched(e.DEPOSITS)).toHaveLength(1);
  });

  it('404s unknown routes', async () => {
    expect((await handle(new Request('https://api.example/nope'), env())).status).toBe(404);
  });
});

describe('registerDeposit', () => {
  it('ignores any address the caller sends and derives its own', async () => {
    const kv = memoryKv();
    const { address } = await registerDeposit(kv, {
      depositScript: D.depositScript,
      reclaimScript: D.reclaimScript,
      address: 'bc1pattacker',
    });
    expect(address).toBe(D.address);
    expect([...kv.data.keys()]).toEqual([`dep:${D.address}`]);
  });

  it.each([
    ['missing scripts', {}],
    ['non-hex', { depositScript: 'zz'.repeat(20), reclaimScript: D.reclaimScript }],
    [
      'uppercase hex',
      { depositScript: D.depositScript.toUpperCase(), reclaimScript: D.reclaimScript },
    ],
    [
      'a script that is not a deposit script',
      { depositScript: D.reclaimScript, reclaimScript: D.reclaimScript },
    ],
  ])('rejects %s', async (_name, body) => {
    await expect(registerDeposit(memoryKv(), body)).rejects.toThrow(BadRequest);
  });
});

describe('runNotifier', () => {
  const endpoints = { btcApiUrl: 'https://btc.example', sbtcApiUrl: 'https://emily.example' };
  function payoutTx(vout: number, confirmed = true) {
    const other = { scriptpubkey: '0014' + '11'.repeat(20), value: 1 };
    return {
      txid: CHAIN[vout]?.txid ?? D.txid,
      vout: [
        ...Array.from({ length: vout }, () => other),
        { scriptpubkey: D.scriptPubKey, value: 35_000 },
      ],
      status: { confirmed, block_height: confirmed ? 975_752 : undefined },
    };
  }

  function world(opts: { txs: unknown[]; known?: boolean; notifyStatus?: number; txHex?: string }) {
    const calls: { url: string; body?: unknown }[] = [];
    function respond(url: string, init?: RequestInit): Response {
      calls.push({ url, body: init?.body ? bodyJson(init) : undefined });
      if (url.includes('/address/')) return jsonRes(opts.txs);
      if (url.startsWith('https://btc.example/tx/')) {
        const known = Object.values(CHAIN).find(t => url.endsWith(`/tx/${t.txid}/hex`));
        if (!known) return new Response('Transaction not found', { status: 404 });
        return new Response(opts.txHex ?? known.hex);
      }
      if (init?.method === 'POST')
        return jsonRes(emilyDeposit('pending'), opts.notifyStatus ?? 201);
      return opts.known ? jsonRes(emilyDeposit('pending')) : jsonRes({ message: 'not found' }, 404);
    }
    function fetchFn(url: string, init?: RequestInit): Promise<Response> {
      return new Promise(resolve => resolve(respond(url, init)));
    }
    return { calls, fetchFn };
  }

  async function watching() {
    const kv = memoryKv();
    await registerDeposit(kv, { depositScript: D.depositScript, reclaimScript: D.reclaimScript });
    return kv;
  }

  it('does nothing while no payout has arrived', async () => {
    const kv = await watching();
    const { fetchFn, calls } = world({ txs: [] });
    const report = await runNotifier(kv, endpoints, fetchFn);
    expect(report).toMatchObject({ watched: 1, notified: [], finished: [], errors: [] });
    expect(calls.some(c => c.body)).toBe(false);
    expect(kv.data.size).toBe(1);
  });

  it('notifies the signers with the right output index, wherever the payout sits', async () => {
    const kv = await watching();
    const { fetchFn, calls } = world({ txs: [payoutTx(3)] });
    const report = await runNotifier(kv, endpoints, fetchFn);
    expect(report.notified).toEqual([{ address: D.address, txid: CHAIN[3]?.txid, vout: 3 }]);
    const sent = calls.find(c => c.body);
    expect(sent?.url).toBe('https://emily.example/deposit');
    expect(sent?.body).toEqual({
      bitcoinTxid: CHAIN[3]?.txid,
      bitcoinTxOutputIndex: 3,
      depositScript: D.depositScript,
      reclaimScript: D.reclaimScript,
      transactionHex: CHAIN[3]?.hex,
    });
    expect(kv.data.size).toBe(1);
  });

  it('sends the real raw transaction for the real payout', async () => {
    const kv = await watching();
    const { fetchFn, calls } = world({ txs: [payoutTx(0)] });
    await runNotifier(kv, endpoints, fetchFn);
    expect(calls.find(c => c.body)?.body).toEqual({
      bitcoinTxid: D.txid,
      bitcoinTxOutputIndex: 0,
      depositScript: D.depositScript,
      reclaimScript: D.reclaimScript,
      transactionHex: REAL_TX_HEX,
    });
  });

  it('posts nothing, keeps watching and says why when the raw transaction does not match', async () => {
    const kv = await watching();
    const { fetchFn, calls } = world({ txs: [payoutTx(0)], txHex: CHAIN[3]?.hex });
    const report = await runNotifier(kv, endpoints, fetchFn);
    expect(calls.some(c => c.body)).toBe(false);
    expect(report.notified).toEqual([]);
    expect(report.errors.map(e => e.address)).toEqual([D.address]);
    expect(report.errors[0]?.message).toMatch(
      new RegExp(`^Registering ${D.txid}:0 with the sBTC API failed: .*has txid`)
    );
    expect(kv.data.size).toBe(1);
  });

  it('notifies an unconfirmed payout too, so minting is not delayed', async () => {
    const kv = await watching();
    const { fetchFn } = world({ txs: [payoutTx(0, false)] });
    expect((await runNotifier(kv, endpoints, fetchFn)).notified).toHaveLength(1);
  });

  it('stops watching once the sBTC API has the deposit, without notifying again', async () => {
    const kv = await watching();
    const { fetchFn, calls } = world({ txs: [payoutTx(1)], known: true });
    const report = await runNotifier(kv, endpoints, fetchFn);
    expect(report.finished).toEqual([D.address]);
    expect(report.notified).toEqual([]);
    expect(calls.some(c => c.body)).toBe(false);
    expect(kv.data.size).toBe(0);
  });

  it('keeps watching and reports the error when notification fails', async () => {
    const kv = await watching();
    const { fetchFn } = world({ txs: [payoutTx(0)], notifyStatus: 500 });
    const report = await runNotifier(kv, endpoints, fetchFn);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toMatch(/^Registering .* with the sBTC API failed: HTTP 500/);
    expect(kv.data.size).toBe(1);
  });

  it('drops a record whose stored scripts do not match its address', async () => {
    const kv = memoryKv();
    kv.data.set(
      'dep:bc1pforged',
      JSON.stringify({
        depositScript: D.depositScript,
        reclaimScript: D.reclaimScript,
        createdAt: '',
      })
    );
    const { fetchFn, calls } = world({ txs: [payoutTx(0)] });
    const report = await runNotifier(kv, endpoints, fetchFn);
    expect(report.errors[0]?.message).toMatch(/do not match/);
    expect(calls).toHaveLength(0);
    expect(kv.data.size).toBe(0);
  });

  it('one failing deposit does not block the others', async () => {
    const kv = await watching();
    kv.data.set(
      'dep:bc1pforged',
      JSON.stringify({
        depositScript: D.depositScript,
        reclaimScript: D.reclaimScript,
        createdAt: '',
      })
    );
    const { fetchFn } = world({ txs: [payoutTx(0)] });
    const report = await runNotifier(kv, endpoints, fetchFn);
    expect(report.errors).toHaveLength(1);
    expect(report.notified).toHaveLength(1);
  });
});

describe('listWatched', () => {
  const good = {
    depositScript: D.depositScript,
    reclaimScript: D.reclaimScript,
    createdAt: '2026-11-14T12:00:00.000Z',
  };

  it('returns stored records with any extra fields intact', async () => {
    const kv = memoryKv();
    kv.data.set(`dep:${D.address}`, JSON.stringify({ ...good, note: 'kept' }));
    expect(await listWatched(kv)).toEqual([
      { address: D.address, deposit: { ...good, note: 'kept' } },
    ]);
  });

  it.each([
    ['not JSON', '{oops'],
    [
      'JSON of the wrong shape',
      JSON.stringify({ depositScript: 42, reclaimScript: D.reclaimScript }),
    ],
    ['a JSON string', JSON.stringify('dep')],
  ])('drops a record that is %s and keeps the rest', async (_name, raw) => {
    const kv = memoryKv();
    kv.data.set(`dep:${D.address}`, JSON.stringify(good));
    kv.data.set('dep:bc1pbroken', raw);
    expect(await listWatched(kv)).toEqual([{ address: D.address, deposit: good }]);
    expect([...kv.data.keys()]).toEqual([`dep:${D.address}`]);
  });
});
