import { fetchAddressTxCount } from '../bitcoin/index.js';
import {
  type DepositIndexConfig,
  type EmilyReclaimKeyDeposit,
  type IndexedDepositAddress,
  type IndexedDepositAddressInput,
  buildIndexedDepositAddress,
  depositIndexOfFeeCap,
  depositParametersOf,
  fetchDepositsByReclaimKey,
} from '../sbtc/index.js';
import {
  DEPOSIT_INDEX_LIMIT,
  DEPOSIT_INDEX_WINDOW,
  type FetchLike,
  type NetworkConfig,
  errorMessage,
} from '../shared/index.js';

export type DepositIndexOwner = Omit<IndexedDepositAddressInput, 'depositIndex'>;

export type DepositIndexEndpoints = DepositIndexConfig &
  Pick<NetworkConfig, 'btcApiUrl' | 'sbtcApiUrl'>;

export const MAX_DEPOSIT_INDEX_DRAWS = 8;

export function emilyDepositIndexOf(
  deposit: Pick<EmilyReclaimKeyDeposit, 'depositScript' | 'reclaimScript'>,
  owner: DepositIndexOwner,
  config: DepositIndexConfig
): number | null {
  const parameters = depositParametersOf(deposit.depositScript, deposit.reclaimScript);
  if (!parameters) return null;
  const n = depositIndexOfFeeCap(parameters.maxSignerFeeSats, config.baseSignerFeeSats);
  if (n === null) return null;
  const built = buildIndexedDepositAddress({ ...owner, depositIndex: n }, config);
  return built.depositScript === deposit.depositScript.toLowerCase() &&
    built.reclaimScript === deposit.reclaimScript.toLowerCase()
    ? n
    : null;
}

export function usedDepositIndices(
  deposits: readonly Pick<EmilyReclaimKeyDeposit, 'depositScript' | 'reclaimScript'>[],
  owner: DepositIndexOwner,
  config: DepositIndexConfig
): number[] {
  const used = new Set<number>();
  for (const d of deposits) {
    const n = emilyDepositIndexOf(d, owner, config);
    if (n !== null) used.add(n);
  }
  return [...used].sort((a, b) => a - b);
}

export function lowestUnusedIndex(used: ReadonlySet<number>): number {
  let n = 0;
  while (used.has(n)) n += 1;
  return n;
}

export function drawDepositIndex(
  used: ReadonlySet<number>,
  randomInt: (maxExclusive: number) => number,
  onChain: ReadonlySet<number> = used
): number {
  const lowest = lowestUnusedIndex(onChain);
  const end = Math.min(lowest + DEPOSIT_INDEX_WINDOW, DEPOSIT_INDEX_LIMIT);
  const free: number[] = [];
  for (let n = lowest; n < end; n++) if (!used.has(n)) free.push(n);
  if (free.length === 0) {
    throw new Error(
      'Every deposit address for this wallet is used up, so the deposit was not started. Use another Stacks wallet.'
    );
  }
  const pick = randomInt(free.length);
  const n = Number.isSafeInteger(pick) && pick >= 0 && pick < free.length ? free[pick] : undefined;
  if (n === undefined) throw new Error('The random source gave a value out of range');
  return n;
}

export type EmilyLookup = 'read' | 'unreachable';

export interface DepositIndexChoice {
  deposit: IndexedDepositAddress;
  emily: EmilyLookup;
  emilyError: string | null;
  used: number[];
  occupied: number[];
}

export interface ChooseDepositIndexInput {
  config: DepositIndexEndpoints;
  owner: DepositIndexOwner;
  localIndices: Iterable<number>;
  paidLocalIndices?: Iterable<number>;
  randomInt(maxExclusive: number): number;
  fetchFn?: FetchLike;
  maxDraws?: number;
}

async function emilyIndices(
  input: ChooseDepositIndexInput
): Promise<{ used: number[]; error: string | null }> {
  try {
    const found = await fetchDepositsByReclaimKey(
      input.config.sbtcApiUrl,
      input.owner.reclaimPublicKey,
      { fetchFn: input.fetchFn }
    );
    return { used: usedDepositIndices(found.deposits, input.owner, input.config), error: null };
  } catch (err) {
    return { used: [], error: errorMessage(err) ?? String(err) };
  }
}

async function addressIsUnused(input: ChooseDepositIndexInput, address: string): Promise<boolean> {
  try {
    return (
      (await fetchAddressTxCount(input.config.btcApiUrl, address, { fetchFn: input.fetchFn })) === 0
    );
  } catch (err) {
    throw new Error(
      `Could not check that the new Bitcoin deposit address is unused, so the deposit was not started: ${errorMessage(err) ?? String(err)}`,
      { cause: err }
    );
  }
}

export async function chooseDepositIndex(
  input: ChooseDepositIndexInput
): Promise<DepositIndexChoice> {
  const fromEmily = await emilyIndices(input);
  const used = new Set<number>([...input.localIndices, ...fromEmily.used]);
  const onChain = new Set<number>([...(input.paidLocalIndices ?? []), ...fromEmily.used]);
  const occupied: number[] = [];
  const draws = input.maxDraws ?? MAX_DEPOSIT_INDEX_DRAWS;
  for (let attempt = 0; attempt < draws; attempt++) {
    const n = drawDepositIndex(used, input.randomInt, onChain);
    const deposit = buildIndexedDepositAddress({ ...input.owner, depositIndex: n }, input.config);
    if (await addressIsUnused(input, deposit.address)) {
      return {
        deposit,
        emily: fromEmily.error === null ? 'read' : 'unreachable',
        emilyError: fromEmily.error,
        used: [...used].sort((a, b) => a - b),
        occupied,
      };
    }
    occupied.push(n);
    used.add(n);
    onChain.add(n);
  }
  throw new Error(
    `Each of the ${draws} new Bitcoin deposit addresses tried already has transactions, so the deposit was not started. Try again in a few minutes.`
  );
}
