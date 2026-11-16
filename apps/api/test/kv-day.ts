import { buildDepositAddress, MAINNET_CONFIG as config } from '@satway/core';

import { registerDeposit } from '../src/http/index.js';
import { CRON_PERIOD_MS, runNotifier } from '../src/notifier/index.js';
import {
  INDEX_KEY,
  LOAD_KEY,
  MAX_ACTIVE_WATCHES,
  type Watch,
  emptyIndex,
  loadOf,
} from '../src/store/index.js';
import {
  D,
  EMILY,
  HIRO_KEY_URL,
  type MemoryKv,
  NOW,
  STATUS_URL,
  TIP,
  aggregateKeyResult,
  endpoints,
  jsonRes,
  memoryKv,
  registerConfig,
  swapStatus,
} from './support.js';

export interface KvCounts {
  reads: number;
  writes: number;
  deletes: number;
  lists: number;
}

export interface DayCounts {
  notifier: KvCounts;
  handler: KvCounts;
  registrations: number;
  refused: number;
  finished: number;
  expired: number;
  maxSubrequests: number;
}

const DAY_RUNS = (24 * 60 * 60 * 1000) / CRON_PERIOD_MS;
const ZERO_STACKS = 'SP000000000000000000002Q6VF78';

function counts(kv: MemoryKv, from: number): KvCounts {
  const ops = kv.ops.slice(from);
  return {
    reads: ops.filter(o => o.op === 'get').length,
    writes: ops.filter(o => o.op === 'put').length,
    deletes: ops.filter(o => o.op === 'delete').length,
    lists: ops.filter(o => o.op === 'list').length,
  };
}

function add(a: KvCounts, b: KvCounts): KvCounts {
  return {
    reads: a.reads + b.reads,
    writes: a.writes + b.writes,
    deletes: a.deletes + b.deletes,
    lists: a.lists + b.lists,
  };
}

function depositOf(n: number) {
  return buildDepositAddress({
    stacksAddress: ZERO_STACKS,
    reclaimPublicKey: (n + 1).toString(16).padStart(64, '0'),
    signersPublicKey: D.signerKey,
    maxSignerFeeSats: config.baseSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
  });
}

interface SimDeposit {
  address: string;
  swap: string;
  paidAtMs: number | null;
  txid: string;
}

function txidOf(n: number): string {
  return (n + 1).toString(16).padStart(64, 'a');
}

export interface DayPlan {
  arrivals: number;
  paid: boolean;
  seeded: number;
  seededPaid?: boolean;
}

