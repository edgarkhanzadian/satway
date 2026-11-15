import { MAINNET_CONFIG as config } from '@satway/core';

import {
  DEPOSIT_RATE,
  type Env,
  PROXY_RATE,
  type RegisterDeps,
  type SignerKeyState,
  WindowLimiter,
  newSignerKeyState,
  registerDeposit,
} from '../src/http/index.js';
import type { KV } from '../src/store/index.js';

export const D = {
  txid: '5ab7ae554358d3ffdab7cc48db49ff144c5ae4fdd617b4140eac1b1936109bf5',
  address: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
  scriptPubKey: '512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e',
  depositScript:
    '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
  reclaimScript: '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
  signerKey: 'd99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69',
};
export const REAL_TX_HEX =
  '020000000001028ef08f51a0401825af15c238d7b2136d2405abd9bf02e0c1c8a697db2aeb296c0100000000fdffffff1e6ad5fd73606f585163f958b617134804bf611c2a0a7ffb175fded4280b3d1d0a00000000fdffffff02063031010000000022512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2ecc0a0000000000001600142df601e9bf6db95982ff4579f18ca119f02c053102473044022045ec482d45a32b8f761cd402687ce8f9e6cc2d9b8ed5bba2c71a31fc099e77cd02200a644600d7174977f7185d630323b1f0dda4b5b81b2017bc8000639015bdd23501210251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff20247304402204c18dfb4eb01af4da5f1c66e9c0f79696e55803ec7c257cc7e34014af2c2d97a02202df05db704cbd99c121dd18cb908d5c2a5bd63baca86ad09dbd9c0ad82749b9c01210251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff200000000';
export const CHAIN: Record<number, { txid: string; hex: string }> = {
  0: { txid: D.txid, hex: REAL_TX_HEX },
  3: {
    txid: '87fb3b6d3d8abe180aedb1034ff6ab6675260c5f350cf6c80cc4618dc330d14a',
    hex: '02000000018ef08f51a0401825af15c238d7b2136d2405abd9bf02e0c1c8a697db2aeb296c010000000151fdffffff04010000000000000016001411111111111111111111111111111111111111110100000000000000160014111111111111111111111111111111111111111101000000000000001600141111111111111111111111111111111111111111ac8a00000000000022512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e00000000',
  },
};

export const NOW = new Date('2026-11-14T12:00:00.000Z');
export const NOW_S = Date.parse(NOW.toISOString()) / 1000;
export const BTC = 'https://btc.example';
export const EMILY = 'https://emily.example';
export const HIRO_KEY_URL = `${config.stxApiUrl}/v2/contracts/call-read/${config.sbtcContract}/sbtc-registry/get-current-aggregate-pubkey`;
export const STATUS_URL = `${config.oneClickBaseUrl}/v0/status`;
export const endpoints = { btcApiUrl: BTC, sbtcApiUrl: EMILY, reclaimLockBlocks: 950 };
export const registerConfig = { ...config, btcApiUrl: BTC };
export const OTHER_SPK = '0014' + '11'.repeat(20);
export const TIP = 976_000;

export interface MemoryKv extends KV {
  data: Map<string, string>;
  ops: { op: 'get' | 'put' | 'delete' | 'list'; key: string }[];
  writes(): string[];
}

export function memoryKv(pageSize = 1000): MemoryKv {
  const data = new Map<string, string>();
  const metadata = new Map<string, Record<string, number>>();
  const ops: MemoryKv['ops'] = [];
  return {
    data,
    ops,
    writes: () => ops.filter(o => o.op === 'put').map(o => o.key),
    get(key) {
      ops.push({ op: 'get', key });
      return Promise.resolve(data.get(key) ?? null);
    },
    put(key, value, options) {
      ops.push({ op: 'put', key });
      data.set(key, value);
      if (options?.metadata) metadata.set(key, options.metadata);
      else metadata.delete(key);
      return Promise.resolve();
    },
    delete(key) {
      ops.push({ op: 'delete', key });
      data.delete(key);
      metadata.delete(key);
      return Promise.resolve();
    },
    list({ prefix, cursor }) {
      ops.push({ op: 'list', key: prefix });
      const all = [...data.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const keys = all
        .slice(start, start + pageSize)
        .map(name => ({ name, metadata: metadata.get(name) }));
      const end = start + keys.length;
      return Promise.resolve(
        end < all.length
          ? { keys, list_complete: false, cursor: String(end) }
          : { keys, list_complete: true }
      );
    },
  };
}

export function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function bodyJson(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== 'string') throw new Error('Expected a string body');
  const parsed: unknown = JSON.parse(body);
  return parsed;
}

