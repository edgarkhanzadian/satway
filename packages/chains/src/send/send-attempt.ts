import { type OneClickSwapStatus, errorMessage } from '@portage/core';

import {
  type AttemptingRecord,
  type SendFamily,
  type SendRecord,
  type SendRecords,
  type SentRecord,
  type SwapTarget,
  type UncertainRecord,
  attemptingRecord,
  lastValidBlockHeight,
  recordTx,
  sameAttempt,
  sentRecord,
  signedBytes,
  uncertainRecord,
  withSigned,
} from './send-record.js';
import type { SignedSolanaSend, SolanaSendCheck } from './solana/index.js';
import { type EvmTransactionState, walletFailure } from './source-wallet.js';

export const CANNOT_SAVE_MESSAGE =
  'This browser could not save a record of the payment, so the wallet was not asked to send. Send it manually using the details above, or allow this site to store data and reload.';
export const ALREADY_RECORDED_MESSAGE =
  'A payment from your wallet is already recorded for this swap, so the wallet was not asked again.';

export interface AttemptStart {
  target: SwapTarget;
  family: SendFamily;
  account: string;
  now: Date;
}

export interface AttemptHooks {
  onSigned(signed: SignedSolanaSend): void;
}

export type AttemptOutcome =
  | { kind: 'sent'; record: SentRecord }
  | { kind: 'cleared'; message: string; rejected: boolean }
  | { kind: 'uncertain'; record: UncertainRecord }
  | { kind: 'refused'; message: string };

export async function attemptSend(
  records: SendRecords,
  start: AttemptStart,
  send: (hooks: AttemptHooks) => Promise<string>
): Promise<AttemptOutcome> {
  if (records.read(start.target, start.family) !== null)
    return { kind: 'refused', message: ALREADY_RECORDED_MESSAGE };
  let record: AttemptingRecord = attemptingRecord(start);
  if (!records.write(record)) {
    records.clear(start.target);
    return { kind: 'refused', message: CANNOT_SAVE_MESSAGE };
  }
  try {
    const tx = await send({
      onSigned(signed) {
        record = withSigned(record, signed);
        records.write(record);
      },
    });
    const sent = sentRecord(record, tx, 'wallet');
    records.write(sent);
    return { kind: 'sent', record: sent };
  } catch (err) {
    const failure = walletFailure(
      err,
      'The wallet did not confirm whether it sent the transaction'
    );
    if (failure.phase === 'uncertain' || record.signed !== null) {
      const uncertain = uncertainRecord(record, failure.message, failure.tx);
      records.write(uncertain);
      return { kind: 'uncertain', record: uncertain };
    }
    records.clear(start.target);
    return { kind: 'cleared', message: failure.message, rejected: failure.phase === 'rejected' };
  }
}

export interface ResolveDeps {
  checkSolana(sent: {
    signature: string;
    lastValidBlockHeight: bigint | null;
  }): Promise<SolanaSendCheck>;
  evmState(hash: string): Promise<EvmTransactionState>;
}

export type Resolution =
  | { kind: 'sent'; record: SentRecord }
  | { kind: 'cleared'; message: string }
  | { kind: 'unchanged'; note: string | null };

export const LANDED_FAILED_MESSAGE =
  'Your earlier transaction reached the chain but failed, so nothing was transferred. You can send again.';
export const EXPIRED_MESSAGE =
  'Your earlier transaction expired before it reached Solana, so nothing was transferred. You can send again.';
export const SOLANA_PENDING_NOTE =
  'Solana has not seen this transaction yet. This page keeps checking until it lands or expires, which takes about two minutes at most.';
export const EVM_PENDING_NOTE =
  'Your wallet reports this transaction as pending. This page keeps checking.';
export const EVM_UNKNOWN_NOTE =
  'Your wallet does not know this transaction. It may not have been broadcast, or it may still be propagating.';

function commit(records: SendRecords, record: SendRecord, resolution: Resolution): Resolution {
  const current = records.read(record.swap, record.family);
  if (!sameAttempt(current, record)) return { kind: 'unchanged', note: null };
  if (resolution.kind === 'sent') records.write(resolution.record);
  if (resolution.kind === 'cleared') records.clear(record.swap);
  return resolution;
}

