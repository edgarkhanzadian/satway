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
import { DEPOSIT_INDEX_LIMIT, DEPOSIT_INDEX_WINDOW, type FetchLike } from '../shared/index.js';
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
  cancelled: boolean;
}

export const SCAN_CONCURRENCY = 4;

export interface ScanInput {
  config: DepositIndexEndpoints;
  owner: DepositIndexOwner;
  gap?: number;
  concurrency?: number;
  fetchFn?: FetchLike;
  signal?: AbortSignal;
  onProgress?(progress: ScanProgress): void;
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
  const deposits: FoundDeposit[] = [];
  let unusedRun = 0;
  let next = 0;
  while (unusedRun < gap && next < DEPOSIT_INDEX_LIMIT) {
    if (input.signal?.aborted) return { deposits, checked: next, cancelled: true };
    const batch = Array.from(
      { length: Math.min(width, gap - unusedRun, DEPOSIT_INDEX_LIMIT - next) },
      (_, i) => foundAt(input, next + i)
    );
    let counts: number[];
    try {
      counts = await Promise.all(
        batch.map(d =>
          fetchAddressTxCount(input.config.btcApiUrl, d.depositAddress, {
            fetchFn: input.fetchFn,
            signal: input.signal,
          })
        )
      );
    } catch (err) {
      if (input.signal?.aborted) return { deposits, checked: next, cancelled: true };
      throw err;
    }
    batch.forEach((d, i) => {
      if ((counts[i] ?? 0) > 0) {
        deposits.push(d);
        unusedRun = 0;
      } else {
        unusedRun += 1;
      }
    });
    next += batch.length;
    input.onProgress?.({ checked: next, found: deposits.length, nextIndex: next });
  }
  return { deposits, checked: next, cancelled: false };
}
