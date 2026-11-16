import { describe, expect, it } from 'vitest';

import {
  DEPOSIT_INDEX_LIMIT,
  DEPOSIT_INDEX_WINDOW,
  MAINNET_CONFIG,
  MAX_DEPOSIT_INDEX_DRAWS,
  buildDepositAddress,
  buildIndexedDepositAddress,
  chooseDepositIndex,
  drawDepositIndex,
  fetchDepositsByReclaimKey,
  lowestUnusedIndex,
  scanDepositAddresses,
  usedDepositIndices,
} from '../../src/index.js';
import { REAL_DEPOSIT as D, jsonResponse } from '../fixtures.js';
import {
  REAL_EMILY_RECLAIM_KEY_DEPOSITS,
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

function addressOf(n: number): string {
  return buildIndexedDepositAddress({ ...owner, depositIndex: n }, config).address;
}

function emilyEntry(n: number, change: Partial<typeof owner> = {}) {
  const built = buildIndexedDepositAddress({ ...owner, ...change, depositIndex: n }, config);
  return {
    maxFee: built.maxSignerFeeSats,
    depositScript: built.depositScript,
    reclaimScript: built.reclaimScript,
  };
}

function emilyListing(...indices: number[]) {
  return {
    nextToken: null,
    deposits: indices.map((n, i) => ({
      version: 'v1',
      bitcoinTxid: 'cd'.repeat(32),
      bitcoinTxOutputIndex: i,
      recipient: '0516037370db53547d845976e26dd5b5a92a7c7436ba',
      amount: 50_000,
      lastUpdateHeight: 1,
      lastUpdateBlockHash: 'ef'.repeat(32),
      status: 'pending',
      ...emilyEntry(n),
    })),
  };
}

function sequence(...values: number[]): (maxExclusive: number) => number {
  const queue = [...values];
  return maxExclusive => {
    const next = queue.shift();
    if (next === undefined) throw new Error('random source ran out');
    return Math.min(next, maxExclusive - 1);
  };
}

interface FakeWorld {
  fetchFn(url: string): Promise<Response>;
  urls: string[];
}

function fakeWorld(opts: {
  emily?: unknown;
  emilyDown?: boolean;
  usedAddresses?: ReadonlySet<string>;
  esploraDown?: boolean;
}): FakeWorld {
  const urls: string[] = [];
  function route(url: string): Response {
    if (url.startsWith(`${config.sbtcApiUrl}/deposit/reclaim-pubkeys/`)) {
      if (opts.emilyDown) return new Response('Bad gateway', { status: 502 });
      return jsonResponse(opts.emily ?? { nextToken: null, deposits: [] });
    }
    const address = /\/address\/([a-z0-9]+)$/.exec(url)?.[1];
    if (address && url.startsWith(config.btcApiUrl)) {
      if (opts.esploraDown) return new Response('Service unavailable', { status: 503 });
      return jsonResponse(
        opts.usedAddresses?.has(address) ? REAL_USED_ADDRESS_STATS : REAL_UNUSED_ADDRESS_STATS
      );
    }
    throw new Error(`unexpected url ${url}`);
  }
  return {
    urls,
    fetchFn(url) {
      urls.push(url);
      return Promise.resolve(route(url));
    },
  };
}

describe('usedDepositIndices', () => {
  it('reads index 0 from the recorded real Emily lookup for this reclaim key', async () => {
    const found = await fetchDepositsByReclaimKey(config.sbtcApiUrl, D.reclaimPublicKey, {
      fetchFn: () => Promise.resolve(jsonResponse(REAL_EMILY_RECLAIM_KEY_DEPOSITS)),
    });
    expect(found.deposits).toHaveLength(3);
    expect(usedDepositIndices(found.deposits, owner, config)).toEqual([0]);
  });

  it('turns per-deposit fee caps into indices', () => {
    const deposits = [emilyEntry(3), emilyEntry(0), emilyEntry(3), emilyEntry(250)];
    expect(usedDepositIndices(deposits, owner, config)).toEqual([0, 3, 250]);
  });

  it('ignores deposits for another recipient or another signer key', () => {
    const deposits = [
      emilyEntry(4, { stacksAddress: 'SP000000000000000000002Q6VF78' }),
      emilyEntry(5, { signersPublicKey: 'bb'.repeat(32) }),
      emilyEntry(6),
    ];
    expect(usedDepositIndices(deposits, owner, config)).toEqual([6]);
  });

  it('takes the index from the deposit script, as recovery does, not from Emily’s maxFee field', () => {
    const mislabelled = { ...emilyEntry(9), maxFee: config.baseSignerFeeSats + 10 };
    const outOfRangeField = {
      ...emilyEntry(0),
      maxFee: config.baseSignerFeeSats + DEPOSIT_INDEX_LIMIT,
    };
    expect(usedDepositIndices([mislabelled, outOfRangeField], owner, config)).toEqual([0, 9]);
  });

  it('ignores a script whose fee cap is outside the index range', () => {
    const outside = buildDepositAddress({
      ...owner,
      maxSignerFeeSats: config.baseSignerFeeSats + DEPOSIT_INDEX_LIMIT,
      reclaimLockBlocks: config.reclaimLockBlocks,
    });
    const entry = {
      maxFee: config.baseSignerFeeSats,
      depositScript: outside.depositScript,
      reclaimScript: outside.reclaimScript,
    };
    expect(usedDepositIndices([entry], owner, config)).toEqual([]);
  });
});

describe('drawDepositIndex', () => {
  it('starts at the lowest unused index', () => {
    expect(lowestUnusedIndex(new Set())).toBe(0);
    expect(lowestUnusedIndex(new Set([0, 1, 2, 5]))).toBe(3);
  });

  it('draws inside the window above the lowest unused index', () => {
    const used = new Set([0, 1, 2]);
    expect(drawDepositIndex(used, () => 0)).toBe(3);
    expect(drawDepositIndex(used, max => max - 1)).toBe(3 + DEPOSIT_INDEX_WINDOW - 1);
  });

  it('skips used values inside the window', () => {
    const used = new Set([0, 4, 5, 6]);
    expect(drawDepositIndex(used, () => 0)).toBe(1);
    expect(drawDepositIndex(used, () => 3)).toBe(7);
    let offered = 0;
    drawDepositIndex(used, max => {
      offered = max;
      return 0;
    });
    expect(offered).toBe(DEPOSIT_INDEX_WINDOW - 3);
  });

  it('never goes past the index limit', () => {
    const used = new Set(Array.from({ length: DEPOSIT_INDEX_LIMIT - 2 }, (_, i) => i));
    expect(drawDepositIndex(used, max => max - 1)).toBe(DEPOSIT_INDEX_LIMIT - 1);
    const full = new Set(Array.from({ length: DEPOSIT_INDEX_LIMIT }, (_, i) => i));
    expect(() => drawDepositIndex(full, () => 0)).toThrow(/used up/);
  });

  it('can base the window on paid indices while still skipping reserved ones', () => {
    const reserved = new Set([0, 1, 2]);
    expect(drawDepositIndex(reserved, () => 0, new Set())).toBe(3);
    expect(drawDepositIndex(reserved, max => max - 1, new Set())).toBe(DEPOSIT_INDEX_WINDOW - 1);
  });

  it('refuses a random source that answers out of range', () => {
    expect(() => drawDepositIndex(new Set(), () => DEPOSIT_INDEX_WINDOW)).toThrow(/out of range/);
    expect(() => drawDepositIndex(new Set(), () => -1)).toThrow(/out of range/);
    expect(() => drawDepositIndex(new Set(), () => 0.5)).toThrow(/out of range/);
  });
});

describe('chooseDepositIndex', () => {
  it('skips what Emily and this browser already used, then checks the address is empty', async () => {
    const world = fakeWorld({ emily: emilyListing(0) });
    const choice = await chooseDepositIndex({
      config,
      owner,
      localIndices: [1],
      randomInt: sequence(0),
      fetchFn: world.fetchFn,
    });
    expect(choice.deposit.depositIndex).toBe(2);
    expect(choice.deposit.maxSignerFeeSats).toBe(80_002);
    expect(choice.deposit.address).toBe(addressOf(2));
    expect(choice.used).toEqual([0, 1]);
    expect(choice.emily).toBe('read');
    expect(choice.occupied).toEqual([]);
    expect(world.urls).toEqual([
      `${config.sbtcApiUrl}/deposit/reclaim-pubkeys/${D.reclaimPublicKey}`,
      `${config.btcApiUrl}/address/${addressOf(2)}`,
    ]);
  });

  it('marks an address with transactions as used and draws again', async () => {
    const world = fakeWorld({ usedAddresses: new Set([addressOf(10), addressOf(0)]) });
    const choice = await chooseDepositIndex({
      config,
      owner,
      localIndices: [],
      randomInt: sequence(10, 0, 0),
      fetchFn: world.fetchFn,
    });
    expect(choice.occupied).toEqual([10, 0]);
    expect(choice.deposit.depositIndex).toBe(1);
    expect(choice.used).toEqual([0, 10]);
  });

  it('gives up with a clear error after a bounded number of draws', async () => {
    const all = new Set(Array.from({ length: 40 }, (_, n) => addressOf(n)));
    const world = fakeWorld({ usedAddresses: all });
    await expect(
      chooseDepositIndex({
        config,
        owner,
        localIndices: [],
        randomInt: () => 0,
        fetchFn: world.fetchFn,
      })
    ).rejects.toThrow(`Each of the ${MAX_DEPOSIT_INDEX_DRAWS} new Bitcoin deposit addresses`);
    expect(world.urls.filter(u => u.startsWith(config.btcApiUrl))).toHaveLength(
      MAX_DEPOSIT_INDEX_DRAWS
    );
  });

  it('goes on with local knowledge and a random draw when Emily is down, never falling back to 0', async () => {
    const world = fakeWorld({ emilyDown: true });
    const choice = await chooseDepositIndex({
      config,
      owner,
      localIndices: [0, 3],
      randomInt: sequence(57),
      fetchFn: world.fetchFn,
    });
    expect(choice.emily).toBe('unreachable');
    expect(choice.emilyError).toMatch(/502/);
    expect(choice.deposit.depositIndex).toBe(59);
    expect(world.urls.at(-1)).toBe(`${config.btcApiUrl}/address/${addressOf(59)}`);
  });

  it('bases the window on indices known to be paid, so a gap scan from 0 always finds the draw', async () => {
    const world = fakeWorld({});
    const choice = await chooseDepositIndex({
      config,
      owner,
      localIndices: [0, 1, 2],
      randomInt: max => max - 1,
      fetchFn: world.fetchFn,
    });
    expect(choice.deposit.depositIndex).toBe(DEPOSIT_INDEX_WINDOW - 1);
    const paid = choice.deposit.address;
    const scan = await scanDepositAddresses({
      config,
      owner,
      fetchFn: url =>
        Promise.resolve(
          jsonResponse(
            url.endsWith(`/${paid}`) ? REAL_USED_ADDRESS_STATS : REAL_UNUSED_ADDRESS_STATS
          )
        ),
    });
    expect(scan.deposits.map(d => d.depositIndex)).toEqual([DEPOSIT_INDEX_WINDOW - 1]);
  });

  it('moves the window base past the indices this browser knows were paid', async () => {
    const world = fakeWorld({});
    const choice = await chooseDepositIndex({
      config,
      owner,
      localIndices: [0, 1, 5],
      paidLocalIndices: [0, 1],
      randomInt: max => max - 1,
      fetchFn: world.fetchFn,
    });
    expect(choice.deposit.depositIndex).toBe(2 + DEPOSIT_INDEX_WINDOW - 1);
    const low = await chooseDepositIndex({
      config,
      owner,
      localIndices: [0, 1, 5],
      paidLocalIndices: [0, 1],
      randomInt: sequence(3),
      fetchFn: world.fetchFn,
    });
    expect(low.deposit.depositIndex).toBe(6);
  });

  it('does not start the deposit when the emptiness check cannot be made', async () => {
    const world = fakeWorld({ esploraDown: true });
    await expect(
      chooseDepositIndex({
        config,
        owner,
        localIndices: [],
        randomInt: () => 0,
        fetchFn: world.fetchFn,
      })
    ).rejects.toThrow(/Could not check that the new Bitcoin deposit address is unused/);
  });
});