export async function resolveRecord(
  records: SendRecords,
  record: SendRecord,
  deps: ResolveDeps
): Promise<Resolution> {
  if (record.state === 'sent') return { kind: 'unchanged', note: null };
  const tx = recordTx(record);
  if (tx === null) return { kind: 'unchanged', note: null };
  if (record.family === 'solana') {
    const check = await deps.checkSolana({
      signature: tx,
      lastValidBlockHeight: lastValidBlockHeight(record),
    });
    switch (check.status) {
      case 'landed':
        return commit(records, record, {
          kind: 'sent',
          record: sentRecord(record, tx, 'chain'),
        });
      case 'failed':
        return commit(records, record, { kind: 'cleared', message: LANDED_FAILED_MESSAGE });
      case 'expired':
        return commit(records, record, { kind: 'cleared', message: EXPIRED_MESSAGE });
      default:
        return { kind: 'unchanged', note: SOLANA_PENDING_NOTE };
    }
  }
  const state = await deps.evmState(tx);
  switch (state) {
    case 'succeeded':
      return commit(records, record, { kind: 'sent', record: sentRecord(record, tx, 'chain') });
    case 'reverted':
      return commit(records, record, { kind: 'cleared', message: LANDED_FAILED_MESSAGE });
    case 'pending':
      return { kind: 'unchanged', note: EVM_PENDING_NOTE };
    default:
      return { kind: 'unchanged', note: EVM_UNKNOWN_NOTE };
  }
}

export function settleFromProvider(
  records: SendRecords,
  record: SendRecord | null,
  swap: OneClickSwapStatus | null | undefined
): SendRecord | null {
  if (record === null || record.state === 'sent') return record;
  if (swap === undefined || swap === null || swap === 'PENDING_DEPOSIT') return record;
  const sent = sentRecord(record, recordTx(record), 'provider');
  records.write(sent);
  return sent;
}

export const WALLET_PROMPT_WINDOW_MS = 15 * 60_000;

export function promptWaitMs(record: SendRecord, now: Date): number {
  if (record.state !== 'attempting') return 0;
  const started = Date.parse(record.startedAt);
  if (!Number.isFinite(started) || started > now.getTime() + WALLET_PROMPT_WINDOW_MS) return 0;
  return Math.max(0, started + WALLET_PROMPT_WINDOW_MS - now.getTime());
}

export function confirmNothingSent(
  records: SendRecords,
  record: SendRecord,
  now: Date = new Date()
): boolean {
  if (record.state === 'sent') return false;
  if (promptWaitMs(record, now) > 0) return false;
  const current = records.read(record.swap, record.family);
  if (!sameAttempt(current, record)) return false;
  return records.clear(record.swap);
}

export function needsConfirmation(record: SendRecord): boolean {
  if (record.state === 'sent') return false;
  return recordTx(record) === null || record.family === 'evm';
}

export function canResendSigned(record: SendRecord): boolean {
  return record.state !== 'sent' && record.signed !== null;
}

export type ResendOutcome =
  | { kind: 'sent'; record: SentRecord }
  | { kind: 'uncertain'; record: UncertainRecord }
  | { kind: 'skipped' };

export async function resendRecord(
  records: SendRecords,
  record: SendRecord,
  resend: (signed: { signature: string; transaction: Uint8Array }) => Promise<string>
): Promise<ResendOutcome> {
  if (record.state === 'sent' || record.signed === null) return { kind: 'skipped' };
  const current = records.read(record.swap, record.family);
  if (!sameAttempt(current, record)) return { kind: 'skipped' };
  const transaction = signedBytes(record);
  if (transaction === null) return { kind: 'skipped' };
  try {
    const signature = await resend({ signature: record.signed.signature, transaction });
    const sent = sentRecord(record, signature, 'wallet');
    records.write(sent);
    return { kind: 'sent', record: sent };
  } catch (err) {
    const uncertain = uncertainRecord(
      record,
      `Solana did not confirm that it accepted the signed transaction: ${errorMessage(err) ?? 'unknown error'}`,
      record.signed.signature
    );
    records.write(uncertain);
    return { kind: 'uncertain', record: uncertain };
  }
}

export function latestSwap(
  snapshot: { swap: OneClickSwapStatus | null } | null,
  stale: boolean
): OneClickSwapStatus | null | undefined {
  if (snapshot === null) return undefined;
  return stale ? null : snapshot.swap;
}

export type SendPanel =
  | { kind: 'sending' }
  | { kind: 'record'; record: SendRecord }
  | { kind: 'checking' }
  | { kind: 'unknown' }
  | { kind: 'no-storage' }
  | { kind: 'offer' }
  | { kind: 'none' };

export function sendPanel(input: {
  swap: OneClickSwapStatus | null | undefined;
  record: SendRecord | null;
  walletCanSend: boolean;
  sending: boolean;
  durable: boolean;
}): SendPanel {
  if (input.sending) return { kind: 'sending' };
  if (input.record !== null) return { kind: 'record', record: input.record };
  if (!input.walletCanSend) return { kind: 'none' };
  if (input.swap === undefined) return { kind: 'checking' };
  if (input.swap === null) return { kind: 'unknown' };
  if (input.swap !== 'PENDING_DEPOSIT') return { kind: 'none' };
  if (!input.durable) return { kind: 'no-storage' };
  return { kind: 'offer' };
}
