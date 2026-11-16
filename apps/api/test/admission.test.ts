import { describe, expect, it } from 'vitest';

import {
  ADMISSION_STALE_MS,
  LOAD_MAX_AGE_MS,
  admissionOf,
  registerDeposit,
} from '../src/http/index.js';
import { runNotifier } from '../src/notifier/index.js';
import {
  MAX_ACTIVE_WATCHES,
  MAX_EXTRA_SWAPS,
  MAX_UNFOLDED_ADMITTED,
  type WatchLoad,
} from '../src/store/index.js';
import { D, NOW, endpoints, goodBody, memoryKv, record, registerDeps, world } from './support.js';

const T = NOW.getTime();

function load(over: Partial<WatchLoad> = {}): WatchLoad {
  return { counts: {}, pending: 0, listedAt: T, publishedAt: T, ...over };
}

describe('admissionOf', () => {
  it('admits on a fresh deployment with nothing published yet', () => {
    expect(admissionOf(null, [], D.address, T)).toBe('ok');
  });

  it('counts swaps registered since the last list, so a fifth swap is refused before it is folded', () => {
    const recent = Array.from({ length: MAX_EXTRA_SWAPS }, (_, i) => ({
      address: D.address,
      swap: `0xs${i}`,
      at: T + 60_000 + i,
    }));
    const published = load({ counts: { [D.address]: 1 } });
    expect(admissionOf(published, recent, D.address, T + 120_000)).toBe('swap-limit');
    expect(admissionOf(published, recent.slice(1), D.address, T + 120_000)).toBe('ok');
  });

  it('refuses a new address when watched plus pending would pass the cap', () => {
    const counts = Object.fromEntries(
      Array.from({ length: MAX_ACTIVE_WATCHES }, (_, i) => [`bc1pfill${i}`, 1])
    );
    expect(admissionOf(load({ counts }), [], D.address, T)).toBe('capacity');
    expect(admissionOf(load({ counts }), [], 'bc1pfill3', T)).toBe('ok');
  });

  it('refuses once too many registrations wait to be folded, listed or not', () => {
    expect(admissionOf(load({ pending: MAX_UNFOLDED_ADMITTED }), [], D.address, T)).toBe(
      'capacity'
    );
    const unlisted = Array.from({ length: MAX_UNFOLDED_ADMITTED }, (_, i) => ({
      address: `bc1pnew${i}`,
      swap: '0xs',
      at: T + 1_000,
    }));
    expect(admissionOf(load(), unlisted, D.address, T + 2_000)).toBe('capacity');
  });

  it('refuses while the scheduled run has not listed registrations for too long, or is gone', () => {
    const old = [{ address: 'bc1pold', swap: '0xs', at: T + 1_000 }];
    expect(admissionOf(load(), old, D.address, T + 1_000 + ADMISSION_STALE_MS + 1)).toBe(
      'capacity'
    );
    expect(admissionOf(load(), [], D.address, T + LOAD_MAX_AGE_MS + 1)).toBe('capacity');
  });
});

describe('POST /deposits answers 201 only for what will be watched promptly', () => {
  it('a registration made while the scheduled run is stopped is refused after a while', async () => {
    const w = world();
    const kv = memoryKv();
    await registerDeposit(kv, goodBody('0xswapA'), registerDeps(w));
    await runNotifier(kv, endpoints, w.fetchFn, { now: NOW });
    expect(record(kv)).not.toBeNull();
    const later = new Date(T + 5 * 60_000);
    await registerDeposit(kv, goodBody('0xswapB'), registerDeps(w, { now: later }));
    const stale = new Date(later.getTime() + ADMISSION_STALE_MS + 60_000);
    await expect(
      registerDeposit(kv, goodBody('0xswapC'), registerDeps(w, { now: stale }))
    ).rejects.toThrow(/capacity/);
  });
});
