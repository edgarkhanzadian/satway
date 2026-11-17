import {
  type AddressOutput,
  type FetchLike,
  type NetworkConfig,
  OneClickClient,
  type OneClickStatusResponse,
  classifyRegistrationError,
  depositAddressFromScripts,
  destinationTxHashesOf,
  errorMessage,
  fetchDeposit,
  fetchLimits,
  fetchTipHeight,
  fetchTransaction,
  fetchUnspentOutputs,
  notifyDeposit,
  outpointOf,
  outputsToRegister,
} from '@satway/core';

import {
  CRON_PERIOD_MINUTES,
  ENDED_MEMORY_HOURS,
  FOLD_COST,
  type KV,
  LIST_BACKSTOP_HOURS,
  LIST_MAX_GAP_MINUTES,
  LIST_MIN_GAP_MINUTES,
  LIST_SETTLE_MINUTES,
  LOAD_HEARTBEAT_HOURS,
  LOAD_REFRESH_MINUTES,
  MAX_ACTIVE_WATCHES,
  MAX_ADDRESSES_PER_RUN,
  MAX_LIST_PAGES_PER_RUN,
  MAX_PENDING,
  MAX_SETTLE_LOOKUPS,
  MAX_SWAPS_FOLLOWED,
  MAX_SWAPS_PER_WATCH,
  MAX_UNFOLDED_ADMITTED,
  PAYOUT_GRACE_HOURS,
  PERSIST_COST,
  type PendingName,
  REGISTRATION_COST,
  RETRY_FIRST_MINUTES,
  RETRY_MAX_MINUTES,
  RUN_SUBREQUEST_BUDGET,
  type Rotation,
  SETTLE_LOOKUP_COST,
  SHARED_LOOKUP_COST,
  STUCK_OUTPUT_GRACE_HOURS,
  SWAP_STATUS_COST,
  VISIT_COST,
  WORK_RESERVE,
  type Watch,
  type WatchIndex,
  type WatchLoad,
  type WatchSwap,
  deleteRegistration,
  emptyIndex,
  getIndex,
  getRecent,
  getRegistration,
  listRegistrations,
  loadOf,
  putIndex,
  putLoad,
  registrationKey,
  registrationKeyParts,
} from '../store/index.js';
import {
  Budget,
  BudgetExhausted,
  type RunClock,
  countedFetch,
  countedKv,
  runClock,
} from './budget.js';

type Endpoints = Pick<
  NetworkConfig,
  'btcApiUrl' | 'sbtcApiUrl' | 'reclaimLockBlocks' | 'oneClickBaseUrl'
>;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
export const PAYOUT_GRACE_MS = PAYOUT_GRACE_HOURS * HOUR_MS;
export const STUCK_OUTPUT_GRACE_MS = STUCK_OUTPUT_GRACE_HOURS * HOUR_MS;
export const CRON_PERIOD_MS = CRON_PERIOD_MINUTES * MINUTE_MS;
export const LIST_MIN_GAP_MS = LIST_MIN_GAP_MINUTES * MINUTE_MS;
export const LIST_SETTLE_MS = LIST_SETTLE_MINUTES * MINUTE_MS;
export const LIST_MAX_GAP_MS = LIST_MAX_GAP_MINUTES * MINUTE_MS;
export const LIST_BACKSTOP_MS = LIST_BACKSTOP_HOURS * HOUR_MS;
export const ENDED_MEMORY_MS = ENDED_MEMORY_HOURS * HOUR_MS;
export const LOAD_REFRESH_MS = LOAD_REFRESH_MINUTES * MINUTE_MS;
export const LOAD_HEARTBEAT_MS = LOAD_HEARTBEAT_HOURS * HOUR_MS;

export interface NotifierReport {
  watched: number;
  runIndex: number;
  processed: number;
  skipped: number;
  subrequests: number;
  budget: number;
  listed: number;
  folded: number;
  pending: number;
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
  clock?: RunClock;
  oneClickJwt?: string;
}

