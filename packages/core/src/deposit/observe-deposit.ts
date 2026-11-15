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
  quotedSatsOf,
  reportedAmountOutOf,
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
  type PayoutSelection,
  type PriorOutputs,
  type PriorSource,
  isPriorOutput,
  outputsToRegister,
  priorOutputsOf,
  selectPayout,
} from './payout-selection.js';
import { type Progress, deriveProgress } from './status.js';

export type DepositEndpointsConfig = Pick<NetworkConfig, 'btcApiUrl' | 'sbtcApiUrl'>;

export interface WatchedDepositContext extends PriorSource {
  depositAddress: string;
  depositScriptPubKey: string;
  depositScript: string;
  reclaimScript: string;
  reclaimLockBlocks: number;
  minAmountOut: string;
}

export interface DepositObservation {
  swap: OneClickSwapStatus | null;
  outputs: AddressOutput[];
  selection: PayoutSelection;
  prior: PriorOutputs;
  truncated: boolean;
  tipHeight: number | null;
  perDepositMinimum: number | null;
  mints: Map<string, EmilyDepositStatus | null>;
  payoutSpender: PayoutSpender | null;
  toRegister: AddressOutput[];
  progress: Progress;
  requests: number;
}

function spenderNeeded(payout: AddressOutput | null, mint: EmilyDepositStatus | null): boolean {
  return payout?.spent === true && mint !== null && mint !== 'confirmed' && mint !== 'failed';
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
  o: Pick<DepositObservation, 'swap' | 'selection' | 'mints' | 'tipHeight' | 'payoutSpender'>,
  reclaimLockBlocks: number
): Progress {
  const payout = o.selection.payout;
  return deriveProgress({
    swap: o.swap,
    payout,
    payoutSpent: payout?.spent,
    payoutSpender: o.payoutSpender,
    ambiguousMints: o.selection.ambiguous
      ? o.selection.candidates.map(c => o.mints.get(outpointOf(c)) ?? null)
      : undefined,
    mint: payout ? (o.mints.get(outpointOf(payout)) ?? null) : null,
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

export async function observeDeposit(
  config: DepositEndpointsConfig,
  ctx: WatchedDepositContext,
  status: OneClickStatusResponse | null,
  options: { fetchFn?: FetchLike; history?: DepositOutputsOptions['history'] } = {}
): Promise<DepositObservation> {
  const fetchFn = options.fetchFn;
  const hashes = destinationTxHashesOf(status);
  const [limits, tipHeight] = await Promise.all([
    optional(() => fetchLimits(config.sbtcApiUrl, fetchFn)),
    optional(() => fetchTipHeight(config.btcApiUrl, fetchFn)),
  ]);
  const perDepositMinimum = limits?.perDepositMinimum ?? null;
  const fetched = await fetchDepositOutputs(
    config.btcApiUrl,
    ctx.depositAddress,
    ctx.depositScriptPubKey,
    { txids: hashes, history: options.history, fetchFn }
  );
  const prior = priorOutputsOf(ctx);
  const selection = selectPayout({
    outputs: fetched.outputs,
    prior,
    minAmountOutSats: quotedSatsOf(ctx.minAmountOut),
    reportedAmountOutSats: reportedAmountOutOf(status),
    destinationTxHashes: hashes,
    perDepositMinimum,
    swapStatus: status?.status ?? null,
  });
  const toRegister = outputsToRegister(fetched.outputs, {
    isPrior: o => o !== selection.payout && isPriorOutput(o, prior),
    minimumSats: perDepositMinimum ?? selection.lowerBoundSats,
    tipHeight,
    reclaimLockBlocks: ctx.reclaimLockBlocks,
  });

  const lookups = new Map<string, AddressOutput>();
  for (const o of [
    ...(selection.payout ? [selection.payout] : []),
    ...selection.candidates,
    ...toRegister,
  ]) {
    lookups.set(outpointOf(o), o);
  }
  const mints = new Map<string, EmilyDepositStatus | null>();
  for (const [key, o] of [...lookups].slice(0, MAX_REGISTRATIONS_PER_CHECK + 1)) {
    const known = await fetchDeposit(config.sbtcApiUrl, o.txid, o.vout, fetchFn);
    mints.set(key, known?.status ?? null);
  }

  const payout = selection.payout;
  const checkSpender = spenderNeeded(
    payout,
    payout ? (mints.get(outpointOf(payout)) ?? null) : null
  );
  const payoutSpender =
    payout && checkSpender
      ? await optional(() => fetchPayoutSpender(config.btcApiUrl, payout, ctx, fetchFn))
      : null;

  const swap = status?.status ?? null;
  const observed = { swap, selection, mints, tipHeight, payoutSpender };
  return {
    ...observed,
    outputs: fetched.outputs,
    prior,
    truncated: fetched.truncated,
    perDepositMinimum,
    toRegister: toRegister.filter(
      o => mints.has(outpointOf(o)) && mints.get(outpointOf(o)) === null
    ),
    progress: progressFor(observed, ctx.reclaimLockBlocks),
    requests: fetched.requests + 2 + mints.size + (checkSpender ? 2 : 0),
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
