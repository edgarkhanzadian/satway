import { describe, expect, it } from 'vitest';

import { RUN_SUBREQUEST_BUDGET } from '../src/store/index.js';
import { type KvCounts, simulateDay } from './kv-day.js';

const FREE = { reads: 100_000, writes: 1_000, deletes: 1_000, lists: 1_000 };
const RUNS_PER_DAY = 720;

function total(a: KvCounts, b: KvCounts): KvCounts {
  return {
    reads: a.reads + b.reads,
    writes: a.writes + b.writes,
    deletes: a.deletes + b.deletes,
    lists: a.lists + b.lists,
  };
}

describe('KV operations over a simulated day', () => {
  it('idle: two small reads a run, a few lists and writes a day', async () => {
    const day = await simulateDay({ arrivals: 0, paid: false, seeded: 0 });
    expect(day.notifier.lists).toBeLessThanOrEqual(5);
    expect(day.notifier.writes).toBeLessThanOrEqual(10);
    expect(day.notifier.deletes).toBe(0);
    expect(day.notifier.reads).toBeLessThanOrEqual(2 * RUNS_PER_DAY);
  });

  it('20 paid deposits: well inside every Free plan limit, and no list on the request path', async () => {
    const day = await simulateDay({ arrivals: 20, paid: true, seeded: 0 });
    const all = total(day.notifier, day.handler);
    expect(day.finished).toBe(20);
    expect(day.handler.lists).toBe(0);
    expect(all.lists).toBeLessThanOrEqual(60);
    expect(all.writes).toBeLessThanOrEqual(200);
    expect(all.deletes).toBeLessThanOrEqual(40);
    expect(all.reads).toBeLessThan(FREE.reads / 20);
  });

  it('20 paid deposits while Emily is down all day: retries back off and stay under the write limit', async () => {
    const day = await simulateDay({ arrivals: 20, paid: true, seeded: 0, emilyDown: true });
    const all = total(day.notifier, day.handler);
    expect(all.writes).toBeLessThanOrEqual(400);
    expect(day.maxSubrequests).toBeLessThanOrEqual(RUN_SUBREQUEST_BUDGET);
  });

  it('320 watches refilled all day: lists, deletes and reads stay under the Free limits, writes do not', async () => {
    const day = await simulateDay({ arrivals: 320, paid: false, seeded: 320 });
    const all = total(day.notifier, day.handler);
    expect(day.handler.lists).toBe(0);
    expect(day.maxSubrequests).toBeLessThanOrEqual(RUN_SUBREQUEST_BUDGET);
    expect(all.lists).toBeLessThan(FREE.lists / 2);
    expect(all.deletes).toBeLessThan(FREE.deletes);
    expect(all.reads).toBeLessThan(FREE.reads / 10);
    expect(all.writes).toBeGreaterThan(FREE.writes);
    expect(all.writes).toBeLessThan(2 * FREE.writes);
  });
});
