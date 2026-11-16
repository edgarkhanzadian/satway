import { z } from '@satway/core';

import { isTxHash } from './source-wallet.js';

export interface SwapTarget {
  address: string;
  memo: string | null;
}

export interface AttemptingRecord {
  version: 1;
  state: 'attempting';
  swap: SwapTarget;
  account: string;
  startedAt: string;
}

export interface SentRecord {
  version: 1;
  state: 'sent';
  swap: SwapTarget;
  account: string;
  startedAt: string;
  tx: string | null;
  via: 'wallet' | 'chain' | 'provider';
  confirmed: boolean;
}

export interface UncertainRecord {
  version: 1;
  state: 'uncertain';
  swap: SwapTarget;
  account: string;
  startedAt: string;
  tx: string | null;
  message: string;
}

export type SendRecord = AttemptingRecord | SentRecord | UncertainRecord;

export const SEND_RECORD_PREFIX = 'satway:send-record:v1:';
const PROBE_KEY = 'satway:send-record:probe';
export const UNREADABLE_RECORD_MESSAGE =
  'A saved record of an earlier send from your wallet could not be read.';

const swapSchema = z.object({ address: z.string().min(1), memo: z.string().min(1).nullable() });
const base = {
  version: z.literal(1),
  swap: swapSchema,
  account: z.string(),
  startedAt: z.string(),
};

const recordSchema: z.ZodType<SendRecord> = z.discriminatedUnion('state', [
  z.object({ ...base, state: z.literal('attempting') }),
  z.object({
    ...base,
    state: z.literal('sent'),
    tx: z.string().nullable(),
    via: z.union([z.literal('wallet'), z.literal('chain'), z.literal('provider')]),
    confirmed: z.boolean(),
  }),
  z.object({
    ...base,
    state: z.literal('uncertain'),
    tx: z.string().nullable(),
    message: z.string(),
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

function txIsValid(tx: string | null): boolean {
  return tx === null || isTxHash(tx);
}

function sameTarget(a: SwapTarget, b: SwapTarget): boolean {
  return a.address === b.address && a.memo === b.memo;
}

export function validRecord(record: SendRecord, target: SwapTarget): SendRecord | null {
  if (!sameTarget(record.swap, target)) return null;
  if (record.state !== 'attempting' && !txIsValid(record.tx)) return null;
  return record;
}

function unreadable(target: SwapTarget): UncertainRecord {
  return {
    version: 1,
    state: 'uncertain',
    swap: target,
    account: '',
    startedAt: '',
    tx: null,
    message: UNREADABLE_RECORD_MESSAGE,
  };
}

export function parseRecord(raw: string, target: SwapTarget): SendRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return unreadable(target);
  }
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) return unreadable(target);
  return validRecord(parsed.data, target) ?? unreadable(target);
}

export function attemptingRecord(input: {
  target: SwapTarget;
  account: string;
  now: Date;
}): AttemptingRecord {
  return {
    version: 1,
    state: 'attempting',
    swap: input.target,
    account: input.account,
    startedAt: input.now.toISOString(),
  };
}

export function sendConfirmed(record: SentRecord): boolean {
  return record.confirmed;
}

export function needsChainCheck(record: SendRecord): boolean {
  if (recordTx(record) === null) return false;
  return record.state !== 'sent' || !sendConfirmed(record);
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
    account: record.account,
    startedAt: record.startedAt,
    tx,
    via,
    confirmed: via !== 'wallet',
  };
}

export function confirmedRecord(record: SentRecord): SentRecord {
  return { ...record, confirmed: true };
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
    account: record.account,
    startedAt: record.startedAt,
    tx,
    message,
  };
}

export function recordTx(record: SendRecord): string | null {
  if (record.state === 'attempting') return null;
  return record.tx;
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
  read(target: SwapTarget): SendRecord | null;
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
    read(target) {
      const key = sendRecordKey(target);
      const raw = memory.get(key) ?? stored(key);
      return raw === null ? null : parseRecord(raw, target);
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

export function releaseIfCleared(records: SendRecords, target: SwapTarget): boolean {
  if (records.read(target) !== null) return false;
  records.release(target);
  return true;
}

export function watchSendRecords(target: EventTarget, onChange: () => void): () => void {
  function listener() {
    onChange();
  }
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}
