import { describe, expect, it } from 'vitest';

import {
  type MintStatus,
  buildIndexedDepositAddress,
  MAINNET_CONFIG as config,
  observeDeposit,
} from '../../src/index.js';

const dep = buildIndexedDepositAddress(
  {
    stacksAddress: 'SP1Q6W6VADA7V12SEVH6VNDNN4N7RX1PQ949EQPQ',
    reclaimPublicKey: '51b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2',
    signersPublicKey: 'd99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69',
    depositIndex: 3,
  },
  config
);

const ctx = {
  depositAddress: dep.address,
  depositScriptPubKey: dep.scriptPubKey,
  depositScript: dep.depositScript,
  reclaimScript: dep.reclaimScript,
  reclaimLockBlocks: 950,
};

const TIP = 900_000;

function txid(n: number): string {
  return n.toString(16).padStart(64, '0');
}

function outpoint(n: number): string {
  return `${txid(n)}:0`;
}

interface Payment {
  n: number;
  confirmed: boolean;
  spent: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function chainWorld(
  payments: readonly Payment[],
  minted: ReadonlySet<number>,
  outspend: { spent: boolean; txid?: string } = { spent: false }
) {
  const reads: number[] = [];
  const pending = new Set<number>();
  function tx(p: Payment) {
    return {
      txid: txid(p.n),
      vout: [{ scriptpubkey: dep.scriptPubKey, value: 20_000 + p.n }],
      status: p.confirmed
        ? { confirmed: true, block_height: TIP - 100 + p.n, block_time: 1 }
        : { confirmed: false },
    };
  }
  const address = `${config.btcApiUrl}/address/${dep.address}`;
  function route(url: string): Response {
    if (url.endsWith('/limits'))
      return json({ pegCap: null, perDepositMinimum: 10_000, perDepositCap: null });
    if (url.endsWith('/blocks/tip/height')) return new Response(String(TIP));
    if (url === `${address}/txs/mempool`) return json(payments.filter(p => !p.confirmed).map(tx));
    if (url.startsWith(`${address}/txs/chain`))
      return json(url === `${address}/txs/chain` ? payments.filter(p => p.confirmed).map(tx) : []);
    if (url === `${address}/utxo`)
      return json(
        payments
          .filter(p => !p.spent)
          .map(p => ({ txid: txid(p.n), vout: 0, value: 20_000 + p.n, status: tx(p).status }))
      );
    const read = /\/deposit\/([0-9a-f]{64})\/0$/.exec(url);
    if (read?.[1]) {
      const n = Number.parseInt(read[1], 16);
      reads.push(n);
      if (!minted.has(n) && !pending.has(n)) return json({ message: 'not found' }, 404);
      const status = minted.has(n) ? 'confirmed' : 'pending';
      return json({
        bitcoinTxid: read[1],
        bitcoinTxOutputIndex: 0,
        recipient: 'x',
        amount: 1,
        status,
        reclaimScript: dep.reclaimScript,
        depositScript: dep.depositScript,
      });
    }
    if (/\/tx\/[0-9a-f]{64}\/outspend\/0$/.test(url)) return json(outspend);
    return json({ message: `unexpected ${url}` }, 500);
  }
  function fetchFn(url: string): Promise<Response> {
    return new Promise(resolve => resolve(route(url)));
  }
  return { fetchFn, reads, pending };
}

describe('observeDeposit: mint reads and registration with many payments', () => {
  it('a seventh payment after six minted ones is read and registered', async () => {
    const payments = [1, 2, 3, 4, 5, 6].map(n => ({ n, confirmed: true, spent: true }));
    const w = chainWorld(
      [...payments, { n: 7, confirmed: false, spent: false }],
      new Set([1, 2, 3, 4, 5, 6])
    );
    const obs = await observeDeposit(config, ctx, null, { fetchFn: w.fetchFn });
    expect(w.reads).toContain(7);
    expect(obs.mints.get(outpoint(7))).toBeNull();
    expect(obs.toRegister.map(o => o.txid)).toEqual([txid(7)]);
  });

  it('every unspent payment gets registered across checks, newest ones included', async () => {
    const payments = [1, 2, 3, 4, 5, 6, 7].map(n => ({ n, confirmed: true, spent: false }));
    const w = chainWorld(payments, new Set());
    const first = await observeDeposit(config, ctx, null, { fetchFn: w.fetchFn });
    expect(first.toRegister).toHaveLength(5);
    const known = new Map<string, MintStatus>(first.mints);
    for (const o of first.toRegister) {
      known.set(`${o.txid}:${o.vout}`, 'pending');
      w.pending.add(Number.parseInt(o.txid, 16));
    }
    const second = await observeDeposit(config, ctx, null, { fetchFn: w.fetchFn, known });
    const all = new Set([...first.toRegister, ...second.toRegister].map(o => o.txid));
    expect(all).toEqual(new Set(payments.map(p => txid(p.n))));
  });

  it('does not read again a payment already known to be minted', async () => {
    const payments = [1, 2].map(n => ({ n, confirmed: true, spent: true }));
    const w = chainWorld(payments, new Set([1, 2]));
    const known = new Map<string, MintStatus>([[outpoint(1), 'confirmed']]);
    const obs = await observeDeposit(config, ctx, null, { fetchFn: w.fetchFn, known });
    expect(w.reads).toEqual([2]);
    expect(obs.mints.get(outpoint(1))).toBe('confirmed');
  });
});

describe('observeDeposit: an output that only looks spent', () => {
  const T = 'aa'.repeat(32);
  const named = {
    status: 'SUCCESS' as const,
    updatedAt: '',
    swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [{ hash: T }] },
  };

  function laggingWorld(outspend: () => Response) {
    const urls: string[] = [];
    const tx = {
      txid: T,
      vout: [{ scriptpubkey: dep.scriptPubKey, value: 200_000 }],
      status: { confirmed: true, block_height: TIP, block_time: 1 },
    };
    function route(url: string): Response {
      urls.push(url);
      if (url.endsWith('/limits'))
        return json({ pegCap: null, perDepositMinimum: 10_000, perDepositCap: null });
      if (url.endsWith('/blocks/tip/height')) return new Response(String(TIP));
      if (url.endsWith('/txs/mempool')) return json([]);
      if (url.endsWith('/txs/chain')) return json([tx]);
      if (url.endsWith('/utxo')) return json([]);
      if (url.includes('/outspend/')) return outspend();
      return json({ message: 'not found' }, 404);
    }
    return { urls, fetchFn: (url: string) => Promise.resolve(route(url)) };
  }

  it('reads the outspend and registers a payout the API still calls unspent', async () => {
    const w = laggingWorld(() => json({ spent: false }));
    const obs = await observeDeposit(config, ctx, named, { fetchFn: w.fetchFn });
    expect(w.urls.some(u => u.includes('/outspend/'))).toBe(true);
    expect(obs.progress.stage).not.toBe('reclaimed');
    expect(obs.progress.terminal).toBe(false);
    expect(obs.toRegister.map(o => o.txid)).toEqual([T]);
    expect(obs.payouts.map(p => p.spent)).toEqual([false]);
  });

  it('stays non-terminal and registers nothing when the outspend cannot be read', async () => {
    const w = laggingWorld(() => json({ message: 'down' }, 503));
    const obs = await observeDeposit(config, ctx, named, { fetchFn: w.fetchFn });
    expect(obs.progress.terminal).toBe(false);
    expect(obs.progress.stage).not.toBe('reclaimed');
    expect(obs.toRegister).toEqual([]);
  });

  it('stays non-terminal when the spender is not proven to be the reclaim path', async () => {
    const w = laggingWorld(() => json({ spent: true, txid: 'bb'.repeat(32) }));
    const obs = await observeDeposit(config, ctx, named, { fetchFn: w.fetchFn });
    expect(obs.progress.terminal).toBe(false);
    expect(obs.progress.stage).not.toBe('reclaimed');
  });
});

