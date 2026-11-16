import { describe, expect, it } from 'vitest';

import type { FetchLike } from '@satway/core';

import { registerDeposit } from '../src/http/index.js';
import { runNotifier } from '../src/notifier/index.js';
import { INDEX_KEY, type KV, MAX_PENDING, parseIndex } from '../src/store/index.js';
import { type SimSwap, eventualKv, simWorld } from './sim-world.js';
import { NOW, endpoints, memoryKv, registerConfig } from './support.js';

const MIN = 60_000;

interface Accepted {
  sim: SimSwap;
  at: number;
}

function followedIn(raw: string | null | undefined): Set<string> {
  const index = raw ? parseIndex(raw) : null;
  return new Set(index?.watches.map(w => w.address) ?? []);
}

async function register(kv: KV, body: object, now: number, fetchFn: FetchLike) {
  return registerDeposit(kv, body, {
    config: registerConfig,
    fetchFn,
    now: new Date(now),
    signerState: { memory: null },
  });
}

async function admitted(kv: KV, body: object, now: number, fetchFn: FetchLike) {
  try {
    await register(kv, body, now, fetchFn);
    return true;
  } catch {
    return false;
  }
}

describe('a registration flood', () => {
  it.each([5, 50])(
    'at %i a minute: every 201 is folded and visited within 45 minutes, pending stays bounded',
    async perMinute => {
      let clock = NOW.getTime();
      const w = simWorld(() => clock);
      const kv = memoryKv();
      const accepted: Accepted[] = [];
      const firstSeen = new Map<string, number>();
      let refused = 0;
      let maxPending = 0;
      let maxIndexBytes = 0;
      for (let m = 0; m < 6 * 60; m++) {
        clock = NOW.getTime() + m * MIN;
        if (m < 3 * 60) {
          for (let i = 0; i < perMinute; i++) {
            const victim = i === 0 && m % 30 === 0;
            const { body, sim } = w.newDeposit(victim ? clock + 30 * MIN : null);
            try {
              await register(kv, body, clock, w.fetchFn);
              accepted.push({ sim, at: m });
            } catch {
              refused += 1;
            }
          }
        }
        if (m % 2 === 0) {
          await runNotifier(kv, endpoints, w.fetchFn, {
            now: new Date(clock),
            runIndex: 20_000 + m / 2,
            clock: { now: () => 0, deadline: 1e12 },
          });
          const raw = kv.data.get(INDEX_KEY);
          if (raw !== undefined) {
            maxIndexBytes = Math.max(maxIndexBytes, raw.length);
            const pending = parseIndex(raw)?.pending.length;
            if (pending !== undefined) maxPending = Math.max(maxPending, pending);
          }
          for (const a of followedIn(raw)) if (!firstSeen.has(a)) firstSeen.set(a, m);
        }
      }
      expect(refused).toBeGreaterThan(0);
      expect(accepted.length).toBeGreaterThan(0);
      for (const a of accepted) {
        const seen = firstSeen.get(a.sim.address);
        expect(seen !== undefined && seen - a.at <= 45, `${a.sim.address} at ${a.at}`).toBe(true);
      }
      for (const a of accepted.filter(x => x.sim.paidAtMs !== null)) {
        const tried = w.firstTry.get(a.sim.txid);
        expect(tried).toBeDefined();
        expect(((tried ?? 0) - (a.sim.paidAtMs ?? 0)) / MIN).toBeLessThanOrEqual(45);
      }
      expect(maxPending).toBeLessThanOrEqual(MAX_PENDING);
      expect(maxIndexBytes).toBeLessThan(1_000_000);
    },
    60_000
  );
});

describe('eventually consistent KV, list lag and overlapping runs', () => {
  it.each([
    [1, 150, 90],
    [2, 150, 90],
    [3, 150, 400],
  ])(
    'seed %i (cache %is, list lag %is): every accepted paid deposit is registered promptly',
    async (seed, cacheSeconds, lagSeconds) => {
      let rng = seed;
      function rand(): number {
        rng = (rng * 1103515245 + 12345) % 2147483648;
        return rng / 2147483648;
      }
      let clock = NOW.getTime();
      const kv = eventualKv(() => clock, {
        locations: 3,
        cacheTtlMs: cacheSeconds * 1000,
        listLagMs: lagSeconds * 1000,
      });
      const w = simWorld(() => clock);
      const arrivals = Array.from({ length: 150 }, () => Math.floor(rand() * 20 * 60)).sort(
        (a, b) => a - b
      );
      const accepted: Accepted[] = [];
      let next = 0;
      for (let m = 0; m < 30 * 60; m++) {
        clock = NOW.getTime() + m * MIN;
        for (let due = arrivals[next]; due !== undefined && due <= m; due = arrivals[next]) {
          next += 1;
          const { body, sim } = w.newDeposit(clock + (10 + rand() * 50) * MIN);
          const at = clock + Math.floor(rand() * 59_000);
          if (await admitted(kv.at(Math.floor(rand() * 3)), body, at, w.fetchFn)) {
            accepted.push({ sim, at: m });
          }
          if (rand() < 0.2) {
            const extra = w.extraSwap(sim, body);
            await register(kv.at(Math.floor(rand() * 3)), extra.body, at, w.fetchFn).catch(
              () => null
            );
          }
        }
        if (m % 2 === 0) {
          const location = Math.floor(rand() * 3);
          const runIndex = 30_000 + m / 2;
          const runNow = clock;
          function runAt(loc: number, offset: number) {
            return runNotifier(kv.at(loc), endpoints, w.fetchFn, {
              now: new Date(runNow + offset),
              runIndex,
              clock: { now: () => 0, deadline: 1e12 },
            });
          }
          if (rand() < 0.1) await Promise.all([runAt(location, 0), runAt(location + 1, 1000)]);
          else await runAt(location, 0);
        }
      }
      expect(accepted.length).toBeGreaterThan(100);
      for (const a of accepted) {
        const tried = w.firstTry.get(a.sim.txid);
        expect(tried, `${a.sim.address} accepted at minute ${a.at}`).toBeDefined();
        expect(((tried ?? 0) - (a.sim.paidAtMs ?? 0)) / MIN).toBeLessThanOrEqual(60);
      }
    },
    60_000
  );
});
