import { describe, expect, it } from 'vitest';

import {
  DEPOSIT_INDEX_WINDOW,
  HttpError,
  MAINNET_CONFIG,
  buildIndexedDepositAddress,
  fetchDepositsByReclaimKey,
  findDepositsByReclaimKey,
  scanDepositAddresses,
} from '../../src/index.js';
import { REAL_DEPOSIT as D, jsonResponse } from '../fixtures.js';
import {
  REAL_EMILY_RECLAIM_KEY_BAD_KEY,
  REAL_EMILY_RECLAIM_KEY_DEPOSITS,
  REAL_EMILY_RECLAIM_KEY_FIRST_PAGE,
  REAL_EMILY_RECLAIM_KEY_UNKNOWN,
  REAL_UNUSED_ADDRESS_STATS,
  REAL_USED_ADDRESS_STATS,
} from '../real-responses.js';

const owner: { stacksAddress: string; reclaimPublicKey: string; signersPublicKey: string } = {
  stacksAddress: D.stacksAddress,
  reclaimPublicKey: D.reclaimPublicKey,
  signersPublicKey: D.signersPublicKey,
};

const config = {
  btcApiUrl: 'https://btc.example',
  sbtcApiUrl: 'https://emily.example',
  baseSignerFeeSats: MAINNET_CONFIG.baseSignerFeeSats,
  reclaimLockBlocks: MAINNET_CONFIG.reclaimLockBlocks,
};

const lookup = `${config.sbtcApiUrl}/deposit/reclaim-pubkeys/${D.reclaimPublicKey}`;

function addressOf(n: number): string {
  return buildIndexedDepositAddress({ ...owner, depositIndex: n }, config).address;
}

describe('fetchDepositsByReclaimKey', () => {
  it('reads the recorded real response', async () => {
    const urls: string[] = [];
    const found = await fetchDepositsByReclaimKey(config.sbtcApiUrl, `02${D.reclaimPublicKey}`, {
      fetchFn(url) {
        urls.push(url);
        return Promise.resolve(jsonResponse(REAL_EMILY_RECLAIM_KEY_DEPOSITS));
      },
    });
    expect(urls).toEqual([lookup]);
    expect(found.truncated).toBe(false);
    expect(found.deposits[0]).toEqual({
      bitcoinTxid: D.txid,
      bitcoinTxOutputIndex: 0,
      maxFee: 80_000,
      amount: 20_000_774,
      status: 'confirmed',
      depositScript: D.depositScript,
      reclaimScript: D.reclaimScript,
    });
  });

  it('follows nextToken across pages', async () => {
    const urls: string[] = [];
    const found = await fetchDepositsByReclaimKey(config.sbtcApiUrl, D.reclaimPublicKey, {
      fetchFn(url) {
        urls.push(url);
        return Promise.resolve(
          jsonResponse(
            urls.length === 1 ? REAL_EMILY_RECLAIM_KEY_FIRST_PAGE : REAL_EMILY_RECLAIM_KEY_UNKNOWN
          )
        );
      },
    });
    expect(urls).toHaveLength(2);
    expect(urls[1]).toMatch(new RegExp(`^${lookup}\\?nextToken=eyJ`));
    expect(found.deposits).toHaveLength(1);
  });

  it('stops after the page limit and says the list is cut short', async () => {
    const found = await fetchDepositsByReclaimKey(config.sbtcApiUrl, D.reclaimPublicKey, {
      maxPages: 2,
      fetchFn: () => Promise.resolve(jsonResponse(REAL_EMILY_RECLAIM_KEY_FIRST_PAGE)),
    });
    expect(found.deposits).toHaveLength(2);
    expect(found.truncated).toBe(true);
  });

  it('surfaces the real 400 for a bad key', async () => {
    await expect(
      fetchDepositsByReclaimKey(config.sbtcApiUrl, D.reclaimPublicKey, {
        fetchFn: () => Promise.resolve(jsonResponse(REAL_EMILY_RECLAIM_KEY_BAD_KEY, 400)),
      })
    ).rejects.toBeInstanceOf(HttpError);
  });
});

