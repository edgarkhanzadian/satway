import {
  type AddressOutput,
  type DepositOutputsOptions,
  fetchDepositOutputs,
  fetchTipHeight,
  outpointOf,
} from '../bitcoin/index.js';
import {
  type OneClickStatusResponse,
  type OneClickSwapStatus,
  destinationTxHashesOf,
} from '../oneclick/index.js';
import {
  DepositCheckError,
  type EmilyDepositStatus,
  type PayoutSpender,
  fetchDeposit,
  fetchLimits,
  fetchPayoutSpender,
  notifyDeposit,
} from '../sbtc/index.js';
import { type FetchLike, HttpError, type NetworkConfig, errorMessage } from '../shared/index.js';
import {
  MAX_REGISTRATIONS_PER_CHECK,
  byArrival,
  depositPayouts,
  outputsToRegister,
} from './payouts.js';
import {
  MINT_UNKNOWN,
  type MintStatus,
  type PayoutObservation,
  type Progress,
  deriveProgress,
} from './status.js';

export type DepositEndpointsConfig = Pick<NetworkConfig, 'btcApiUrl' | 'sbtcApiUrl'>;

export interface WatchedDepositContext {
  depositAddress: string;
  depositScriptPubKey: string;
  depositScript: string;
  reclaimScript: string;
  reclaimLockBlocks: number;
}

export interface DepositObservation {
  swap: OneClickSwapStatus | null;
  payoutTxids: string[];
  outputs: AddressOutput[];
  payouts: AddressOutput[];
  belowMinimum: AddressOutput[];
  foreignTxids: string[];
  truncated: boolean;
  tipHeight: number | null;
  perDepositMinimum: number | null;
  mints: Map<string, MintStatus>;
  spenders: Map<string, PayoutSpender | null>;
  toRegister: AddressOutput[];
  progress: Progress;
  requests: number;
}

function spenderNeeded(payout: AddressOutput, mint: MintStatus): boolean {
  return payout.spent && mint !== null && mint !== 'confirmed' && mint !== 'failed';
}

export type RegistrationFailureKind = 'transient' | 'rejected';

export interface RegistrationFailure {
  kind: RegistrationFailureKind;
  status: number | null;
  message: string;
}

export interface RegistrationResult {
  outpoint: string;
  output: AddressOutput;
  status: EmilyDepositStatus | null;
  error: string | null;
  failure: RegistrationFailure | null;
}

const RETRYABLE_CLIENT_STATUSES = new Set([408, 425, 429]);

export function classifyRegistrationError(err: unknown, sbtcApiUrl: string): RegistrationFailure {
  const message = errorMessage(err) ?? String(err);
  if (err instanceof DepositCheckError) return { kind: 'rejected', status: null, message };
  if (err instanceof HttpError) {
    const fromSigners = err.url.startsWith(`${sbtcApiUrl}/`);
    const refused =
      fromSigners &&
      err.status >= 400 &&
      err.status < 500 &&
      !RETRYABLE_CLIENT_STATUSES.has(err.status);
    return { kind: refused ? 'rejected' : 'transient', status: err.status, message };
  }
  return { kind: 'transient', status: null, message };
}

function progressFor(
  o: Pick<
    DepositObservation,
    'swap' | 'payoutTxids' | 'payouts' | 'mints' | 'tipHeight' | 'spenders'
  >,
  reclaimLockBlocks: number
): Progress {
  const payouts: PayoutObservation[] = o.payouts.map(payout => ({
    payout,
    spent: payout.spent,
    spender: o.spenders.get(outpointOf(payout)) ?? null,
    mint: o.mints.get(outpointOf(payout)) ?? null,
  }));
  return deriveProgress({
    swap: o.swap,
    payouts,
    payoutTxids: o.payoutTxids,
    tipHeight: o.tipHeight,
    reclaimLockBlocks,
  });
}

async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

async function readMint(
  sbtcApiUrl: string,
  output: AddressOutput,
  fetchFn: FetchLike | undefined
): Promise<MintStatus> {
  try {
    const known = await fetchDeposit(sbtcApiUrl, output.txid, output.vout, fetchFn);
    return known?.status ?? null;
  } catch {
    return MINT_UNKNOWN;
  }
}

export const MAX_MINT_READS_PER_CHECK = 12;

function newestFirst(a: AddressOutput, b: AddressOutput): number {
  return byArrival(b, a);
}

export function mintReadOrder(
  candidates: readonly AddressOutput[],
  payouts: readonly AddressOutput[],
  known: ReadonlyMap<string, MintStatus>
): AddressOutput[] {
  const seen = new Set<string>();
  function unread(o: AddressOutput): boolean {
    const before = known.get(outpointOf(o));
    return before === undefined || before === MINT_UNKNOWN;
  }
  const groups = [
    candidates.filter(unread),
    candidates.filter(o => !unread(o)),
    payouts.filter(o => !o.spent && unread(o)),
    payouts.filter(o => o.spent && unread(o)),
    payouts.filter(o => !unread(o)),
  ];
  const order: AddressOutput[] = [];
  for (const group of groups) {
    for (const o of [...group].sort(newestFirst)) {
      if (seen.has(outpointOf(o))) continue;
      seen.add(outpointOf(o));
      order.push(o);
    }
  }
  return order;
}

