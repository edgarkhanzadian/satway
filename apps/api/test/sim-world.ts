import { buildDepositAddress, MAINNET_CONFIG as config } from '@satway/core';

import type { KV } from '../src/store/index.js';
import {
  D,
  EMILY,
  HIRO_KEY_URL,
  STATUS_URL,
  TIP,
  aggregateKeyResult,
  jsonRes,
  swapStatus,
} from './support.js';

const ZERO_STACKS = 'SP000000000000000000002Q6VF78';

export function simDeposit(n: number) {
  return buildDepositAddress({
    stacksAddress: ZERO_STACKS,
    reclaimPublicKey: (n + 1).toString(16).padStart(64, '0'),
    signersPublicKey: D.signerKey,
    maxSignerFeeSats: config.baseSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
  });
}

export interface SimSwap {
  address: string;
  swap: string;
  paidAtMs: number | null;
  txid: string;
}

export function simWorld(clock: () => number) {
  const byAddress = new Map<string, SimSwap>();
  const bySwap = new Map<string, SimSwap>();
  const emily = new Set<string>();
  const firstTry = new Map<string, number>();
  let serial = 0;

  function paid(d: SimSwap | undefined): boolean {
    return d?.paidAtMs !== null && d?.paidAtMs !== undefined && clock() >= d.paidAtMs;
  }

  function route(url: string): Response {
    if (url === HIRO_KEY_URL) return jsonRes(aggregateKeyResult(D.signerKey));
    if (url.startsWith(`${STATUS_URL}?`)) {
      const swap = new URL(url).searchParams.get('depositAddress') ?? '';
      const d = bySwap.get(swap);
      return jsonRes(
        swapStatus(swap, {
          recipient: d?.address ?? D.address,
          status: paid(d) ? 'SUCCESS' : 'PENDING_DEPOSIT',
          hashes: paid(d) && d ? [d.txid] : [],
          deadline: new Date(clock() + 2 * 3_600_000).toISOString(),
        })
      );
    }
    const utxo = /\/address\/([a-z0-9]+)\/utxo$/.exec(url);
    if (utxo?.[1]) {
      const d = byAddress.get(utxo[1]);
      return jsonRes(
        paid(d) && d
          ? [
              {
                txid: d.txid,
                vout: 0,
                value: 50_000,
                status: { confirmed: true, block_height: TIP - 1 },
              },
            ]
          : []
      );
    }
    if (url.endsWith('/blocks/tip/height')) return new Response(String(TIP));
    if (url === `${EMILY}/limits`)
      return jsonRes({ pegCap: null, perDepositMinimum: 10_000, perDepositCap: null });
    const dep = /\/deposit\/([0-9a-f]{64})\/(\d+)$/.exec(url);
    if (dep?.[1]) {
      if (!emily.has(dep[1])) return jsonRes({ message: 'not found' }, 404);
      return jsonRes({
        bitcoinTxid: dep[1],
        bitcoinTxOutputIndex: 0,
        recipient: 'x',
        amount: 50_000,
        status: 'pending',
        reclaimScript: D.reclaimScript,
        depositScript: D.depositScript,
      });
    }
    const hex = /\/tx\/([0-9a-f]{64})\/hex$/.exec(url);
    if (hex?.[1]) {
      if (!firstTry.has(hex[1])) firstTry.set(hex[1], clock());
      emily.add(hex[1]);
      return new Response('not modelled', { status: 503 });
    }
    return jsonRes({ message: 'not found' }, 404);
  }

  function fetchFn(url: string): Promise<Response> {
    return Promise.resolve(route(url));
  }

  function newDeposit(paidAtMs: number | null) {
    const n = serial++;
    const built = simDeposit(n);
    const sim: SimSwap = {
      address: built.address,
      swap: `0xsim${n}`,
      paidAtMs,
      txid: (n + 1).toString(16).padStart(64, 'a'),
    };
    byAddress.set(sim.address, sim);
    bySwap.set(sim.swap, sim);
    const body = {
      depositScript: built.depositScript,
      reclaimScript: built.reclaimScript,
      swapDepositAddress: sim.swap,
    };
    return { body, sim };
  }

  function extraSwap(of: SimSwap, body: { depositScript: string; reclaimScript: string }) {
    const n = serial++;
    const sim: SimSwap = { ...of, swap: `0xsim${n}`, paidAtMs: null };
    bySwap.set(sim.swap, sim);
    return { body: { ...body, swapDepositAddress: sim.swap }, sim };
  }

  return { fetchFn, newDeposit, extraSwap, firstTry };
}

interface Cached {
  value: string | null;
  at: number;
}

interface Stored {
  value: string | null;
  at: number;
  metadata?: Record<string, number>;
}

export interface EventualKv {
  at(location: number): KV;
  central: Map<string, Stored>;
  ops: string[];
}

export function eventualKv(
  clock: () => number,
  options: { locations: number; cacheTtlMs: number; listLagMs: number }
): EventualKv {
  const central = new Map<string, Stored>();
  const caches = Array.from({ length: options.locations }, () => new Map<string, Cached>());
  const ops: string[] = [];
  function at(location: number): KV {
    const cache = caches[location % caches.length] ?? new Map<string, Cached>();
    return {
      get(key) {
        ops.push('get');
        const hit = cache.get(key);
        if (hit && clock() - hit.at < options.cacheTtlMs) return Promise.resolve(hit.value);
        const value = central.get(key)?.value ?? null;
        cache.set(key, { value, at: clock() });
        return Promise.resolve(value);
      },
      put(key, value, put) {
        ops.push('put');
        central.set(key, {
          value,
          at: clock(),
          ...(put?.metadata ? { metadata: put.metadata } : {}),
        });
        cache.set(key, { value, at: clock() });
        return Promise.resolve();
      },
      delete(key) {
        ops.push('delete');
        central.set(key, { value: null, at: clock() });
        cache.set(key, { value: null, at: clock() });
        return Promise.resolve();
      },
      list({ prefix, cursor }) {
        ops.push('list');
        const visible = [...central.entries()]
          .filter(([k, e]) => {
            if (!k.startsWith(prefix)) return false;
            const settled = clock() - e.at >= options.listLagMs;
            return e.value !== null ? settled : !settled;
          })
          .sort(([a], [b]) => (a < b ? -1 : 1));
        const start = cursor ? Number(cursor) : 0;
        const page = visible.slice(start, start + 1000);
        const end = start + page.length;
        const keys = page.map(([name, e]) =>
          e.metadata ? { name, metadata: e.metadata } : { name }
        );
        return Promise.resolve(
          end < visible.length
            ? { keys, list_complete: false, cursor: String(end) }
            : { keys, list_complete: true }
        );
      },
    };
  }
  return { at, central, ops };
}