describe('observeDeposit: what the swap status tells the progress', () => {
  const T = 'ab'.repeat(32);
  function smallWorld(value: number, blockTime: number) {
    const status = { confirmed: true, block_height: TIP, block_time: blockTime };
    const tx = { txid: T, vout: [{ scriptpubkey: dep.scriptPubKey, value }], status };
    function route(url: string): Response {
      if (url.endsWith('/limits'))
        return json({ pegCap: null, perDepositMinimum: 10_000, perDepositCap: null });
      if (url.endsWith('/blocks/tip/height')) return new Response(String(TIP));
      if (url.endsWith('/txs/mempool')) return json([]);
      if (url.endsWith('/txs/chain')) return json([tx]);
      if (url.endsWith('/utxo')) return json([{ txid: T, vout: 0, value, status }]);
      if (url.includes('/deposit/'))
        return json({
          bitcoinTxid: T,
          bitcoinTxOutputIndex: 0,
          recipient: 'x',
          amount: 1,
          status: 'confirmed',
          reclaimScript: dep.reclaimScript,
          depositScript: dep.depositScript,
        });
      return json({ message: 'not found' }, 404);
    }
    return (url: string) => Promise.resolve(route(url));
  }
  function success(hashes: string[], timestamp: string) {
    return {
      status: 'SUCCESS' as const,
      updatedAt: '',
      swapDetails: {
        originChainTxHashes: [],
        destinationChainTxHashes: hashes.map(hash => ({ hash })),
      },
      quoteResponse: {
        timestamp,
        quoteRequest: { deadline: '2026-11-14T14:00:00.000Z' },
        quote: {},
      },
    };
  }

  it('says a named payout below the sBTC minimum cannot be minted', async () => {
    const obs = await observeDeposit(config, ctx, success([T], '2026-11-14T12:00:00.000Z'), {
      fetchFn: smallWorld(5_000, Date.parse('2026-11-14T13:00:00.000Z') / 1000),
    });
    expect(obs.progress).toMatchObject({ condition: 'payout-below-minimum', terminal: true });
  });

  it('waits for 1Click to name the payout when the only payment predates the swap', async () => {
    const obs = await observeDeposit(config, ctx, success([], '2026-11-14T12:00:00.000Z'), {
      fetchFn: smallWorld(50_000, Date.parse('2026-11-13T12:00:00.000Z') / 1000),
    });
    expect(obs.swapStartedAt).toBe(Date.parse('2026-11-14T12:00:00.000Z'));
    expect(obs.progress).toMatchObject({ condition: 'awaiting-payout-hash', terminal: false });
  });
});

