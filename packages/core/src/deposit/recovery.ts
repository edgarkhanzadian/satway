import { fetchAddressTxCount } from '../bitcoin/index.js';
import {
  type DepositScriptParameters,
  buildIndexedDepositAddress,
  depositAddressFromScripts,
  depositIndexOfFeeCap,
  depositParametersOf,
  fetchDepositsByReclaimKey,
  toXOnly,
} from '../sbtc/index.js';
import {
  DEPOSIT_INDEX_LIMIT,
  DEPOSIT_INDEX_WINDOW,
  type FetchLike,
  HttpError,
  ResponseShapeError,
  errorMessage,
  sleep,
} from '../shared/index.js';
import type { DepositIndexEndpoints, DepositIndexOwner } from './deposit-index.js';

export interface FoundDeposit extends DepositScriptParameters {
  depositIndex: number | null;
  depositAddress: string;
  depositScriptPubKey: string;
  depositScript: string;
  reclaimScript: string;
}

export interface WalletDeposits {
  deposits: FoundDeposit[];
  truncated: boolean;
}

export async function findDepositsByReclaimKey(
  config: Pick<DepositIndexEndpoints, 'sbtcApiUrl' | 'baseSignerFeeSats'>,
  reclaimPublicKey: string,
  options: { fetchFn?: FetchLike; signal?: AbortSignal } = {}
): Promise<WalletDeposits> {
  const wanted = toXOnly(reclaimPublicKey);
  const found = await fetchDepositsByReclaimKey(config.sbtcApiUrl, wanted, options);
  const byAddress = new Map<string, FoundDeposit>();
  for (const d of found.deposits) {
    const parameters = depositParametersOf(d.depositScript, d.reclaimScript);
    if (!parameters || parameters.reclaimPublicKey !== wanted) continue;
    const derived = depositAddressFromScripts(d.depositScript, d.reclaimScript);
    if (byAddress.has(derived.address)) continue;
    byAddress.set(derived.address, {
      ...parameters,
      depositIndex: depositIndexOfFeeCap(parameters.maxSignerFeeSats, config.baseSignerFeeSats),
      depositAddress: derived.address,
      depositScriptPubKey: derived.scriptPubKey,
      depositScript: d.depositScript,
      reclaimScript: d.reclaimScript,
    });
  }
  return { deposits: [...byAddress.values()], truncated: found.truncated };
}

export interface ScanProgress {
  checked: number;
  found: number;
  nextIndex: number;
}

export interface ScanResult {
  deposits: FoundDeposit[];
  checked: number;
  nextIndex: number;
  cancelled: boolean;
  exhausted: boolean;
  error: string | null;
}

export const SCAN_CONCURRENCY = 4;
export const SCAN_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 8_000];

export interface ScanInput {
  config: DepositIndexEndpoints;
  owner: DepositIndexOwner;
  start?: number;
  gap?: number;
  concurrency?: number;
  fetchFn?: FetchLike;
  signal?: AbortSignal;
  retryDelaysMs?: readonly number[];
  wait?(ms: number, signal?: AbortSignal): Promise<void>;
  onProgress?(progress: ScanProgress): void;
}

export function scanReadRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return !(err instanceof ResponseShapeError);
}

async function txCountWithRetry(input: ScanInput, address: string): Promise<number> {
  const delays = input.retryDelaysMs ?? SCAN_RETRY_DELAYS_MS;
  const wait = input.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchAddressTxCount(input.config.btcApiUrl, address, {
        fetchFn: input.fetchFn,
        signal: input.signal,
      });
    } catch (err) {
      const delay = delays[attempt];
      if (input.signal?.aborted || delay === undefined || !scanReadRetryable(err)) throw err;
      await wait(delay, input.signal);
    }
  }
}

function foundAt(input: ScanInput, n: number): FoundDeposit {
  const built = buildIndexedDepositAddress({ ...input.owner, depositIndex: n }, input.config);
  return {
    stacksAddress: input.owner.stacksAddress,
    reclaimPublicKey: toXOnly(input.owner.reclaimPublicKey),
    signersPublicKey: toXOnly(input.owner.signersPublicKey),
    maxSignerFeeSats: built.maxSignerFeeSats,
    reclaimLockBlocks: input.config.reclaimLockBlocks,
    depositIndex: n,
    depositAddress: built.address,
    depositScriptPubKey: built.scriptPubKey,
    depositScript: built.depositScript,
    reclaimScript: built.reclaimScript,
  };
}

export async function scanDepositAddresses(input: ScanInput): Promise<ScanResult> {
  const gap = Math.max(1, input.gap ?? DEPOSIT_INDEX_WINDOW);
  const width = Math.max(1, input.concurrency ?? SCAN_CONCURRENCY);
  const asked = input.start === undefined ? 0 : Math.floor(input.start);
  const start = Math.min(Math.max(0, asked), DEPOSIT_INDEX_LIMIT);
  const deposits: FoundDeposit[] = [];
  let unusedRun = 0;
  let next = start;
  function result(cancelled: boolean, error: string | null = null): ScanResult {
    return {
      deposits,
      checked: next - start,
      nextIndex: next,
      cancelled,
      exhausted: next >= DEPOSIT_INDEX_LIMIT,
      error,
    };
  }
  while (unusedRun < gap && next < DEPOSIT_INDEX_LIMIT) {
    if (input.signal?.aborted) return result(true);
    const batch = Array.from(
      { length: Math.min(width, gap - unusedRun, DEPOSIT_INDEX_LIMIT - next) },
      (_, i) => foundAt(input, next + i)
    );
    const counts = await Promise.allSettled(
      batch.map(d => txCountWithRetry(input, d.depositAddress))
    );
    for (const [i, d] of batch.entries()) {
      const count = counts[i];
      if (count?.status !== 'fulfilled') {
        if (input.signal?.aborted) return result(true);
        const reason: unknown = count?.reason;
        return result(false, errorMessage(reason) ?? String(reason));
      }
      if (count.value > 0) {
        deposits.push(d);
        unusedRun = 0;
      } else {
        unusedRun += 1;
      }
      next += 1;
    }
    input.onProgress?.({ checked: next - start, found: deposits.length, nextIndex: next });
  }
  return result(false);
}
