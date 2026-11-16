import type { OneClickSwapStatus } from '@satway/core';

import {
  type SendRecord,
  type SendRecords,
  type SentRecord,
  type SwapTarget,
  type UncertainRecord,
  attemptingRecord,
  confirmedRecord,
  needsChainCheck,
  recordTx,
  sameAttempt,
  sendConfirmed,
  sentRecord,
  uncertainRecord,
} from './send-record.js';
import { type EvmTransactionState, walletFailure } from './source-wallet.js';

export const CANNOT_SAVE_MESSAGE =
  'This browser could not save a record of the payment, so the wallet was not asked to send. Send it manually using the details above, or allow this site to store data and reload.';
export const ALREADY_RECORDED_MESSAGE =
  'A payment from your wallet is already recorded for this swap, so the wallet was not asked again.';

export const NO_LOCK_MESSAGE =
  'This browser cannot stop two tabs from sending the same payment, so the wallet was not asked to send. Send it manually using the details above, or use an up-to-date browser.';

export interface AttemptStart {
  target: SwapTarget;
  account: string;
  now: Date;
}

export type AttemptOutcome =
  | { kind: 'sent'; record: SentRecord }
  | { kind: 'cleared'; message: string; rejected: boolean }
  | { kind: 'uncertain'; record: UncertainRecord }
  | { kind: 'refused'; message: string };

export async function attemptSend(
  records: SendRecords,
  start: AttemptStart,
  send: () => Promise<string>
): Promise<AttemptOutcome> {
  const claim = await records.claim(start.target);
  if (claim === 'unavailable') return { kind: 'refused', message: NO_LOCK_MESSAGE };
  if (claim === 'busy') return { kind: 'refused', message: ALREADY_RECORDED_MESSAGE };
  if (records.read(start.target) !== null) {
    records.release(start.target);
    return { kind: 'refused', message: ALREADY_RECORDED_MESSAGE };
  }
  const record = attemptingRecord(start);
  if (!records.write(record)) {
    records.clear(start.target);
    return { kind: 'refused', message: CANNOT_SAVE_MESSAGE };
  }
  try {
    const tx = await send();
    const sent = sentRecord(record, tx, 'wallet');
    records.write(sent);
    return { kind: 'sent', record: sent };
  } catch (err) {
    const failure = walletFailure(
      err,
      'The wallet did not confirm whether it sent the transaction'
    );
    if (failure.phase === 'uncertain') {
      const uncertain = uncertainRecord(record, failure.message, failure.tx);
      records.write(uncertain);
      return { kind: 'uncertain', record: uncertain };
    }
    records.clear(start.target);
    return { kind: 'cleared', message: failure.message, rejected: failure.phase === 'rejected' };
  }
}

export type Resolution =
  | { kind: 'sent'; record: SentRecord }
  | { kind: 'cleared'; message: string }
  | { kind: 'unchanged'; note: string | null };

export const LANDED_FAILED_MESSAGE =
  'Your earlier transaction reached the chain but failed, so nothing was transferred. You can send again.';
export const EVM_PENDING_NOTE =
  'Your wallet reports this transaction as pending. This page keeps checking.';
export const EVM_UNKNOWN_NOTE =
  'Your wallet does not know this transaction. It may not have been broadcast, or it may still be propagating.';

function commit(records: SendRecords, record: SendRecord, resolution: Resolution): Resolution {
  const current = records.read(record.swap);
  if (!sameAttempt(current, record)) return { kind: 'unchanged', note: null };
  if (resolution.kind === 'sent') records.write(resolution.record);
  if (resolution.kind === 'cleared') records.clear(record.swap);
  return resolution;
}

export async function resolveRecord(
  records: SendRecords,
  record: SendRecord,
  evmState: (hash: string) => Promise<EvmTransactionState>
): Promise<Resolution> {
  const tx = recordTx(record);
  if (tx === null || !needsChainCheck(record)) return { kind: 'unchanged', note: null };
  const sent = record.state === 'sent';
  const state = await evmState(tx);
  switch (state) {
    case 'succeeded':
      return commit(records, record, {
        kind: 'sent',
        record: record.state === 'sent' ? confirmedRecord(record) : sentRecord(record, tx, 'chain'),
      });
    case 'reverted':
      return commit(records, record, { kind: 'cleared', message: LANDED_FAILED_MESSAGE });
    case 'pending':
      return { kind: 'unchanged', note: sent ? null : EVM_PENDING_NOTE };
    default:
      return { kind: 'unchanged', note: sent ? null : EVM_UNKNOWN_NOTE };
  }
}

export function settleFromProvider(
  records: SendRecords,
  record: SendRecord | null,
  swap: OneClickSwapStatus | null | undefined
): SendRecord | null {
  if (record === null || (record.state === 'sent' && sendConfirmed(record))) return record;
  if (swap === undefined || swap === null || swap === 'PENDING_DEPOSIT') return record;
  const sent =
    record.state === 'sent'
      ? confirmedRecord(record)
      : sentRecord(record, recordTx(record), 'provider');
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
  const current = records.read(record.swap);
  if (!sameAttempt(current, record)) return false;
  return records.clear(record.swap);
}

export type SendPanel =
  | { kind: 'sending' }
  | { kind: 'record'; record: SendRecord }
  | { kind: 'checking' }
  | { kind: 'unknown' }
  | { kind: 'no-storage' }
  | { kind: 'no-lock' }
  | { kind: 'expired' }
  | { kind: 'offer' }
  | { kind: 'none' };

export const QUOTE_EXPIRY_MARGIN_MS = 5 * 60_000;

export function quoteExpired(deadline: string | undefined, now: Date): boolean {
  if (deadline === undefined) return false;
  const at = Date.parse(deadline);
  return !Number.isFinite(at) || now.getTime() >= at - QUOTE_EXPIRY_MARGIN_MS;
}

export function sendPanel(input: {
  swap: OneClickSwapStatus | null | undefined;
  record: SendRecord | null;
  walletCanSend: boolean;
  sending: boolean;
  durable: boolean;
  lockable: boolean;
  expired: boolean;
}): SendPanel {
  if (input.sending) return { kind: 'sending' };
  if (input.record !== null) return { kind: 'record', record: input.record };
  if (input.expired) return { kind: 'expired' };
  if (!input.walletCanSend) return { kind: 'none' };
  if (input.swap === undefined) return { kind: 'checking' };
  if (input.swap === null) return { kind: 'unknown' };
  if (input.swap !== 'PENDING_DEPOSIT') return { kind: 'none' };
  if (!input.durable) return { kind: 'no-storage' };
  if (!input.lockable) return { kind: 'no-lock' };
  return { kind: 'offer' };
}
