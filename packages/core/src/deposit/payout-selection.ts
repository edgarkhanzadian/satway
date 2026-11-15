import { type AddressOutput, outpointOf } from '../bitcoin/index.js';
import { normalizeTxHash } from '../oneclick/index.js';
import { blocksUntilReclaimFor } from '../sbtc/index.js';
import { P2TR_DUST_SATS } from '../shared/index.js';

export const PRIOR_CLOCK_MARGIN_SECONDS = 2 * 60 * 60;
export const PAYOUT_AMOUNT_TOLERANCE_BPS = 200;
export const MAX_REGISTRATIONS_PER_CHECK = 5;

export interface PriorOutputs {
  outpoints: ReadonlySet<string> | null;
  complete: boolean;
  since: number | null;
}

export interface PriorSource {
  createdAt: string;
  quoteTimestamp?: string;
  priorOutpoints?: readonly string[];
  priorTruncated?: boolean;
}

function epochSeconds(iso: string | undefined): number | null {
  if (iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function priorOutputsOf(source: PriorSource): PriorOutputs {
  const times = [epochSeconds(source.createdAt), epochSeconds(source.quoteTimestamp)].filter(
    t => t !== null
  );
  const outpoints = source.priorOutpoints
    ? new Set(source.priorOutpoints.map(o => o.toLowerCase()))
    : null;
  return {
    outpoints,
    complete: outpoints !== null && source.priorTruncated !== true,
    since: times.length > 0 ? Math.min(...times) : null,
  };
}

export function isPriorOutput(
  output: Pick<AddressOutput, 'txid' | 'vout' | 'confirmed' | 'blockTime'>,
  prior: PriorOutputs
): boolean {
  if (prior.outpoints?.has(outpointOf(output))) return true;
  if (prior.complete || prior.since === null) return false;
  return (
    output.confirmed &&
    output.blockTime !== null &&
    output.blockTime < prior.since - PRIOR_CLOCK_MARGIN_SECONDS
  );
}

export type PayoutBasis = 'hash' | 'amount';

export interface PayoutSelectionInput {
  outputs: readonly AddressOutput[];
  prior: PriorOutputs;
  minAmountOutSats: number | null;
  reportedAmountOutSats: number | null;
  destinationTxHashes: readonly string[];
  perDepositMinimum: number | null;
}

export interface PayoutSelection {
  payout: AddressOutput | null;
  basis: PayoutBasis | null;
  ambiguous: boolean;
  candidates: AddressOutput[];
  prior: AddressOutput[];
  belowMinimum: AddressOutput[];
  others: AddressOutput[];
  lowerBoundSats: number;
  mintMinimumSats: number;
}

export function payoutLowerBound(
  minAmountOutSats: number | null,
  perDepositMinimum: number | null
): number {
  const fromQuote =
    minAmountOutSats === null
      ? 0
      : Math.floor((minAmountOutSats * (10_000 - PAYOUT_AMOUNT_TOLERANCE_BPS)) / 10_000);
  const bounds = [P2TR_DUST_SATS, fromQuote];
  if (perDepositMinimum !== null) bounds.push(perDepositMinimum);
  return Math.max(...bounds);
}

function soleOf<T>(items: readonly T[]): T | null {
  return items.length === 1 ? (items[0] ?? null) : null;
}

function byValueThenAge(a: AddressOutput, b: AddressOutput): number {
  return (
    b.amountSats - a.amountSats ||
    (a.blockHeight ?? Number.MAX_SAFE_INTEGER) - (b.blockHeight ?? Number.MAX_SAFE_INTEGER) ||
    outpointOf(a).localeCompare(outpointOf(b))
  );
}

function pickByHash(
  outputs: readonly AddressOutput[],
  hashes: ReadonlySet<string>,
  lowerBound: number
): AddressOutput | null {
  const matching = outputs.filter(o => hashes.has(o.txid.toLowerCase())).sort(byValueThenAge);
  return matching.find(o => o.amountSats >= lowerBound) ?? matching[0] ?? null;
}

export function selectPayout(input: PayoutSelectionInput): PayoutSelection {
  const lowerBoundSats = payoutLowerBound(input.minAmountOutSats, input.perDepositMinimum);
  const mintMinimumSats = input.perDepositMinimum ?? lowerBoundSats;
  const hashes = new Set(input.destinationTxHashes.map(normalizeTxHash).filter(h => h !== null));
  const byHash = pickByHash(input.outputs, hashes, lowerBoundSats);

  const prior = input.outputs.filter(o => o !== byHash && isPriorOutput(o, input.prior));
  const fresh = input.outputs.filter(o => o === byHash || !isPriorOutput(o, input.prior));
  const candidates = fresh.filter(o => o.amountSats >= lowerBoundSats).sort(byValueThenAge);

  let payout: AddressOutput | null = byHash;
  let basis: PayoutBasis | null = byHash ? 'hash' : null;
  let ambiguous = false;
  if (!payout) {
    const exact =
      input.reportedAmountOutSats === null
        ? []
        : candidates.filter(o => o.amountSats === input.reportedAmountOutSats);
    const only = soleOf(exact) ?? soleOf(candidates);
    if (only) {
      payout = only;
      basis = 'amount';
    } else {
      ambiguous = candidates.length > 1;
    }
  }

  const rest = fresh.filter(o => o !== payout);
  return {
    payout,
    basis,
    ambiguous,
    candidates: ambiguous ? candidates : candidates.filter(o => o === payout),
    prior,
    belowMinimum: rest.filter(o => o.amountSats < mintMinimumSats),
    others: rest.filter(o => o.amountSats >= mintMinimumSats),
    lowerBoundSats,
    mintMinimumSats,
  };
}

export interface RegistrationPolicy {
  isPrior(output: AddressOutput): boolean;
  minimumSats: number | null;
  tipHeight: number | null;
  reclaimLockBlocks: number;
  limit?: number;
}

export function outputsToRegister(
  outputs: readonly AddressOutput[],
  policy: RegistrationPolicy
): AddressOutput[] {
  const minimum = policy.minimumSats;
  if (minimum === null) return [];
  return outputs
    .filter(
      o =>
        !o.spent &&
        o.amountSats >= minimum &&
        !policy.isPrior(o) &&
        blocksUntilReclaimFor(o, policy.tipHeight, policy.reclaimLockBlocks) !== 0
    )
    .sort(byValueThenAge)
    .slice(0, policy.limit ?? MAX_REGISTRATIONS_PER_CHECK);
}
