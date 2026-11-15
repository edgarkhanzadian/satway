import { base58, base64 } from '@scure/base';

import { z } from '@portage/core';

import { isSolanaSignature } from '../metadata/index.js';
import { isSentTxFor } from './source-wallet.js';

export type SendFamily = 'evm' | 'solana';

export interface SwapTarget {
  address: string;
  memo: string | null;
}

export interface SignedTransfer {
  signature: string;
  transaction: string;
  lastValidBlockHeight: string;
}

export interface AttemptingRecord {
  version: 1;
  state: 'attempting';
  swap: SwapTarget;
  family: SendFamily;
  account: string;
  startedAt: string;
  signed: SignedTransfer | null;
}

export interface SentRecord {
  version: 1;
  state: 'sent';
  swap: SwapTarget;
  family: SendFamily;
  account: string;
  startedAt: string;
  tx: string | null;
  via: 'wallet' | 'chain' | 'provider';
}

export interface UncertainRecord {
  version: 1;
  state: 'uncertain';
  swap: SwapTarget;
  family: SendFamily;
  account: string;
  startedAt: string;
  tx: string | null;
  message: string;
  signed: SignedTransfer | null;
}

export type SendRecord = AttemptingRecord | SentRecord | UncertainRecord;

export const SEND_RECORD_PREFIX = 'portage:send-record:v1:';
const PROBE_KEY = 'portage:send-record:probe';
export const UNREADABLE_RECORD_MESSAGE =
  'A saved record of an earlier send from your wallet could not be read.';

const swapSchema = z.object({ address: z.string().min(1), memo: z.string().min(1).nullable() });
const familySchema = z.union([z.literal('evm'), z.literal('solana')]);
const signedSchema = z.object({
  signature: z.string(),
  transaction: z.string(),
  lastValidBlockHeight: z.string().regex(/^\d+$/),
});
const base = {
  version: z.literal(1),
  swap: swapSchema,
  family: familySchema,
  account: z.string(),
  startedAt: z.string(),
};

const recordSchema: z.ZodType<SendRecord> = z.discriminatedUnion('state', [
  z.object({ ...base, state: z.literal('attempting'), signed: signedSchema.nullable() }),
  z.object({
    ...base,
    state: z.literal('sent'),
    tx: z.string().nullable(),
    via: z.union([z.literal('wallet'), z.literal('chain'), z.literal('provider')]),
  }),
  z.object({
    ...base,
    state: z.literal('uncertain'),
    tx: z.string().nullable(),
    message: z.string(),
    signed: signedSchema.nullable(),
  }),
]);

export function swapTargetOf(
  address: string | undefined,
  memo: string | undefined
): SwapTarget | null {
  if (address === undefined || address === '') return null;
  return { address, memo: memo === undefined || memo === '' ? null : memo };
}

export function sendRecordKey(target: SwapTarget): string {
  const memo = target.memo === null ? '' : encodeURIComponent(target.memo);
  return `${SEND_RECORD_PREFIX}${encodeURIComponent(target.address)}:${memo}`;
}

function decodedSignature(transaction: string): string | null {
  try {
    const bytes = base64.decode(transaction);
    if (bytes[0] !== 1 || bytes.length < 65) return null;
    return base58.encode(bytes.subarray(1, 65));
  } catch {
    return null;
  }
}

function signedIsValid(signed: SignedTransfer | null, family: SendFamily): boolean {
  if (signed === null) return true;
  return (
    family === 'solana' &&
    isSolanaSignature(signed.signature) &&
    decodedSignature(signed.transaction) === signed.signature
  );
}

function txIsValid(tx: string | null, family: SendFamily): boolean {
  return tx === null || isSentTxFor(family, tx);
}

function sameTarget(a: SwapTarget, b: SwapTarget): boolean {
  return a.address === b.address && a.memo === b.memo;
}

export function validRecord(
  record: SendRecord,
  target: SwapTarget,
  family: SendFamily
): SendRecord | null {
  if (!sameTarget(record.swap, target) || record.family !== family) return null;
  if (record.state === 'sent') return txIsValid(record.tx, family) ? record : null;
  if (!signedIsValid(record.signed, family)) return null;
  if (record.state === 'uncertain' && !txIsValid(record.tx, family)) return null;
  return record;
}

function unreadable(target: SwapTarget, family: SendFamily): UncertainRecord {
  return {
    version: 1,
    state: 'uncertain',
    swap: target,
    family,
    account: '',
    startedAt: '',
    tx: null,
    message: UNREADABLE_RECORD_MESSAGE,
    signed: null,
  };
}

export function parseRecord(raw: string, target: SwapTarget, family: SendFamily): SendRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return unreadable(target, family);
  }
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) return unreadable(target, family);
  return validRecord(parsed.data, target, family) ?? unreadable(target, family);
}