export function deadlinePassed(deadline: string, now: Date): boolean {
  const ms = Date.parse(deadline);
  return Number.isFinite(ms) && ms + PAYOUT_GRACE_MS < now.getTime();
}

export type SwapReading = OneClickStatusResponse | 'expired' | null;

function pays(outpoint: string, txids: readonly string[]): boolean {
  return txids.some(txid => outpoint.startsWith(`${txid}:`));
}

export function swapsFinal(
  readings: readonly SwapReading[],
  registered: readonly string[],
  followed: number
): boolean {
  const named = readings.flatMap(r =>
    r !== null && r !== 'expired' && r.status === 'SUCCESS' ? destinationTxHashesOf(r) : []
  );
  const unclaimed = registered.filter(op => !pays(op, named));
  const unnamed = readings.filter(
    r =>
      r !== null &&
      r !== 'expired' &&
      r.status === 'SUCCESS' &&
      destinationTxHashesOf(r).length === 0
  ).length;
  return readings.every(r => {
    if (r === 'expired') return true;
    if (r === null) return false;
    if (r.status === 'REFUNDED' || r.status === 'FAILED') return true;
    if (r.status !== 'SUCCESS') return false;
    const hashes = destinationTxHashesOf(r);
    if (hashes.length > 0) return registered.some(op => pays(op, hashes));
    if (followed === 1) return registered.length > 0;
    return unclaimed.length >= Math.max(1, unnamed);
  });
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function rotationStart(rotation: Rotation, runIndex: number, size: number, count: number) {
  if (count === 0) return 0;
  const steps = Math.max(0, runIndex - rotation.run - 1);
  return mod(rotation.at + steps * size, count);
}

export function rotationWindow<T>(items: readonly T[], start: number, size: number): T[] {
  const length = Math.min(size, items.length);
  return Array.from({ length }, (_, i) => items[mod(start + i, items.length)]).filter(
    item => item !== undefined
  );
}

interface Visit {
  watch: Watch;
  unspent: AddressOutput[] | null;
  pending: boolean;
}

interface RunContext {
  kv: KV;
  config: Endpoints;
  index: WatchIndex;
  report: NotifierReport;
  fetchFn: FetchLike;
  budget: Budget;
  now: Date;
  runIndex: number;
  oneClickJwt?: string;
  reserve: number;
  dirty: boolean;
}

function message(err: unknown): string {
  return errorMessage(err) ?? String(err);
}

function blockingFor(index: WatchIndex, address: string): string[] {
  return index.queue.filter(e => e.address === address && !e.refused).map(e => e.outpoint);
}

export function retryDelayMs(attempts: number): number {
  if (attempts <= 1) return 0;
  const minutes = RETRY_FIRST_MINUTES * 2 ** (attempts - 2);
  return Math.min(RETRY_MAX_MINUTES, minutes) * MINUTE_MS;
}

function pastStuckBound(watch: Watch, now: Date): boolean {
  return watch.swaps.every(s => {
    const ms = Date.parse(s.deadline);
    return !Number.isFinite(ms) || ms + PAYOUT_GRACE_MS + STUCK_OUTPUT_GRACE_MS < now.getTime();
  });
}

function listDueAt(index: WatchIndex, nowMs: number, registeredAt: number | null): boolean {
  if (index.listCursor !== null || index.listedAt === null) return true;
  const since = nowMs - index.listedAt;
  if (since >= LIST_BACKSTOP_MS) return true;
  if (registeredAt === null || since < LIST_MIN_GAP_MS) return false;
  const settledAt = registeredAt + LIST_SETTLE_MS;
  return index.listedAt < settledAt && (nowMs >= settledAt || since >= LIST_MAX_GAP_MS);
}

async function listDue(ctx: RunContext): Promise<boolean> {
  const { index } = ctx;
  const nowMs = ctx.now.getTime();
  if (listDueAt(index, nowMs, null)) return true;
  if (index.listedAt !== null && nowMs - index.listedAt < LIST_MIN_GAP_MS) return false;
  try {
    const recent = await getRecent(ctx.kv);
    const latest = recent.reduce<number | null>(
      (m, r) => (m === null || r.at > m ? r.at : m),
      null
    );
    return listDueAt(index, nowMs, latest);
  } catch (err) {
    ctx.report.errors.push({ address: '*', message: message(err) });
    return false;
  }
}

async function visit(
  ctx: RunContext,
  watches: readonly Watch[]
): Promise<{
  visits: Visit[];
  stopped: boolean;
}> {
  const visits: Visit[] = [];
  for (const watch of watches) {
    if (ctx.budget.remaining() < VISIT_COST + ctx.reserve) return { visits, stopped: true };
    try {
      const unspent = await fetchUnspentOutputs(ctx.config.btcApiUrl, watch.address, ctx.fetchFn);
      visits.push({ watch, unspent, pending: false });
    } catch (err) {
      ctx.report.errors.push({ address: watch.address, message: message(err) });
      if (err instanceof BudgetExhausted) return { visits, stopped: true };
      visits.push({ watch, unspent: null, pending: true });
    }
  }
  return { visits, stopped: false };
}

interface Shared {
  minimum: number | null;
  tip: number | null;
}

async function orNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return null;
  }
}