export function mintStatusUnknown(mints: ReadonlyMap<string, MintStatus>): boolean {
  return [...mints.values()].some(m => m === MINT_UNKNOWN);
}

export async function observeDeposit(
  config: DepositEndpointsConfig,
  ctx: WatchedDepositContext,
  status: OneClickStatusResponse | null,
  options: {
    fetchFn?: FetchLike;
    maxPages?: DepositOutputsOptions['maxPages'];
    known?: ReadonlyMap<string, MintStatus>;
  } = {}
): Promise<DepositObservation> {
  const fetchFn = options.fetchFn;
  const [limits, tipHeight] = await Promise.all([
    optional(() => fetchLimits(config.sbtcApiUrl, fetchFn)),
    optional(() => fetchTipHeight(config.btcApiUrl, fetchFn)),
  ]);
  const perDepositMinimum = limits?.perDepositMinimum ?? null;
  const payoutTxids = destinationTxHashesOf(status);
  const fetched = await fetchDepositOutputs(
    config.btcApiUrl,
    ctx.depositAddress,
    ctx.depositScriptPubKey,
    { txids: payoutTxids, maxPages: options.maxPages, fetchFn }
  );
  const { payouts, belowMinimum } = depositPayouts(fetched.outputs, perDepositMinimum);
  const candidates = outputsToRegister(fetched.outputs, {
    minimumSats: perDepositMinimum,
    tipHeight,
    reclaimLockBlocks: ctx.reclaimLockBlocks,
    limit: Number.POSITIVE_INFINITY,
  });

  const known = options.known ?? new Map<string, MintStatus>();
  const mints = new Map<string, MintStatus>();
  for (const o of [...candidates, ...payouts]) {
    const before = known.get(outpointOf(o));
    if (before === 'confirmed' || before === 'failed') mints.set(outpointOf(o), before);
  }
  const reads = mintReadOrder(candidates, payouts, known).filter(o => !mints.has(outpointOf(o)));
  let mintReads = 0;
  for (const o of reads.slice(0, MAX_MINT_READS_PER_CHECK)) {
    mints.set(outpointOf(o), await readMint(config.sbtcApiUrl, o, fetchFn));
    mintReads += 1;
  }
  for (const o of reads.slice(MAX_MINT_READS_PER_CHECK)) {
    const before = known.get(outpointOf(o));
    if (before !== undefined && before !== MINT_UNKNOWN) mints.set(outpointOf(o), before);
  }
  const toRegister = candidates
    .filter(o => mints.has(outpointOf(o)) && mints.get(outpointOf(o)) === null)
    .slice(0, MAX_REGISTRATIONS_PER_CHECK);

  const spenders = new Map<string, PayoutSpender | null>();
  for (const payout of payouts) {
    const key = outpointOf(payout);
    if (!mints.has(key) || !spenderNeeded(payout, mints.get(key) ?? null)) continue;
    spenders.set(
      key,
      await optional(() => fetchPayoutSpender(config.btcApiUrl, payout, ctx, fetchFn))
    );
  }

  const swap = status?.status ?? null;
  const observed = { swap, payoutTxids, payouts, mints, tipHeight, spenders };
  return {
    ...observed,
    outputs: fetched.outputs,
    belowMinimum,
    foreignTxids: fetched.foreignTxids,
    truncated: fetched.truncated,
    perDepositMinimum,
    toRegister,
    progress: progressFor(observed, ctx.reclaimLockBlocks),
    requests: fetched.requests + 2 + mintReads + spenders.size * 2,
  };
}

export async function registerOutputs(
  config: DepositEndpointsConfig,
  scripts: Pick<WatchedDepositContext, 'depositScript' | 'reclaimScript'>,
  outputs: readonly AddressOutput[],
  fetchFn?: FetchLike
): Promise<RegistrationResult[]> {
  const results: RegistrationResult[] = [];
  for (const output of outputs) {
    const outpoint = outpointOf(output);
    try {
      const registered = await notifyDeposit(
        config,
        {
          bitcoinTxid: output.txid,
          bitcoinTxOutputIndex: output.vout,
          depositScript: scripts.depositScript,
          reclaimScript: scripts.reclaimScript,
        },
        fetchFn
      );
      results.push({ outpoint, output, status: registered.status, error: null, failure: null });
    } catch (err) {
      const failure = classifyRegistrationError(err, config.sbtcApiUrl);
      results.push({ outpoint, output, status: null, error: failure.message, failure });
    }
  }
  return results;
}

export function applyRegistrations(
  observation: DepositObservation,
  results: readonly RegistrationResult[],
  reclaimLockBlocks: number
): DepositObservation {
  const mints = new Map(observation.mints);
  for (const r of results) if (r.status !== null) mints.set(r.outpoint, r.status);
  const next = { ...observation, mints };
  return { ...next, progress: progressFor(next, reclaimLockBlocks) };
}