describe('observeDeposit: more spent-looking payouts than one check reads', () => {
  it('reads every one of them across checks a minute apart', async () => {
    const payments = Array.from({ length: 9 }, (_, i) => ({
      n: i + 1,
      confirmed: true,
      spent: true,
    }));
    const w = chainWorld(payments, new Set(), { spent: true });
    const read = new Set<string>();
    function fetchFn(url: string) {
      if (url.includes('/outspend/')) read.add(url);
      return w.fetchFn(url);
    }
    const start = Date.parse('2026-11-14T12:00:00.000Z');
    for (const minute of [0, 1]) {
      await observeDeposit(config, ctx, null, {
        fetchFn,
        swapless: true,
        now: new Date(start + minute * 60_000),
      });
    }
    expect(read.size).toBe(9);
  });
});

describe('observeDeposit: payouts past the mint-read cap', () => {
  it('are not taken as never registered, so the deposit is not called reclaimed', async () => {
    const payments = Array.from({ length: 14 }, (_, i) => ({
      n: i + 1,
      confirmed: true,
      spent: true,
    }));
    const w = chainWorld(payments, new Set(payments.map(p => p.n)), { spent: true });
    const obs = await observeDeposit(config, ctx, null, { fetchFn: w.fetchFn, swapless: true });
    expect(obs.payouts.some(p => !obs.mints.has(`${p.txid}:${p.vout}`))).toBe(true);
    expect(obs.progress.stage).not.toBe('reclaimed');
    expect(obs.progress.terminal).toBe(false);
  });
});