async function sharedLookups(ctx: RunContext): Promise<Shared> {
  const minimum = await orNull(
    async () => (await fetchLimits(ctx.config.sbtcApiUrl, ctx.fetchFn)).perDepositMinimum
  );
  const tip = await orNull(() => fetchTipHeight(ctx.config.btcApiUrl, ctx.fetchFn));
  return { minimum, tip };
}

async function refreshQueue(ctx: RunContext, visits: Visit[]): Promise<void> {
  const fresh = visits.flatMap(v => {
    if (v.unspent === null) return [];
    const registered = new Set(v.watch.registered);
    const outputs = v.unspent.filter(o => !registered.has(outpointOf(o)));
    return [{ v, outputs }];
  });
  const needsShared = fresh.some(f => f.outputs.length > 0);
  let shared: Shared = { minimum: null, tip: null };
  if (needsShared) {
    if (ctx.budget.remaining() < SHARED_LOOKUP_COST + ctx.reserve) {
      for (const f of fresh) {
        if (f.outputs.length > 0) {
          f.v.pending = true;
          ctx.report.deferred.push(f.v.watch.address);
        }
      }
      return;
    }
    shared = await sharedLookups(ctx);
  }
  for (const { v, outputs } of fresh) {
    if (outputs.length > 0 && shared.minimum === null) {
      v.pending = true;
      ctx.report.errors.push({
        address: v.watch.address,
        message: 'Could not read the sBTC deposit minimum',
      });
      continue;
    }
    const eligible = outputsToRegister(outputs, {
      minimumSats: shared.minimum,
      tipHeight: shared.tip,
      reclaimLockBlocks: ctx.config.reclaimLockBlocks,
      limit: Number.POSITIVE_INFINITY,
    }).map(outpointOf);
    setQueued(ctx, v.watch.address, eligible);
  }
}

function setQueued(ctx: RunContext, address: string, eligible: readonly string[]): void {
  const { index } = ctx;
  const wanted = new Set(eligible);
  const kept = index.queue.filter(e => e.address !== address || wanted.has(e.outpoint));
  const have = new Set(kept.filter(e => e.address === address).map(e => e.outpoint));
  const added = eligible
    .filter(op => !have.has(op))
    .map(outpoint => ({ address, outpoint, attempts: 0, nextAt: 0, refused: false }));
  if (kept.length !== index.queue.length || added.length > 0) {
    index.queue = [...kept, ...added];
    ctx.dirty = true;
  }
}