export function attemptingRecord(input: {
  target: SwapTarget;
  family: SendFamily;
  account: string;
  now: Date;
}): AttemptingRecord {
  return {
    version: 1,
    state: 'attempting',
    swap: input.target,
    family: input.family,
    account: input.account,
    startedAt: input.now.toISOString(),
    signed: null,
  };
}

export function withSigned(
  record: AttemptingRecord,
  signed: { signature: string; transaction: Uint8Array; lastValidBlockHeight: bigint }
): AttemptingRecord {
  return {
    ...record,
    signed: {
      signature: signed.signature,
      transaction: base64.encode(signed.transaction),
      lastValidBlockHeight: signed.lastValidBlockHeight.toString(),
    },
  };
}

export function sentRecord(
  record: SendRecord,
  tx: string | null,
  via: SentRecord['via']
): SentRecord {
  return {
    version: 1,
    state: 'sent',
    swap: record.swap,
    family: record.family,
    account: record.account,
    startedAt: record.startedAt,
    tx,
    via,
  };
}

export function uncertainRecord(
  record: AttemptingRecord | UncertainRecord,
  message: string,
  tx: string | null
): UncertainRecord {
  return {
    version: 1,
    state: 'uncertain',
    swap: record.swap,
    family: record.family,
    account: record.account,
    startedAt: record.startedAt,
    tx: tx ?? record.signed?.signature ?? null,
    message,
    signed: record.signed,
  };
}

export function recordTx(record: SendRecord): string | null {
  if (record.state === 'attempting') return record.signed?.signature ?? null;
  return record.tx;
}

export function signedBytes(record: SendRecord): Uint8Array | null {
  if (record.state === 'sent' || record.signed === null) return null;
  return base64.decode(record.signed.transaction);
}

export function lastValidBlockHeight(record: SendRecord): bigint | null {
  if (record.state === 'sent' || record.signed === null) return null;
  return BigInt(record.signed.lastValidBlockHeight);
}

export function sameAttempt(a: SendRecord | null, b: SendRecord | null): boolean {
  return a !== null && b !== null && a.startedAt === b.startedAt && a.state === b.state;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SendLock {
  claim(name: string): Promise<boolean>;
  release(name: string): void;
}

export function sendLockName(target: SwapTarget): string {
  return `${sendRecordKey(target)}:lock`;
}

export type SendClaim = 'claimed' | 'busy' | 'unavailable';

export interface SendRecords {
  read(target: SwapTarget, family: SendFamily): SendRecord | null;
  write(record: SendRecord): boolean;
  clear(target: SwapTarget): boolean;
  durable(): boolean;
  lockable(): boolean;
  claim(target: SwapTarget): Promise<SendClaim>;
  release(target: SwapTarget): void;
}

export function createSendRecords(
  storage: () => KeyValueStore | null | undefined,
  lock: SendLock | null = null
): SendRecords {
  const memory = new Map<string, string>();

  function stored(key: string): string | null {
    try {
      return storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  return {
    read(target, family) {
      const key = sendRecordKey(target);
      const raw = memory.get(key) ?? stored(key);
      return raw === null ? null : parseRecord(raw, target, family);
    },
    write(record) {
      const key = sendRecordKey(record.swap);
      const json = JSON.stringify(record);
      try {
        const store = storage();
        if (store) {
          store.setItem(key, json);
          if (store.getItem(key) === json) {
            memory.delete(key);
            return true;
          }
        }
      } catch {
        memory.set(key, json);
        return false;
      }
      memory.set(key, json);
      return false;
    },
    clear(target) {
      const key = sendRecordKey(target);
      memory.delete(key);
      let cleared: boolean;
      try {
        const store = storage();
        store?.removeItem(key);
        cleared = (store?.getItem(key) ?? null) === null;
      } catch {
        cleared = false;
      }
      lock?.release(sendLockName(target));
      return cleared;
    },
    lockable() {
      return lock !== null;
    },
    async claim(target) {
      if (lock === null) return 'unavailable';
      try {
        return (await lock.claim(sendLockName(target))) ? 'claimed' : 'busy';
      } catch {
        return 'unavailable';
      }
    },
    release(target) {
      lock?.release(sendLockName(target));
    },
    durable() {
      try {
        const store = storage();
        if (!store) return false;
        store.setItem(PROBE_KEY, '1');
        const ok = store.getItem(PROBE_KEY) === '1';
        store.removeItem(PROBE_KEY);
        return ok;
      } catch {
        return false;
      }
    },
  };
}

export function watchSendRecords(target: EventTarget, onChange: () => void): () => void {
  function listener() {
    onChange();
  }
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}
