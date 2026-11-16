import {
  type AddressOutput,
  type DepositObservation,
  type FetchLike,
  type MintStatus,
  type NetworkConfig,
  type OneClickStatusResponse,
  type OneClickSwapStatus,
  type PayoutBasis,
  type Progress,
  type RegistrationFailureKind,
  type Stage,
  type SwapRefund,
  type WatchedDepositContext,
  applyRegistrations,
  errorMessage,
  mintStatusUnknown,
  observeDeposit,
  outpointOf,
  refundOf,
  registerOutputs,
  remainingDepositOf,
} from '@satway/core';

import type { Backend } from './backend.js';
import type { Receipt } from './receipt.js';

export interface Snapshot {
  progress: Progress;
  swap: OneClickSwapStatus | null;
  payout: AddressOutput | null;
  basis: PayoutBasis | null;
  mint: MintStatus;
  candidates: AddressOutput[];
  otherOutputs: AddressOutput[];
  belowMinimum: AddressOutput[];
  outputs: AddressOutput[];
  mints: ReadonlyMap<string, MintStatus>;
  mintUnknown: boolean;
  tipHeight: number | null;
  truncated: boolean;
  registrationError: string | null;
  registrationErrors: RegistrationErrorNote[];
  remaining: bigint | null;
  refund: SwapRefund | null;
}

export interface RegistrationErrorNote {
  outpoint: string;
  message: string;
  kind: RegistrationFailureKind;
  status: number | null;
}

export function depositContextOf(receipt: Receipt): WatchedDepositContext {
  return {
    createdAt: receipt.createdAt,
    quoteTimestamp: receipt.quoteResponse.timestamp,
    priorOutpoints: receipt.priorOutpoints,
    priorTruncated: receipt.priorTruncated,
    depositAddress: receipt.depositAddress,
    depositScriptPubKey: receipt.depositScriptPubKey,
    depositScript: receipt.depositScript,
    reclaimScript: receipt.reclaimScript,
    reclaimLockBlocks: receipt.reclaimLockBlocks,
    minAmountOut: receipt.quoteResponse.quote.minAmountOut,
  };
}

export interface SwapReading {
  swap: OneClickSwapStatus | null;
  remaining: bigint | null;
}

export class ProgressReadError extends Error {
  readonly reading: SwapReading;

  constructor(reading: SwapReading, cause: unknown) {
    super(errorMessage(cause) ?? String(cause), { cause });
    this.name = 'ProgressReadError';
    this.reading = reading;
  }
}

export type PaymentView = 'checking' | 'unknown' | 'pay' | 'none';

export function paymentView(
  reading: SwapReading | undefined,
  freshStage: Stage | null
): PaymentView {
  if (freshStage !== null && freshStage !== 'awaiting-funds') return 'none';
  if (reading === undefined) return 'checking';
  if (reading.swap === null) return 'unknown';
  return reading.swap === 'PENDING_DEPOSIT' || reading.swap === 'INCOMPLETE_DEPOSIT'
    ? 'pay'
    : 'none';
}

export async function checkProgress(
  config: NetworkConfig,
  backend: Backend,
  receipt: Receipt,
  fetchFn?: FetchLike
): Promise<Snapshot> {
  let status: OneClickStatusResponse | null = null;
  const swapAddress = receipt.quoteResponse.quote.depositAddress;
  if (swapAddress) {
    try {
      status = await backend.status(swapAddress, receipt.quoteResponse.quote.depositMemo);
    } catch {
      status = null;
    }
  }

  let observed: DepositObservation;
  try {
    observed = await observeDeposit(config, depositContextOf(receipt), status, { fetchFn });
  } catch (err) {
    throw new ProgressReadError(
      {
        swap: status?.status ?? null,
        remaining: remainingDepositOf(status, receipt.quoteResponse.quote.amountIn),
      },
      err
    );
  }
  const results = await registerOutputs(config, receipt, observed.toRegister, fetchFn);
  const o = applyRegistrations(observed, results, receipt.reclaimLockBlocks);
  const { selection } = o;
  const payout = selection.payout;
  const candidateKeys = new Set(selection.candidates.map(outpointOf));
  const registrationErrors = results.flatMap(r =>
    r.failure === null
      ? []
      : [
          {
            outpoint: r.outpoint,
            message: r.failure.message,
            kind: r.failure.kind,
            status: r.failure.status,
          },
        ]
  );
  return {
    progress: o.progress,
    swap: o.swap,
    payout,
    basis: selection.basis,
    mint: payout ? (o.mints.get(outpointOf(payout)) ?? null) : null,
    candidates: selection.ambiguous ? selection.candidates : [],
    otherOutputs: selection.others.filter(x => !candidateKeys.has(outpointOf(x))),
    belowMinimum: selection.belowMinimum,
    outputs: o.outputs,
    mints: o.mints,
    mintUnknown: mintStatusUnknown(o.mints),
    tipHeight: o.tipHeight,
    truncated: o.truncated,
    registrationError: registrationErrors.map(e => e.message).join(' ') || null,
    registrationErrors,
    remaining: remainingDepositOf(status, receipt.quoteResponse.quote.amountIn),
    refund: refundOf(status, receipt.origin.decimals),
  };
}