async function registerQueued(ctx: RunContext): Promise<void> {
  const { index, report, config } = ctx;
  const nowMs = ctx.now.getTime();
  for (const entry of [...index.queue]) {
    const watch = index.watches.find(w => w.address === entry.address);
    if (!watch) {
      index.queue = index.queue.filter(e => e !== entry);
      ctx.dirty = true;
      continue;
    }
    if (entry.nextAt > nowMs) continue;
    if (ctx.budget.remaining() < REGISTRATION_COST + ctx.reserve) {
      if (!report.deferred.includes(watch.address)) report.deferred.push(watch.address);
      return;
    }
    const parts = entry;
    const [txid = '', vout = ''] = parts.outpoint.split(':');
    try {
      const known = await fetchDeposit(config.sbtcApiUrl, txid, Number(vout), ctx.fetchFn);
      if (!known) {
        await notifyDeposit(
          config,
          {
            bitcoinTxid: txid,
            bitcoinTxOutputIndex: Number(vout),
            depositScript: watch.depositScript,
            reclaimScript: watch.reclaimScript,
          },
          ctx.fetchFn
        );
        report.notified.push({ address: watch.address, txid, vout: Number(vout) });
      }
      watch.registered = [...new Set([...watch.registered, parts.outpoint])].sort();
      index.queue = index.queue.filter(e => e !== entry);
    } catch (err) {
      if (err instanceof BudgetExhausted) throw err;
      report.errors.push({
        address: watch.address,
        outpoint: parts.outpoint,
        message: `Registering ${parts.outpoint} with the sBTC API failed: ${message(err)}`,
      });
      const attempts = entry.attempts + 1;
      const refused = classifyRegistrationError(err, config.sbtcApiUrl).kind === 'rejected';
      index.queue = [
        ...index.queue.filter(e => e !== entry),
        { ...entry, attempts, nextAt: nowMs + retryDelayMs(attempts), refused },
      ];
    }
    ctx.dirty = true;
  }
}

async function readSwap(ctx: RunContext, swap: WatchSwap): Promise<SwapReading> {
  if (deadlinePassed(swap.deadline, ctx.now)) return 'expired';
  const client = new OneClickClient(ctx.config.oneClickBaseUrl, {
    jwt: ctx.oneClickJwt,
    fetchFn: ctx.fetchFn,
  });
  try {
    return await client.status(swap.swapDepositAddress);
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return null;
  }
}

type WatchEnd = 'finished' | 'expired' | 'deferred' | null;

export function settledInView(
  registered: readonly string[],
  unspent: readonly AddressOutput[] | null
): { settled: string[]; unseen: string[] } {
  const seen = new Map((unspent ?? []).map(o => [outpointOf(o), o.confirmed]));
  return {
    settled: registered.filter(op => seen.get(op) === true),
    unseen: registered.filter(op => !seen.has(op)),
  };
}

async function settledOutpoints(
  ctx: RunContext,
  watch: Watch,
  unspent: readonly AddressOutput[] | null
): Promise<string[] | 'deferred'> {
  const { settled, unseen } = settledInView(watch.registered, unspent);
  const txids = [...new Set(unseen.map(txidOfOutpoint))].slice(0, MAX_SETTLE_LOOKUPS);
  const confirmed = new Set<string>();
  for (const txid of txids) {
    if (ctx.budget.remaining() < SETTLE_LOOKUP_COST + watch.swaps.length + ctx.reserve) {
      return 'deferred';
    }
    const tx = await orNull(() => fetchTransaction(ctx.config.btcApiUrl, txid, ctx.fetchFn));
    if (tx?.status.confirmed === true) confirmed.add(txid);
  }
  return [...settled, ...unseen.filter(op => confirmed.has(txidOfOutpoint(op)))];
}

function txidOfOutpoint(outpoint: string): string {
  const [txid = ''] = outpoint.split(':');
  return txid;
}

async function watchEnd(
  ctx: RunContext,
  watch: Watch,
  unspent: readonly AddressOutput[] | null
): Promise<WatchEnd> {
  const live = watch.swaps.filter(s => !deadlinePassed(s.deadline, ctx.now));
  if (live.length === 0) {
    if (ctx.budget.remaining() < watch.swaps.length + ctx.reserve) return 'deferred';
    return watch.registered.length > 0 ? 'finished' : 'expired';
  }
  if (watch.registered.length === 0) return null;
  const read = new Set(live.slice(0, MAX_SWAPS_PER_WATCH));
  const cost = read.size * SWAP_STATUS_COST + watch.swaps.length;
  if (ctx.budget.remaining() < cost + ctx.reserve) return 'deferred';
  const readings: SwapReading[] = [];
  for (const swap of watch.swaps) {
    const unread = !read.has(swap) && !deadlinePassed(swap.deadline, ctx.now);
    readings.push(unread ? null : await readSwap(ctx, swap));
  }
  if (!swapsFinal(readings, watch.registered, watch.swaps.length)) return null;
  const settled = await settledOutpoints(ctx, watch, unspent);
  if (settled === 'deferred') return 'deferred';
  return swapsFinal(readings, settled, watch.swaps.length) ? 'finished' : null;
}

