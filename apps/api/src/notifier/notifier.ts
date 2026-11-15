import {
  type AddressOutput,
  type FetchLike,
  type NetworkConfig,
  type PriorOutputs,
  depositAddressFromScripts,
  errorMessage,
  fetchDeposit,
  fetchLimits,
  fetchTipHeight,
  fetchUnspentOutputs,
  isPriorOutput,
  notifyDeposit,
  outpointOf,
  outputsToRegister,
  priorOutputsOf,
} from '@portage/core';

import {
  CRON_PERIOD_MINUTES,
  IDLE_ADDRESS_COST,
  type KV,
  MAX_ADDRESSES_PER_RUN,
  PAYOUT_GRACE_HOURS,
  RECORD_WRITE_COST,
  REGISTRATION_COST,
  RUN_SUBREQUEST_BUDGET,
  type RegisteredOutput,
  SHARED_LOOKUP_COST,
  type WatchedDeposit,
  deleteWatched,
  listWatchedAddresses,
  loadWatched,
  putWatched,
  registrationsOf,
} from '../store/index.js';
import { Budget, BudgetExhausted, countedFetch, countedKv } from './budget.js';

type Endpoints = Pick<NetworkConfig, 'btcApiUrl' | 'sbtcApiUrl' | 'reclaimLockBlocks'>;

export const PAYOUT_GRACE_MS = PAYOUT_GRACE_HOURS * 60 * 60 * 1000;
export const CRON_PERIOD_MS = CRON_PERIOD_MINUTES * 60 * 1000;

export interface NotifierReport {
  watched: number;
  runIndex: number;
  processed: number;
  skipped: number;
  subrequests: number;
  budget: number;
  notified: { address: string; txid: string; vout: number }[];
  finished: string[];
  expired: string[];
  deferred: string[];
  errors: { address: string; outpoint?: string; message: string }[];
}

export interface NotifierOptions {
  now?: Date;
  runIndex?: number;
  budget?: number;
  maxAddresses?: number;
}

interface Shared {
  minimum(): Promise<number | null>;
  tip(): Promise<number | null>;
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load();
    return pending;
  };
}

function eligibleFor(output: RegisteredOutput, prior: PriorOutputs): boolean {
  const [txid = '', voutText = ''] = output.outpoint.split(':');
  return !isPriorOutput(
    { txid, vout: Number(voutText), confirmed: output.confirmed, blockTime: output.blockTime },
    prior
  );
}

