import { jsonResponse } from './fixtures.js';

export interface FakeOutput {
  spk: string;
  value: number;
  spent?: boolean;
}

export interface FakeTx {
  txid: string;
  outputs: FakeOutput[];
  confirmed: boolean;
  height?: number;
  time?: number;
}

export interface FakeEsplora {
  fetchFn(url: string): Promise<Response>;
  urls: string[];
}

function status(tx: FakeTx) {
  return tx.confirmed
    ? { confirmed: true, block_height: tx.height, block_time: tx.time }
    : { confirmed: false };
}

function asJson(tx: FakeTx) {
  return {
    txid: tx.txid,
    vout: tx.outputs.map(o => ({ scriptpubkey: o.spk, value: o.value })),
    status: status(tx),
  };
}

export function fakeEsplora(opts: {
  base?: string;
  address: string;
  spk: string;
  txs: FakeTx[];
  tooManyUtxos?: boolean;
}): FakeEsplora {
  const base = opts.base ?? 'https://btc.example';
  const urls: string[] = [];
  const mempool = opts.txs.filter(t => !t.confirmed);
  const chain = opts.txs.filter(t => t.confirmed);

  function route(url: string): Response {
    const addr = `${base}/address/${opts.address}`;
    if (url === `${addr}/utxo`) {
      if (opts.tooManyUtxos) {
        return new Response(
          'Too many unspent transaction outputs (>500). Contact support to raise limits.',
          { status: 400 }
        );
      }
      return jsonResponse(
        opts.txs.flatMap(tx =>
          tx.outputs.flatMap((o, vout) =>
            o.spk === opts.spk && !o.spent
              ? [{ txid: tx.txid, vout, value: o.value, status: status(tx) }]
              : []
          )
        )
      );
    }
    if (url === `${addr}/txs/mempool`) return jsonResponse(mempool.slice(0, 50).map(asJson));
    if (url.startsWith(`${addr}/txs/chain`)) {
      const last = url.slice(`${addr}/txs/chain`.length).replace(/^\//, '');
      const start = last === '' ? 0 : chain.findIndex(t => t.txid === last) + 1;
      if (last !== '' && start === 0) return jsonResponse([]);
      return jsonResponse(chain.slice(start, start + 25).map(asJson));
    }
    const txMatch = /\/tx\/([0-9a-f]{64})$/.exec(url);
    if (txMatch) {
      const tx = opts.txs.find(t => t.txid === txMatch[1]);
      return tx ? jsonResponse(asJson(tx)) : new Response('Transaction not found', { status: 404 });
    }
    throw new Error(`unexpected url ${url}`);
  }

  return {
    urls,
    fetchFn(url: string) {
      urls.push(url);
      return Promise.resolve(route(url));
    },
  };
}

export function txidOf(n: number): string {
  return n.toString(16).padStart(64, '0');
}