describe('findDepositsByReclaimKey', () => {
  it('turns the real lookup into one reclaimable deposit with its index', async () => {
    const found = await findDepositsByReclaimKey(config, D.reclaimPublicKey, {
      fetchFn: () => Promise.resolve(jsonResponse(REAL_EMILY_RECLAIM_KEY_DEPOSITS)),
    });
    expect(found.deposits).toEqual([
      {
        stacksAddress: D.stacksAddress,
        reclaimPublicKey: D.reclaimPublicKey,
        signersPublicKey: D.signersPublicKey,
        maxSignerFeeSats: 80_000,
        reclaimLockBlocks: 950,
        depositIndex: 0,
        depositAddress: D.address,
        depositScriptPubKey: D.scriptPubKey,
        depositScript: D.depositScript,
        reclaimScript: D.reclaimScript,
      },
    ]);
  });

  it('keeps per-deposit addresses apart and drops scripts it cannot reclaim', async () => {
    function at(n: number) {
      return buildIndexedDepositAddress({ ...owner, depositIndex: n }, config);
    }
    function entry(n: number) {
      return {
        bitcoinTxid: 'ab'.repeat(32),
        bitcoinTxOutputIndex: n,
        maxFee: at(n).maxSignerFeeSats,
        amount: 50_000,
        status: 'pending',
        depositScript: at(n).depositScript,
        reclaimScript: at(n).reclaimScript,
      };
    }
    const odd = { ...entry(9), reclaimScript: '03ffff00b26a' };
    const found = await findDepositsByReclaimKey(config, D.reclaimPublicKey, {
      fetchFn: () =>
        Promise.resolve(jsonResponse({ nextToken: null, deposits: [entry(5), entry(0), odd] })),
    });
    expect(found.deposits.map(d => [d.depositIndex, d.maxSignerFeeSats, d.depositAddress])).toEqual(
      [
        [5, 80_005, addressOf(5)],
        [0, 80_000, addressOf(0)],
      ]
    );
  });
});

function esplora(used: ReadonlySet<number>, opts: { failAt?: number } = {}) {
  const byAddress = new Map(Array.from({ length: 720 }, (_, n) => [addressOf(n), n]));
  const asked: number[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    asked,
    peak: () => peak,
    async fetchFn(url: string, init?: RequestInit): Promise<Response> {
      const address = /\/address\/([a-z0-9]+)$/.exec(url)?.[1] ?? '';
      const n = byAddress.get(address);
      if (n === undefined) throw new Error(`unexpected url ${url}`);
      if (init?.signal?.aborted) throw new Error('aborted');
      asked.push(n);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (n === opts.failAt) return new Response('Too many requests', { status: 429 });
      return jsonResponse(used.has(n) ? REAL_USED_ADDRESS_STATS : REAL_UNUSED_ADDRESS_STATS);
    },
  };
}

describe('scanDepositAddresses', () => {
  it('finds used indices and stops after a full window of unused ones', async () => {
    const world = esplora(new Set([0, 3, 200, 455]));
    const progress: number[] = [];
    const result = await scanDepositAddresses({
      config,
      owner,
      fetchFn: world.fetchFn,
      onProgress: p => progress.push(p.checked),
    });
    expect(result.cancelled).toBe(false);
    expect(result.deposits.map(d => d.depositIndex)).toEqual([0, 3, 200, 455]);
    expect(result.deposits[2]?.maxSignerFeeSats).toBe(80_200);
    expect(result.deposits[2]?.depositAddress).toBe(addressOf(200));
    expect(result.checked).toBe(455 + 1 + DEPOSIT_INDEX_WINDOW);
    expect(Math.max(...world.asked)).toBe(455 + DEPOSIT_INDEX_WINDOW);
    expect(world.peak()).toBeLessThanOrEqual(4);
    expect(progress.at(-1)).toBe(result.checked);
  });

  it('stops after the gap with nothing found', async () => {
    const world = esplora(new Set());
    const result = await scanDepositAddresses({ config, owner, fetchFn: world.fetchFn, gap: 10 });
    expect(result.deposits).toEqual([]);
    expect(result.checked).toBe(10);
  });

  it('can be cancelled and keeps what it found', async () => {
    const controller = new AbortController();
    const world = esplora(new Set([1]));
    const result = await scanDepositAddresses({
      config,
      owner,
      fetchFn: world.fetchFn,
      signal: controller.signal,
      onProgress(p) {
        if (p.checked >= 8) controller.abort();
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.checked).toBe(8);
    expect(result.deposits.map(d => d.depositIndex)).toEqual([1]);
  });

  it('surfaces an upstream failure', async () => {
    const world = esplora(new Set(), { failAt: 6 });
    await expect(scanDepositAddresses({ config, owner, fetchFn: world.fetchFn })).rejects.toThrow(
      /429/
    );
  });
});