export function watchSatisfied(deposit: WatchedDeposit): boolean {
  const known = deposit.registered ?? [];
  const regs = [...registrationsOf(deposit)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const used = new Set<string>();
  for (const reg of regs) {
    const prior = priorOutputsOf({
      createdAt: reg.createdAt,
      priorOutpoints: reg.priorOutpoints ?? undefined,
      priorTruncated: reg.priorTruncated,
    });
    const match = known.find(o => !used.has(o.outpoint) && eligibleFor(o, prior));
    if (!match) return false;
    used.add(match.outpoint);
  }
  return true;
}

export function watchExpired(deposit: WatchedDeposit, now: Date): boolean {
  return registrationsOf(deposit).every(r => {
    if (r.deadline === undefined) return false;
    const deadline = Date.parse(r.deadline);
    return Number.isFinite(deadline) && deadline + PAYOUT_GRACE_MS < now.getTime();
  });
}

export function rotationWindow<T>(items: readonly T[], runIndex: number, size: number): T[] {
  if (items.length <= size) return [...items];
  const start = (((runIndex * size) % items.length) + items.length) % items.length;
  return Array.from({ length: size }, (_, i) => items[(start + i) % items.length]).filter(
    item => item !== undefined
  );
}

function registeredFrom(o: AddressOutput): RegisteredOutput {
  return { outpoint: outpointOf(o), confirmed: o.confirmed, blockTime: o.blockTime };
}

interface RunContext {
  kv: KV;
  config: Endpoints;
  shared: Shared;
  report: NotifierReport;
  fetchFn: FetchLike;
  budget: Budget;
  now: Date;
}

async function watchAddress(
  ctx: RunContext,
  address: string,
  deposit: WatchedDeposit
): Promise<void> {
  const { kv, config, report, fetchFn, budget } = ctx;
  const derived = depositAddressFromScripts(deposit.depositScript, deposit.reclaimScript);
  if (derived.address !== address) {
    await deleteWatched(kv, address);
    throw new Error('Stored scripts do not match the stored address; record dropped');
  }
  const priors = registrationsOf(deposit).map(r =>
    priorOutputsOf({
      createdAt: r.createdAt,
      priorOutpoints: r.priorOutpoints ?? undefined,
      priorTruncated: r.priorTruncated,
    })
  );
  const registered = new Map((deposit.registered ?? []).map(r => [r.outpoint, r]));
  const unspent = await fetchUnspentOutputs(config.btcApiUrl, derived.address, fetchFn);

  function isPrior(o: AddressOutput): boolean {
    return priors.every(p => isPriorOutput(o, p));
  }
  const fresh = unspent.filter(o => !isPrior(o) && !registered.has(outpointOf(o)));
  let pending = false;
  if (fresh.length > 0) {
    if (budget.remaining() < SHARED_LOOKUP_COST + REGISTRATION_COST + RECORD_WRITE_COST) {
      report.deferred.push(address);
      return;
    }
    const minimum = await ctx.shared.minimum();
    if (minimum === null) {
      report.errors.push({ address, message: 'Could not read the sBTC deposit minimum' });
      return;
    }
    const all = outputsToRegister(fresh, {
      isPrior,
      minimumSats: minimum,
      tipHeight: await ctx.shared.tip(),
      reclaimLockBlocks: config.reclaimLockBlocks,
    });
    const affordable = Math.max(
      0,
      Math.floor((budget.remaining() - RECORD_WRITE_COST) / REGISTRATION_COST)
    );
    const candidates = all.slice(0, affordable);
    if (candidates.length < all.length) report.deferred.push(address);
    for (const output of candidates) {
      const outpoint = outpointOf(output);
      try {
        const known = await fetchDeposit(config.sbtcApiUrl, output.txid, output.vout, fetchFn);
        if (!known) {
          await notifyDeposit(
            config,
            {
              bitcoinTxid: output.txid,
              bitcoinTxOutputIndex: output.vout,
              depositScript: deposit.depositScript,
              reclaimScript: deposit.reclaimScript,
            },
            fetchFn
          );
          report.notified.push({ address, txid: output.txid, vout: output.vout });
        }
        registered.set(outpoint, registeredFrom(output));
      } catch (err) {
        if (err instanceof BudgetExhausted) throw err;
        report.errors.push({
          address,
          outpoint,
          message: `Registering ${outpoint} with the sBTC API failed: ${errorMessage(err) ?? String(err)}`,
        });
      }
    }
    pending = all.some(o => !registered.has(outpointOf(o)));
  }

  const next: WatchedDeposit = { ...deposit, registered: [...registered.values()] };
  if (!pending && watchSatisfied(next)) {
    await deleteWatched(kv, address);
    report.finished.push(address);
    return;
  }
  if (!pending && watchExpired(next, ctx.now)) {
    await deleteWatched(kv, address);
    report.expired.push(address);
    return;
  }
  if (registered.size !== (deposit.registered ?? []).length) {
    await putWatched(kv, address, next, ctx.now);
  }
}

function sharedLookups(config: Endpoints, fetchFn: FetchLike): Shared {
  return {
    minimum: once(async () => {
      try {
        return (await fetchLimits(config.sbtcApiUrl, fetchFn)).perDepositMinimum;
      } catch {
        return null;
      }
    }),
    tip: once(async () => {
      try {
        return await fetchTipHeight(config.btcApiUrl, fetchFn);
      } catch {
        return null;
      }
    }),
  };
}

export async function runNotifier(
  rawKv: KV,
  config: Endpoints,
  fetchFn?: FetchLike,
  options: NotifierOptions = {}
): Promise<NotifierReport> {
  const now = options.now ?? new Date();
  const runIndex = options.runIndex ?? Math.floor(now.getTime() / CRON_PERIOD_MS);
  const budget = new Budget(
    Math.min(options.budget ?? RUN_SUBREQUEST_BUDGET, RUN_SUBREQUEST_BUDGET)
  );
  const kv = countedKv(rawKv, budget);
  const fetching = countedFetch(fetchFn, budget);
  const report: NotifierReport = {
    watched: 0,
    runIndex,
    processed: 0,
    skipped: 0,
    subrequests: 0,
    budget: budget.max,
    notified: [],
    finished: [],
    expired: [],
    deferred: [],
    errors: [],
  };
  const ctx: RunContext = {
    kv,
    config,
    shared: sharedLookups(config, fetching),
    report,
    fetchFn: fetching,
    budget,
    now,
  };

  let addresses: string[] = [];
  try {
    addresses = (await listWatchedAddresses(kv)).addresses;
  } catch (err) {
    report.errors.push({ address: '*', message: errorMessage(err) ?? String(err) });
  }
  report.watched = addresses.length;
  const window = rotationWindow(
    addresses,
    runIndex,
    Math.min(options.maxAddresses ?? MAX_ADDRESSES_PER_RUN, MAX_ADDRESSES_PER_RUN)
  );
  report.skipped = addresses.length - window.length;

  for (const [i, address] of window.entries()) {
    if (budget.remaining() < IDLE_ADDRESS_COST + RECORD_WRITE_COST) {
      report.skipped += window.length - i;
      break;
    }
    try {
      const { deposit, broken } = await loadWatched(kv, address);
      if (broken) await deleteWatched(kv, address);
      report.processed += 1;
      if (deposit) await watchAddress(ctx, address, deposit);
    } catch (err) {
      report.errors.push({ address, message: errorMessage(err) ?? String(err) });
      if (err instanceof BudgetExhausted) {
        report.skipped += window.length - i - 1;
        break;
      }
    }
  }
  report.subrequests = budget.used;
  return report;
}