async function endWatch(ctx: RunContext, watch: Watch): Promise<void> {
  const { index } = ctx;
  const forget = ctx.now.getTime() + ENDED_MEMORY_MS;
  for (const swap of watch.swaps) {
    const name = registrationKey(watch.address, swap.swapDepositAddress);
    index.ended[name] = forget;
    try {
      await deleteRegistration(ctx.kv, name);
    } catch (err) {
      if (err instanceof BudgetExhausted) throw err;
      ctx.report.errors.push({ address: watch.address, message: message(err) });
    }
  }
  index.watches = index.watches.filter(w => w.address !== watch.address);
  index.queue = index.queue.filter(e => e.address !== watch.address);
  ctx.dirty = true;
}

async function endWatches(ctx: RunContext, visits: readonly Visit[]): Promise<void> {
  const candidates = visits.filter(
    v =>
      pastStuckBound(v.watch, ctx.now) ||
      (!v.pending && blockingFor(ctx.index, v.watch.address).length === 0)
  );
  const offset = candidates.length === 0 ? 0 : mod(ctx.runIndex, candidates.length);
  const ordered = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  for (const { watch, unspent } of ordered) {
    const end = await watchEnd(ctx, watch, unspent);
    if (end === 'deferred') ctx.report.deferred.push(watch.address);
    if (end === 'finished' || end === 'expired') {
      await endWatch(ctx, watch);
      ctx.report[end].push(watch.address);
    }
  }
}

function followedNames(index: WatchIndex): Set<string> {
  return new Set(
    index.watches.flatMap(w => w.swaps.map(s => registrationKey(w.address, s.swapDepositAddress)))
  );
}

function byPendingAge(a: PendingName, b: PendingName): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

function addPending(ctx: RunContext, names: readonly PendingName[]): void {
  const { index } = ctx;
  const nowMs = ctx.now.getTime();
  const followed = followedNames(index);
  const pending = new Set(index.pending.map(p => p.name));
  const added: PendingName[] = [];
  for (const entry of names) {
    const { name } = entry;
    const forgetAt = index.ended[name];
    if (forgetAt !== undefined && forgetAt > nowMs) continue;
    if (followed.has(name) || pending.has(name) || registrationKeyParts(name) === null) continue;
    if (entry.deadline + PAYOUT_GRACE_MS + STUCK_OUTPUT_GRACE_MS < nowMs) continue;
    pending.add(name);
    added.push(entry);
  }
  if (added.length === 0) return;
  index.pending = [...index.pending, ...added].sort(byPendingAge).slice(0, MAX_PENDING);
  ctx.dirty = true;
}

async function list(ctx: RunContext): Promise<void> {
  const { index } = ctx;
  for (let page = 0; page < MAX_LIST_PAGES_PER_RUN; page++) {
    if (ctx.budget.remaining() < 1 + PERSIST_COST) return;
    const { names, cursor } = await listRegistrations(ctx.kv, index.listCursor);
    ctx.report.listed += 1;
    addPending(ctx, names);
    index.listCursor = cursor;
    ctx.dirty = true;
    if (cursor === null) {
      index.listedAt = ctx.now.getTime();
      return;
    }
  }
}

function scriptsMatch(address: string, depositScript: string, reclaimScript: string): boolean {
  try {
    return depositAddressFromScripts(depositScript, reclaimScript).address === address;
  } catch {
    return false;
  }
}

type Drop = 'folded' | 'missing' | { reason: string };