export async function simulateDay(plan: DayPlan): Promise<DayCounts> {
  const kv = memoryKv();
  const deposits = new Map<string, SimDeposit>();
  const bySwap = new Map<string, SimDeposit>();
  let clock = NOW.getTime();

  function fetchFn(url: string): Promise<Response> {
    if (url === HIRO_KEY_URL) return Promise.resolve(jsonRes(aggregateKeyResult(D.signerKey)));
    if (url.startsWith(`${STATUS_URL}?`)) {
      const swap = new URL(url).searchParams.get('depositAddress') ?? '';
      const d = bySwap.get(swap);
      const paid = d?.paidAtMs !== null && d?.paidAtMs !== undefined && clock >= d.paidAtMs;
      return Promise.resolve(
        jsonRes(
          swapStatus(swap, {
            recipient: d?.address ?? D.address,
            status: paid ? 'SUCCESS' : 'PROCESSING',
            hashes: paid && d ? [d.txid] : [],
            deadline: new Date(clock + 2 * 3_600_000).toISOString(),
          })
        )
      );
    }
    const utxo = /\/address\/([a-z0-9]+)\/utxo$/.exec(url);
    if (utxo?.[1]) {
      const d = deposits.get(utxo[1]);
      const paid = d?.paidAtMs !== null && d?.paidAtMs !== undefined && clock >= d.paidAtMs;
      return Promise.resolve(
        jsonRes(
          paid && d
            ? [
                {
                  txid: d.txid,
                  vout: 0,
                  value: 50_000,
                  status: { confirmed: true, block_height: TIP - 1 },
                },
              ]
            : []
        )
      );
    }
    if (url.endsWith('/blocks/tip/height')) return Promise.resolve(new Response(String(TIP)));
    if (url === `${EMILY}/limits`)
      return Promise.resolve(
        jsonRes({ pegCap: null, perDepositMinimum: 10_000, perDepositCap: null })
      );
    const dep = /\/deposit\/([0-9a-f]{64})\/(\d+)$/.exec(url);
    if (dep?.[1])
      return Promise.resolve(
        jsonRes({
          bitcoinTxid: dep[1],
          bitcoinTxOutputIndex: 0,
          recipient: 'x',
          amount: 50_000,
          status: 'pending',
          reclaimScript: D.reclaimScript,
          depositScript: D.depositScript,
        })
      );
    return Promise.resolve(jsonRes({ message: 'not found' }, 404));
  }

  let serial = 0;
  function newDeposit(paid: boolean, atMs: number): { body: object; sim: SimDeposit } {
    const n = serial++;
    const built = depositOf(n);
    const sim: SimDeposit = {
      address: built.address,
      swap: `0xsim${n}`,
      paidAtMs: paid ? atMs + 30 * 60_000 : null,
      txid: txidOf(n),
    };
    deposits.set(sim.address, sim);
    bySwap.set(sim.swap, sim);
    return {
      body: {
        depositScript: built.depositScript,
        reclaimScript: built.reclaimScript,
        swapDepositAddress: sim.swap,
      },
      sim,
    };
  }

  const seeded: Watch[] = [];
  for (let i = 0; i < plan.seeded; i++) {
    const { sim } = newDeposit(plan.seededPaid === true, clock - 60 * 60_000);
    const built = depositOf(serial - 1);
    const age = Math.floor((i / plan.seeded) * 26 * 3_600_000);
    seeded.push({
      address: sim.address,
      depositScript: built.depositScript,
      reclaimScript: built.reclaimScript,
      createdAt: new Date(clock - age).toISOString(),
      swaps: [
        {
          swapDepositAddress: sim.swap,
          deadline: new Date(clock - age + 2 * 3_600_000).toISOString(),
          createdAt: new Date(clock - age).toISOString(),
        },
      ],
      registered: [],
    });
  }
  if (seeded.length > 0) {
    const index = {
      ...emptyIndex(),
      watches: seeded.sort((a, b) => (a.address < b.address ? -1 : 1)),
      listedAt: clock,
    };
    kv.data.set(INDEX_KEY, JSON.stringify(index));
    kv.data.set(LOAD_KEY, JSON.stringify(loadOf(index)));
  }

  let notifier: KvCounts = { reads: 0, writes: 0, deletes: 0, lists: 0 };
  let handler: KvCounts = { reads: 0, writes: 0, deletes: 0, lists: 0 };
  let registrations = 0;
  let refused = 0;
  let finished = 0;
  let expired = 0;
  let maxSubrequests = 0;
  const every = plan.arrivals > 0 ? DAY_RUNS / plan.arrivals : Number.POSITIVE_INFINITY;
  let nextArrival = 0;
  for (let r = 0; r < DAY_RUNS; r++) {
    clock = NOW.getTime() + r * CRON_PERIOD_MS;
    while (plan.arrivals > 0 && r >= nextArrival) {
      nextArrival += every;
      const from = kv.ops.length;
      const { body } = newDeposit(plan.paid, clock);
      try {
        await registerDeposit(kv, body, {
          config: registerConfig,
          fetchFn,
          now: new Date(clock + 30_000),
          signerState: { memory: null },
          maxWatches: MAX_ACTIVE_WATCHES,
        });
        registrations += 1;
      } catch {
        refused += 1;
      }
      handler = add(handler, counts(kv, from));
    }
    const from = kv.ops.length;
    const report = await runNotifier(kv, endpoints, fetchFn, {
      now: new Date(clock),
      runIndex: 10_000 + r,
      clock: { now: () => 0, deadline: 1e12 },
    });
    notifier = add(notifier, counts(kv, from));
    finished += report.finished.length;
    expired += report.expired.length;
    maxSubrequests = Math.max(maxSubrequests, report.subrequests);
  }
  return { notifier, handler, registrations, refused, finished, expired, maxSubrequests };
}
