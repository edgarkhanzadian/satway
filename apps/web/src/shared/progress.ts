import {
  type AddressOutput,
  type DepositObservation,
  type FetchLike,
  type MintStatus,
  type NetworkConfig,
  type OneClickStatusResponse,
  type OneClickSwapStatus,
  type Progress,
  type RegistrationFailureKind,
  type Stage,
  type SwapRefund,
  type WatchedDepositContext,
  applyRegistrations,
  errorMessage,
  mintStatusUnknown,
  observeDeposit,
  refundOf,
  registerOutputs,
  remainingDepositOf,
} from '@satway/core';

import type { Backend } from './backend.js';
import type { Receipt } from './receipt.js';

export interface Snapshot {
  progress: Progress;
  swap: OneClickSwapStatus | null;
  payouts: AddressOutput[];
  belowMinimum: AddressOutput[];
  perDepositMinimum?: number | null;
  foreignTxids: string[];
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
    depositAddress: receipt.depositAddress,
    depositScriptPubKey: receipt.depositScriptPubKey,
    depositScript: receipt.depositScript,
    reclaimScript: receipt.reclaimScript,
    reclaimLockBlocks: receipt.reclaimLockBlocks,
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
  fetchFn?: FetchLike,
  known?: ReadonlyMap<string, MintStatus>
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
    observed = await observeDeposit(config, depositContextOf(receipt), status, {
      fetchFn,
      swapDeadline: receipt.quoteResponse.quoteRequest.deadline,
      ...(known ? { known } : {}),
    });
  } catch (err) {
    throw new ProgressReadError(
      {
        swap: status?.status ?? null,
        remaining: remainingDepositOf(status, receipt.quoteResponse.quote.amountIn),
      },
      err
    );
  }
  return {
    ...(await registerObserved(config, depositContextOf(receipt), observed, fetchFn)),
    remaining: remainingDepositOf(status, receipt.quoteResponse.quote.amountIn),
    refund: refundOf(status, receipt.origin.decimals),
  };
}

async function registerObserved(
  config: NetworkConfig,
  ctx: WatchedDepositContext,
  observed: DepositObservation,
  fetchFn: FetchLike | undefined
): Promise<Omit<Snapshot, 'remaining' | 'refund'>> {
  const results = await registerOutputs(config, ctx, observed.toRegister, fetchFn);
  const o = applyRegistrations(observed, results, ctx.reclaimLockBlocks);
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
    payouts: o.payouts,
    belowMinimum: o.belowMinimum,
    perDepositMinimum: o.perDepositMinimum,
    foreignTxids: o.foreignTxids,
    outputs: o.outputs,
    mints: o.mints,
    mintUnknown: mintStatusUnknown(o.mints),
    tipHeight: o.tipHeight,
    truncated: o.truncated,
    registrationError: registrationErrors.map(e => e.message).join(' ') || null,
    registrationErrors,
  };
}

export async function checkFoundDeposit(
  config: NetworkConfig,
  ctx: WatchedDepositContext,
  fetchFn?: FetchLike
): Promise<Snapshot> {
  const observed = await observeDeposit(config, ctx, null, { fetchFn, swapless: true });
  return {
    ...(await registerObserved(config, ctx, observed, fetchFn)),
    remaining: null,
    refund: null,
  };
}