async function drop(ctx: RunContext, name: string, how: Drop): Promise<null> {
  const { index } = ctx;
  index.pending = index.pending.filter(n => n.name !== name);
  ctx.dirty = true;
  if (how === 'folded') return null;
  index.ended[name] = ctx.now.getTime() + ENDED_MEMORY_MS;
  if (how === 'missing') return null;
  await deleteRegistration(ctx.kv, name);
  const parts = registrationKeyParts(name);
  ctx.report.errors.push({ address: parts?.address ?? name, message: how.reason });
  return null;
}

function byCreated(a: WatchSwap, b: WatchSwap): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    a.swapDepositAddress.localeCompare(b.swapDepositAddress)
  );
}

async function foldOne(ctx: RunContext, name: string): Promise<Watch | null> {
  const { index } = ctx;
  const parts = registrationKeyParts(name);
  if (!parts) return drop(ctx, name, 'missing');
  const { registration: reg, broken } = await getRegistration(ctx.kv, name);
  if (broken) return drop(ctx, name, { reason: 'Unreadable registration; dropped' });
  if (!reg) return drop(ctx, name, 'missing');
  if (
    reg.swapDepositAddress !== parts.swapDepositAddress ||
    !scriptsMatch(parts.address, reg.depositScript, reg.reclaimScript)
  ) {
    return drop(ctx, name, {
      reason: 'Stored scripts do not match the stored address; registration dropped',
    });
  }
  const swap: WatchSwap = {
    swapDepositAddress: reg.swapDepositAddress,
    deadline: reg.deadline,
    createdAt: reg.createdAt,
  };
  const existing = index.watches.find(w => w.address === parts.address);
  if (existing) {
    if (existing.swaps.some(s => s.swapDepositAddress === swap.swapDepositAddress)) {
      return drop(ctx, name, 'folded');
    }
    if (existing.swaps.length >= MAX_SWAPS_FOLLOWED) {
      return drop(ctx, name, {
        reason: 'The address already follows as many swaps as the Worker can hold',
      });
    }
    existing.swaps = [...existing.swaps, swap].sort(byCreated);
    ctx.report.folded += 1;
    return drop(ctx, name, 'folded');
  }
  if (index.watches.length >= MAX_ACTIVE_WATCHES) return null;
  const watch: Watch = {
    address: parts.address,
    depositScript: reg.depositScript,
    reclaimScript: reg.reclaimScript,
    createdAt: reg.createdAt,
    swaps: [swap],
    registered: [],
  };
  index.watches = [...index.watches, watch].sort(byAddress);
  ctx.report.folded += 1;
  await drop(ctx, name, 'folded');
  return watch;
}

function byAddress(a: Watch, b: Watch): number {
  if (a.address === b.address) return 0;
  return a.address < b.address ? -1 : 1;
}

async function fold(ctx: RunContext): Promise<Watch[]> {
  const created: Watch[] = [];
  for (const entry of [...ctx.index.pending]) {
    if (ctx.budget.remaining() < FOLD_COST + WORK_RESERVE) break;
    const parts = registrationKeyParts(entry.name);
    const followed = parts !== null && ctx.index.watches.some(w => w.address === parts.address);
    if (!followed && ctx.index.watches.length >= MAX_ACTIVE_WATCHES) continue;
    const watch = await foldOne(ctx, entry.name);
    if (watch) created.push(watch);
  }
  return created;
}

function nextStartAddress(
  watches: readonly Watch[],
  start: number,
  visited: number,
  window: number
): string | null {
  if (watches.length === 0) return null;
  const step = visited < window ? visited : window;
  return watches[mod(start + step, watches.length)]?.address ?? null;
}

function rotationAfter(index: WatchIndex, next: string | null, runIndex: number): Rotation {
  if (next === null || index.watches.length === 0) return { at: 0, run: runIndex };
  const at = index.watches.findIndex(w => w.address >= next);
  return { at: at < 0 ? 0 : at, run: runIndex };
}

function loadHashOf(load: WatchLoad): string {
  return JSON.stringify([load.counts, load.pending, load.listedAt]);
}

