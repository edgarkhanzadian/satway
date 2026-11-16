import { type AddressOutput, outpointOf } from '../bitcoin/index.js';
import { blocksUntilReclaimFor } from '../sbtc/index.js';
import { P2TR_DUST_SATS } from '../shared/index.js';

export const MAX_REGISTRATIONS_PER_CHECK = 5;

export interface DepositPayouts {
  payouts: AddressOutput[];
  belowMinimum: AddressOutput[];
  mintMinimumSats: number;
}

export function mintMinimumOf(perDepositMinimum: number | null): number {
  return perDepositMinimum === null ? P2TR_DUST_SATS : Math.max(P2TR_DUST_SATS, perDepositMinimum);
}

export function byArrival(a: AddressOutput, b: AddressOutput): number {
  return (
    (a.blockHeight ?? Number.MAX_SAFE_INTEGER) - (b.blockHeight ?? Number.MAX_SAFE_INTEGER) ||
    outpointOf(a).localeCompare(outpointOf(b))
  );
}

function byValueThenArrival(a: AddressOutput, b: AddressOutput): number {
  return b.amountSats - a.amountSats || byArrival(a, b);
}

export function depositPayouts(
  outputs: readonly AddressOutput[],
  perDepositMinimum: number | null
): DepositPayouts {
  const mintMinimumSats = mintMinimumOf(perDepositMinimum);
  const sorted = [...outputs].sort(byArrival);
  return {
    payouts: sorted.filter(o => o.amountSats >= mintMinimumSats),
    belowMinimum: sorted.filter(o => o.amountSats < mintMinimumSats),
    mintMinimumSats,
  };
}

export interface RegistrationPolicy {
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
        o.amountSats >= Math.max(minimum, P2TR_DUST_SATS) &&
        blocksUntilReclaimFor(o, policy.tipHeight, policy.reclaimLockBlocks) !== 0
    )
    .sort(byValueThenArrival)
    .slice(0, policy.limit ?? MAX_REGISTRATIONS_PER_CHECK);
}