export function emilyDeposit(status: string) {
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

export interface Tx {
  txid: string;
  vout: { scriptpubkey: string; value: number }[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

export function payoutTx(
  vout: number,
  opts: { confirmed?: boolean; value?: number; txid?: string } = {}
): Tx {
  const confirmed = opts.confirmed ?? true;
  const other = { scriptpubkey: OTHER_SPK, value: 1 };
  return {
    txid: opts.txid ?? CHAIN[vout]?.txid ?? D.txid,
    vout: [
      ...Array.from({ length: vout }, () => other),
      { scriptpubkey: D.scriptPubKey, value: opts.value ?? 35_000 },
    ],
    status: confirmed
      ? { confirmed, block_height: TIP - 2, block_time: NOW_S + 3_600 }
      : { confirmed },
  };
}

export function oldTx(): Tx {
  return {
    txid: 'cc'.repeat(32),
    vout: [{ scriptpubkey: D.scriptPubKey, value: 50_000 }],
    status: { confirmed: true, block_height: TIP - 5_000, block_time: NOW_S - 86_400 },
  };
}

export interface SwapFake {
  recipient?: string;
  destinationAsset?: string;
  deadline?: string;
  status?: string;
  depositAddress?: string;
  omitQuoteResponse?: boolean;
}

export function swapStatus(swapAddress: string, swap: SwapFake = {}) {
  return {
    correlationId: 'c',
    status: swap.status ?? 'PENDING_DEPOSIT',
    updatedAt: NOW.toISOString(),
    swapDetails: {
      depositedAmount: null,
      depositedAmountUsd: null,
      depositedAmountFormatted: null,
      intentHashes: [],
      nearTxHashes: [],
      amountIn: null,
      amountInFormatted: null,
      amountInUsd: null,
      amountOut: null,
      amountOutFormatted: null,
      amountOutUsd: null,
      slippage: null,
      refundedAmount: '0',
      refundedAmountFormatted: '0',
      refundedAmountUsd: '0',
      refundReason: null,
      refundFee: '9972',
      withdrawFee: '1900',
      originChainTxHashes: [],
      destinationChainTxHashes: [],
    },
    ...(swap.omitQuoteResponse
      ? {}
      : {
          quoteResponse: {
            correlationId: 'c',
            timestamp: NOW.toISOString(),
            signature: 's',
            quoteRequest: {
              recipient: swap.recipient ?? D.address,
              destinationAsset: swap.destinationAsset ?? config.btcAssetId,
              deadline: swap.deadline ?? new Date(NOW.getTime() + 2 * 3_600_000).toISOString(),
            },
            quote: { depositAddress: swap.depositAddress ?? swapAddress },
          },
        }),
  };
}

export function aggregateKeyResult(xOnly: string) {
  return { okay: true, result: `0x020000002102${xOnly}` };
}

export interface WorldOptions {
  btc?: string;
  txs?: Tx[];
  prior?: Tx[];
  known?: boolean;
  knownOutpoints?: string[];
  notifyStatus?: number;
  failPostFor?: string;
  txHex?: string;
  limitsDown?: boolean;
  tooManyUtxos?: boolean;
  signerKey?: string;
  hiroDown?: boolean;
  swaps?: Record<string, SwapFake | 'unknown'>;
  oneClickDown?: boolean;
  btcDown?: boolean;
}

export function world(opts: WorldOptions = {}) {
  const btc = opts.btc ?? BTC;
  const calls: { url: string; method: string; body?: unknown; auth?: string | null }[] = [];
  const emily = new Set(opts.knownOutpoints ?? []);
  const state = {
    arrived: false,
    txs: [...(opts.txs ?? [])],
    signerKey: opts.signerKey ?? D.signerKey,
    hiroDown: opts.hiroDown ?? false,
    oneClickDown: opts.oneClickDown ?? false,
  };
  function visible(): Tx[] {
    return [...(state.arrived ? state.txs : []), ...(opts.prior ?? [])];
  }
  function respond(url: string, init?: RequestInit): Response {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? bodyJson(init) : undefined,
      auth: new Headers(init?.headers).get('authorization'),
    });
    if (url === HIRO_KEY_URL) {
      if (state.hiroDown) return jsonRes({ message: 'down' }, 503);
      return jsonRes(aggregateKeyResult(state.signerKey));
    }
    if (url.startsWith(`${STATUS_URL}?`)) {
      if (state.oneClickDown) return jsonRes({ message: 'down' }, 502);
      const swapAddress = new URL(url).searchParams.get('depositAddress') ?? 'none';
      const swap = opts.swaps?.[swapAddress] ?? {};
      if (swap === 'unknown') return jsonRes({ message: 'Not Found' }, 404);
      return jsonRes(swapStatus(swapAddress, swap));
    }
    if (url.startsWith(btc) && opts.btcDown) return new Response('down', { status: 503 });
    const addr = `${btc}/address/${D.address}`;
    if (url === `${addr}/utxo`) {
      if (opts.tooManyUtxos)
        return new Response('Too many unspent transaction outputs (>500).', { status: 400 });
      return jsonRes(
        visible().flatMap(tx =>
          tx.vout.flatMap((o, vout) =>
            o.scriptpubkey === D.scriptPubKey
              ? [{ txid: tx.txid, vout, value: o.value, status: tx.status }]
              : []
          )
        )
      );
    }
    if (url.startsWith(`${btc}/address/`) && url.endsWith('/utxo')) return jsonRes([]);
    if (url === `${addr}/txs/mempool`) return jsonRes(visible().filter(t => !t.status.confirmed));
    if (url.startsWith(`${addr}/txs/chain`))
      return jsonRes(visible().filter(t => t.status.confirmed));
    if (url.startsWith(`${btc}/address/`)) return jsonRes([]);
    if (url === `${btc}/blocks/tip/height`) return new Response(String(TIP));
    if (url.startsWith(`${btc}/tx/`)) {
      const known = Object.values(CHAIN).find(t => url.endsWith(`/tx/${t.txid}/hex`));
      if (!known) return new Response('Transaction not found', { status: 404 });
      return new Response(opts.txHex ?? known.hex);
    }
    if (url === `${EMILY}/limits`) {
      if (opts.limitsDown) return jsonRes({ message: 'down' }, 503);
      return jsonRes({ pegCap: null, perDepositMinimum: 10_000, perDepositCap: null });
    }
    if (init?.method === 'POST' && url === `${EMILY}/deposit`) {
      const body = bodyJson(init);
      const key =
        typeof body === 'object' &&
        body !== null &&
        'bitcoinTxid' in body &&
        'bitcoinTxOutputIndex' in body
          ? `${String(body.bitcoinTxid)}:${String(body.bitcoinTxOutputIndex)}`
          : 'unknown';
      if (key === opts.failPostFor) return jsonRes({ message: 'Emily is down' }, 500);
      if (!opts.notifyStatus || opts.notifyStatus < 300) emily.add(key);
      return jsonRes(emilyDeposit('pending'), opts.notifyStatus ?? 201);
    }
    const dep = /\/deposit\/([0-9a-f]{64})\/(\d+)$/.exec(url);
    if (dep && (opts.known || emily.has(`${dep[1]}:${dep[2]}`)))
      return jsonRes(emilyDeposit('pending'));
    return jsonRes({ message: 'not found' }, 404);
  }
  function fetchFn(url: string, init?: RequestInit): Promise<Response> {
    return new Promise(resolve => resolve(respond(url, init)));
  }
  function arrive(...more: Tx[]) {
    state.arrived = true;
    state.txs.push(...more);
  }
  function posts() {
    return calls.filter(c => c.method === 'POST' && c.url === `${EMILY}/deposit`).map(c => c.body);
  }
  function hits(prefix: string) {
    return calls.filter(c => c.url.startsWith(prefix));
  }
  return { calls, fetchFn, arrive, posts, hits, emily, state };
}

export type World = ReturnType<typeof world>;

export function registerDeps(w: World, over: Partial<RegisterDeps> = {}): RegisterDeps {
  return {
    config: registerConfig,
    fetchFn: w.fetchFn,
    now: NOW,
    signerState: newSignerKeyState(),
    ...over,
  };
}

export async function watching(
  w: World,
  kv: MemoryKv = memoryKv(),
  swapDepositAddress = '0xswap0',
  over: Partial<RegisterDeps> = {}
) {
  await registerDeposit(
    kv,
    { depositScript: D.depositScript, reclaimScript: D.reclaimScript, swapDepositAddress },
    registerDeps(w, over)
  );
  w.arrive();
  return kv;
}

export function outpointsPosted(w: World): string[] {
  return w
    .posts()
    .map(b =>
      typeof b === 'object' && b !== null && 'bitcoinTxid' in b && 'bitcoinTxOutputIndex' in b
        ? `${String(b.bitcoinTxid)}:${String(b.bitcoinTxOutputIndex)}`
        : 'unknown'
    );
}

export function watchKeys(kv: MemoryKv): string[] {
  return [...kv.data.keys()].filter(k => k.startsWith('dep:'));
}

export function record(kv: MemoryKv): unknown {
  const raw = kv.data.get(`dep:${D.address}`);
  return raw ? JSON.parse(raw) : null;
}

export function testEnv(over: Partial<Env> = {}): Env {
  return {
    DEPOSITS: memoryKv(),
    ALLOWED_ORIGINS: 'https://app.example',
    DEPOSIT_RATE_LIMITER: new WindowLimiter(DEPOSIT_RATE, () => NOW.getTime()),
    PROXY_RATE_LIMITER: new WindowLimiter(PROXY_RATE, () => NOW.getTime()),
    ...over,
  };
}

export function handleOptions(signerState: SignerKeyState = newSignerKeyState()) {
  return { now: () => NOW, signerState };
}

export function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = { origin: 'https://app.example' }
) {
  return new Request(`https://api.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function goodBody(swapDepositAddress = '0xswap0') {
  return { depositScript: D.depositScript, reclaimScript: D.reclaimScript, swapDepositAddress };
}