function loadDue(index: WatchIndex, load: WatchLoad, nowMs: number): boolean {
  if (index.loadAt === null || nowMs - index.loadAt >= LOAD_HEARTBEAT_MS) return true;
  if (loadHashOf(load) === index.loadHash) return false;
  if (nowMs - index.loadAt >= LOAD_REFRESH_MS) return true;
  return (
    load.pending >= MAX_UNFOLDED_ADMITTED / 2 ||
    Object.keys(load.counts).length >= MAX_ACTIVE_WATCHES - 2 * MAX_ADDRESSES_PER_RUN
  );
}

function pruneEnded(index: WatchIndex, nowMs: number): void {
  for (const [name, forgetAt] of Object.entries(index.ended)) {
    if (forgetAt <= nowMs) Reflect.deleteProperty(index.ended, name);
  }
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
  const fetching = countedFetch(fetchFn, budget, options.clock ?? runClock());
  const report: NotifierReport = {
    watched: 0,
    runIndex,
    processed: 0,
    skipped: 0,
    subrequests: 0,
    budget: budget.max,
    listed: 0,
    folded: 0,
    pending: 0,
    notified: [],
    finished: [],
    expired: [],
    deferred: [],
    errors: [],
  };

  let loaded: Awaited<ReturnType<typeof getIndex>>;
  try {
    loaded = await getIndex(kv);
  } catch (err) {
    report.errors.push({ address: '*', message: message(err) });
    report.subrequests = budget.used;
    return report;
  }
  const index = loaded.index ?? emptyIndex();
  const ctx: RunContext = {
    kv,
    config,
    index,
    report,
    fetchFn: fetching,
    budget,
    now,
    runIndex,
    oneClickJwt: options.oneClickJwt,
    reserve: PERSIST_COST,
    dirty: loaded.broken,
  };

  const size = Math.max(
    0,
    Math.min(options.maxAddresses ?? MAX_ADDRESSES_PER_RUN, MAX_ADDRESSES_PER_RUN)
  );
  const before = [...index.watches];
  const startAddress =
    before[rotationStart(index.rotation, runIndex, size, before.length)]?.address ?? null;

  const folded: Watch[] = [];
  try {
    if (await listDue(ctx)) await list(ctx);
  } catch (err) {
    report.errors.push({ address: '*', message: message(err) });
    if (index.listCursor !== null) {
      index.listCursor = null;
      ctx.dirty = true;
    }
  }
  try {
    folded.push(...(await fold(ctx)));
  } catch (err) {
    report.errors.push({ address: '*', message: message(err) });
  }

  const watches = [...index.watches];
  report.watched = watches.length;
  const start = startAddress === null ? 0 : rotationAfter(index, startAddress, runIndex).at;
  const window = rotationWindow(watches, start, size);
  const extra = folded.filter(w => !window.includes(w));
  const planned = await visit(ctx, window);
  const fresh = planned.stopped ? { visits: [], stopped: true } : await visit(ctx, extra);
  const visits = [...planned.visits, ...fresh.visits];
  const stopped = planned.stopped;
  report.processed = visits.length;
  report.skipped = Math.max(0, watches.length - visits.length);
  const next = nextStartAddress(watches, start, planned.visits.length, window.length);

  try {
    await refreshQueue(ctx, visits);
    await registerQueued(ctx);
    await endWatches(ctx, visits);
  } catch (err) {
    report.errors.push({ address: '*', message: message(err) });
  }

  report.pending = index.pending.length;
  try {
    const load = loadOf(index, now.getTime());
    if (loaded.broken || loadDue(index, load, now.getTime())) {
      await putLoad(kv, load);
      index.loadHash = loadHashOf(load);
      index.loadAt = now.getTime();
      ctx.dirty = true;
    }
    if (ctx.dirty || stopped) {
      index.rotation = rotationAfter(index, next, runIndex);
      pruneEnded(index, now.getTime());
      await putIndex(kv, index);
    }
  } catch (err) {
    report.errors.push({ address: '*', message: message(err) });
  }
  report.subrequests = budget.used;
  return report;
}
