import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SEND_RECORD_PREFIX,
  type SentRecord,
  type SwapTarget,
  createSendRecords,
  sendRecordKey,
} from '@satway/chains';

import { WALLETCONNECT_STORAGE_PREFIX } from '../../src/shared/config.js';
import { RECEIPTS_KEY, loadReceipts } from '../../src/shared/receipt.js';
import {
  type AsyncKeyStore,
  type KeyStore,
  OLD_RECEIPTS_KEYS,
  OLD_WALLETCONNECT_PREFIXES,
  PORTAGE_RECEIPTS_KEY,
  PORTAGE_SEND_RECORD_PREFIX,
  PORTAGE_SENT_TX_PREFIX,
  PORTAGE_WALLETCONNECT_PREFIX,
  STXONECTOR_RECEIPTS_KEY,
  STXONECTOR_SENT_TX_PREFIX,
  STXONECTOR_WALLETCONNECT_PREFIX,
  WALLETCONNECT_RENAMES,
  dropKeys,
  isLegacySentTxKey,
  migrateAsyncKeys,
  migrateBrowserStorage,
  migrateKeys,
  moveKey,
  renameSendRecord,
  walletConnectRename,
} from '../../src/shared/storage-migration.js';

interface MemoryStore extends KeyStore {
  data: Map<string, string>;
}

function memoryStore(entries: [string, string][] = []): MemoryStore {
  const data = new Map(entries);
  return {
    data,
    get length() {
      return data.size;
    },
    key: index => Array.from(data.keys()).at(index) ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: key => void data.delete(key),
  };
}

interface MemoryAsyncStore extends AsyncKeyStore {
  data: Map<string, unknown>;
}

function memoryAsyncStore(entries: [string, unknown][] = [], failWrites = false): MemoryAsyncStore {
  const data = new Map(entries);
  return {
    data,
    keys: () => Promise.resolve(Array.from(data.keys())),
    get: key => Promise.resolve(data.get(key)),
    set(key, value) {
      if (failWrites) return Promise.reject(new Error('write failed'));
      data.set(key, value);
      return Promise.resolve();
    },
    remove(key) {
      data.delete(key);
      return Promise.resolve();
    },
  };
}

const SATWAY_RECEIPTS = 'satway.receipts.v1';
const HASH = '0x' + 'ab'.repeat(32);
const OTHER_HASH = '0x' + 'cd'.repeat(32);
const STXONECTOR_LIST = JSON.stringify(['stxonector']);
const PORTAGE_LIST = JSON.stringify(['portage']);
const SATWAY_LIST = JSON.stringify(['satway']);
const STXONECTOR_SENT_ONE = `${STXONECTOR_SENT_TX_PREFIX}bc1qone`;
const PORTAGE_SENT_TWO = `${PORTAGE_SENT_TX_PREFIX}bc1qtwo`;

function keychain(prefix: string): string {
  return `wc@2:core:0.3${prefix}//keychain`;
}
function idbSession(prefix: string): string {
  return `wc@2:client:0.3${prefix}:session`;
}
const STXONECTOR_WC_KEYCHAIN = keychain(STXONECTOR_WALLETCONNECT_PREFIX);
const PORTAGE_WC_KEYCHAIN = keychain(PORTAGE_WALLETCONNECT_PREFIX);
const SATWAY_WC_KEYCHAIN = 'wc@2:core:0.3satway-evm//keychain';
const STXONECTOR_WC_SESSION = idbSession(STXONECTOR_WALLETCONNECT_PREFIX);
const PORTAGE_WC_SESSION = idbSession(PORTAGE_WALLETCONNECT_PREFIX);
const SATWAY_WC_SESSION = 'wc@2:client:0.3satway-evm:session';
const WC_UNPREFIXED = 'wc@2:core:0.3//x';

const TARGET: SwapTarget = { address: '0xSwap:Address', memo: 'memo/1' };
const PORTAGE_SEND_KEY = `${PORTAGE_SEND_RECORD_PREFIX}0xSwap%3AAddress:memo%2F1`;
const SATWAY_SEND_KEY = `satway:send-record:v1:0xSwap%3AAddress:memo%2F1`;

function sent(tx: string): SentRecord {
  return {
    version: 1,
    state: 'sent',
    swap: TARGET,
    family: 'evm',
    account: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
    startedAt: '2026-11-15T08:00:00.000Z',
    tx,
    via: 'wallet',
  };
}

function migrateWith(local: MemoryStore, session: MemoryStore = memoryStore()): void {
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  migrateBrowserStorage();
}

describe('storage names', () => {
  it('names every generation and the current names explicitly', () => {
    expect(RECEIPTS_KEY).toBe(SATWAY_RECEIPTS);
    expect(WALLETCONNECT_STORAGE_PREFIX).toBe('satway-evm');
    expect(SEND_RECORD_PREFIX).toBe('satway:send-record:v1:');
    expect(STXONECTOR_RECEIPTS_KEY).toBe('stxonector.receipts.v1');
    expect(PORTAGE_RECEIPTS_KEY).toBe('portage.receipts.v1');
    expect(STXONECTOR_SENT_TX_PREFIX).toBe('stxonector:sent-tx:');
    expect(PORTAGE_SENT_TX_PREFIX).toBe('portage:sent-tx:');
    expect(STXONECTOR_WALLETCONNECT_PREFIX).toBe('stxonector-evm');
    expect(PORTAGE_WALLETCONNECT_PREFIX).toBe('portage-evm');
    expect(PORTAGE_SEND_RECORD_PREFIX).toBe('portage:send-record:v1:');
  });

  it('tries the newer generation first', () => {
    expect(OLD_RECEIPTS_KEYS).toEqual([PORTAGE_RECEIPTS_KEY, STXONECTOR_RECEIPTS_KEY]);
    expect(OLD_WALLETCONNECT_PREFIXES).toEqual([
      PORTAGE_WALLETCONNECT_PREFIX,
      STXONECTOR_WALLETCONNECT_PREFIX,
    ]);
    expect(WALLETCONNECT_RENAMES).toHaveLength(2);
  });

  it('recognises both generations of address-keyed sent-tx records by prefix only', () => {
    expect(isLegacySentTxKey(STXONECTOR_SENT_ONE)).toBe(true);
    expect(isLegacySentTxKey(PORTAGE_SENT_TWO)).toBe(true);
    expect(isLegacySentTxKey(`other:${STXONECTOR_SENT_ONE}`)).toBe(false);
    expect(isLegacySentTxKey(`${PORTAGE_SEND_RECORD_PREFIX}x:`)).toBe(false);
    expect(isLegacySentTxKey(`${SEND_RECORD_PREFIX}x:`)).toBe(false);
  });

  it('renames WalletConnect keys of each generation in both separator forms and nothing else', () => {
    const [fromPortage, fromStxonector] = WALLETCONNECT_RENAMES;
    if (fromPortage === undefined || fromStxonector === undefined) throw new Error('no renames');
    expect(fromStxonector(STXONECTOR_WC_KEYCHAIN)).toBe(SATWAY_WC_KEYCHAIN);
    expect(fromStxonector(STXONECTOR_WC_SESSION)).toBe(SATWAY_WC_SESSION);
    expect(fromPortage(PORTAGE_WC_KEYCHAIN)).toBe(SATWAY_WC_KEYCHAIN);
    expect(fromPortage(PORTAGE_WC_SESSION)).toBe(SATWAY_WC_SESSION);
    expect(fromPortage(STXONECTOR_WC_KEYCHAIN)).toBeNull();
    expect(fromStxonector(PORTAGE_WC_KEYCHAIN)).toBeNull();
    for (const rename of WALLETCONNECT_RENAMES) {
      expect(rename(SATWAY_WC_KEYCHAIN)).toBeNull();
      expect(rename(WC_UNPREFIXED)).toBeNull();
    }
    expect(
      walletConnectRename(PORTAGE_WALLETCONNECT_PREFIX)(`app:${PORTAGE_WALLETCONNECT_PREFIX}//k`)
    ).toBeNull();
  });

  it('renames portage send records to the same suffix under the satway prefix', () => {
    expect(renameSendRecord(PORTAGE_SEND_KEY)).toBe(SATWAY_SEND_KEY);
    expect(renameSendRecord(SATWAY_SEND_KEY)).toBeNull();
    expect(renameSendRecord('portage:send-record:probe')).toBeNull();
    expect(renameSendRecord(`${PORTAGE_SENT_TX_PREFIX}bc1qone`)).toBeNull();
    expect(sendRecordKey(TARGET)).toBe(SATWAY_SEND_KEY);
  });
});

describe('moveKey', () => {
  it('moves old-only data to the new key', () => {
    const store = memoryStore([[STXONECTOR_RECEIPTS_KEY, '[]']]);
    moveKey(store, STXONECTOR_RECEIPTS_KEY, SATWAY_RECEIPTS);
    expect(store.data).toEqual(new Map([[SATWAY_RECEIPTS, '[]']]));
  });

  it('never overwrites new data with old data and keeps the old copy', () => {
    const store = memoryStore([
      [PORTAGE_RECEIPTS_KEY, PORTAGE_LIST],
      [SATWAY_RECEIPTS, SATWAY_LIST],
    ]);
    moveKey(store, PORTAGE_RECEIPTS_KEY, SATWAY_RECEIPTS);
    expect(store.data.get(SATWAY_RECEIPTS)).toBe(SATWAY_LIST);
    expect(store.data.get(PORTAGE_RECEIPTS_KEY)).toBe(PORTAGE_LIST);
  });

  it('is idempotent', () => {
    const store = memoryStore([[PORTAGE_RECEIPTS_KEY, PORTAGE_LIST]]);
    moveKey(store, PORTAGE_RECEIPTS_KEY, SATWAY_RECEIPTS);
    const once = new Map(store.data);
    moveKey(store, PORTAGE_RECEIPTS_KEY, SATWAY_RECEIPTS);
    expect(store.data).toEqual(once);
  });

  it('keeps the old key when the write fails', () => {
    const store = memoryStore([[PORTAGE_RECEIPTS_KEY, PORTAGE_LIST]]);
    store.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => moveKey(store, PORTAGE_RECEIPTS_KEY, SATWAY_RECEIPTS)).not.toThrow();
    expect(store.data).toEqual(new Map([[PORTAGE_RECEIPTS_KEY, PORTAGE_LIST]]));
  });

  it('does not crash when storage itself throws', () => {
    const store = memoryStore();
    store.getItem = () => {
      throw new Error('SecurityError');
    };
    expect(() => moveKey(store, PORTAGE_RECEIPTS_KEY, SATWAY_RECEIPTS)).not.toThrow();
  });
});

describe('dropKeys', () => {
  it('drops every address-keyed sent-tx record and leaves other keys alone', () => {
    const store = memoryStore([
      [STXONECTOR_SENT_ONE, HASH],
      [PORTAGE_SENT_TWO, OTHER_HASH],
      ['unrelated', 'x'],
    ]);
    dropKeys(store, isLegacySentTxKey);
    expect(store.data).toEqual(new Map([['unrelated', 'x']]));
  });

  it('does not crash when listing or removing keys throws', () => {
    const listing = memoryStore([[STXONECTOR_SENT_ONE, HASH]]);
    listing.key = () => {
      throw new Error('SecurityError');
    };
    expect(() => dropKeys(listing, isLegacySentTxKey)).not.toThrow();
    const removing = memoryStore([[PORTAGE_SENT_TWO, HASH]]);
    removing.removeItem = () => {
      throw new Error('SecurityError');
    };
    expect(() => dropKeys(removing, isLegacySentTxKey)).not.toThrow();
  });
});

describe('migrateKeys', () => {
  it('is idempotent', () => {
    const store = memoryStore([[PORTAGE_WC_KEYCHAIN, '{"a":1}']]);
    for (const rename of WALLETCONNECT_RENAMES) migrateKeys(store, rename);
    const once = new Map(store.data);
    for (const rename of WALLETCONNECT_RENAMES) migrateKeys(store, rename);
    expect(store.data).toEqual(once);
    expect(store.data.get(SATWAY_WC_KEYCHAIN)).toBe('{"a":1}');
  });

  it('does not crash when listing keys throws', () => {
    const store = memoryStore();
    store.key = () => {
      throw new Error('SecurityError');
    };
    expect(() => migrateKeys(store, renameSendRecord)).not.toThrow();
  });
});

describe('migrateAsyncKeys', () => {
  async function migrateAll(store: AsyncKeyStore): Promise<void> {
    for (const rename of WALLETCONNECT_RENAMES) await migrateAsyncKeys(store, rename);
  }

  it.each([
    ['stxonector', STXONECTOR_WC_SESSION],
    ['portage', PORTAGE_WC_SESSION],
  ])('moves %s-only WalletConnect entries to the satway prefix', async (_name, from) => {
    const value = { topic: 't' };
    const store = memoryAsyncStore([
      [from, value],
      [WC_UNPREFIXED, 1],
    ]);
    await migrateAll(store);
    expect(store.data.get(SATWAY_WC_SESSION)).toBe(value);
    expect(store.data.has(from)).toBe(false);
    expect(store.data.get(WC_UNPREFIXED)).toBe(1);
  });

  it('prefers the portage entry over the stxonector one and keeps the stxonector copy', async () => {
    const store = memoryAsyncStore([
      [STXONECTOR_WC_SESSION, 'stxonector'],
      [PORTAGE_WC_SESSION, 'portage'],
    ]);
    await migrateAll(store);
    expect(store.data).toEqual(
      new Map([
        [STXONECTOR_WC_SESSION, 'stxonector'],
        [SATWAY_WC_SESSION, 'portage'],
      ])
    );
  });

  it('never overwrites a satway entry', async () => {
    const store = memoryAsyncStore([
      [STXONECTOR_WC_SESSION, 'stxonector'],
      [PORTAGE_WC_SESSION, 'portage'],
      [SATWAY_WC_SESSION, 'satway'],
    ]);
    await migrateAll(store);
    expect(store.data.get(SATWAY_WC_SESSION)).toBe('satway');
    expect(store.data.get(PORTAGE_WC_SESSION)).toBe('portage');
    expect(store.data.get(STXONECTOR_WC_SESSION)).toBe('stxonector');
  });

  it('keeps the old entry when the write fails', async () => {
    const store = memoryAsyncStore([[PORTAGE_WC_SESSION, 'portage']], true);
    await expect(migrateAll(store)).resolves.toBeUndefined();
    expect(store.data).toEqual(new Map([[PORTAGE_WC_SESSION, 'portage']]));
  });

  it('is idempotent', async () => {
    const store = memoryAsyncStore([
      [STXONECTOR_WC_SESSION, 'stxonector'],
      [PORTAGE_WC_SESSION, 'portage'],
    ]);
    await migrateAll(store);
    const once = new Map(store.data);
    await migrateAll(store);
    expect(store.data).toEqual(once);
  });

  it('does not crash when listing keys fails', async () => {
    const store = memoryAsyncStore();
    store.keys = () => Promise.reject(new Error('InvalidStateError'));
    await expect(migrateAll(store)).resolves.toBeUndefined();
  });
});

describe('migrateBrowserStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves stxonector-only data to the satway names and drops address-keyed sent-tx records', () => {
    const local = memoryStore([
      [STXONECTOR_RECEIPTS_KEY, STXONECTOR_LIST],
      [STXONECTOR_WC_KEYCHAIN, '"k"'],
      ['unrelated', 'stays'],
    ]);
    const session = memoryStore([
      [STXONECTOR_SENT_ONE, HASH],
      [PORTAGE_SENT_TWO, OTHER_HASH],
      ['other', 'kept'],
    ]);
    migrateWith(local, session);
    expect(local.data).toEqual(
      new Map([
        ['unrelated', 'stays'],
        [SATWAY_RECEIPTS, STXONECTOR_LIST],
        [SATWAY_WC_KEYCHAIN, '"k"'],
      ])
    );
    expect(session.data).toEqual(new Map([['other', 'kept']]));
  });

  it('moves portage-only data, send records included, to the satway names', () => {
    const local = memoryStore([
      [PORTAGE_RECEIPTS_KEY, PORTAGE_LIST],
      [PORTAGE_WC_KEYCHAIN, '"k"'],
      [PORTAGE_SEND_KEY, JSON.stringify(sent(HASH))],
    ]);
    migrateWith(local);
    expect(local.data).toEqual(
      new Map([
        [SATWAY_RECEIPTS, PORTAGE_LIST],
        [SATWAY_WC_KEYCHAIN, '"k"'],
        [SATWAY_SEND_KEY, JSON.stringify(sent(HASH))],
      ])
    );
  });

  it('lets portage win over stxonector and keeps the stxonector copy untouched', () => {
    const local = memoryStore([
      [STXONECTOR_RECEIPTS_KEY, STXONECTOR_LIST],
      [PORTAGE_RECEIPTS_KEY, PORTAGE_LIST],
      [STXONECTOR_WC_KEYCHAIN, '"stxonector"'],
      [PORTAGE_WC_KEYCHAIN, '"portage"'],
    ]);
    migrateWith(local);
    expect(local.data).toEqual(
      new Map([
        [STXONECTOR_RECEIPTS_KEY, STXONECTOR_LIST],
        [STXONECTOR_WC_KEYCHAIN, '"stxonector"'],
        [SATWAY_RECEIPTS, PORTAGE_LIST],
        [SATWAY_WC_KEYCHAIN, '"portage"'],
      ])
    );
  });

  it('lets portage win regardless of the order the browser lists keys in', () => {
    const local = memoryStore([
      [PORTAGE_WC_KEYCHAIN, '"portage"'],
      [STXONECTOR_WC_KEYCHAIN, '"stxonector"'],
    ]);
    migrateWith(local);
    expect(local.data.get(SATWAY_WC_KEYCHAIN)).toBe('"portage"');
  });

  it('never overwrites data already saved under the satway names', () => {
    const satwayRecord = JSON.stringify(sent(OTHER_HASH));
    const entries: [string, string][] = [
      [STXONECTOR_RECEIPTS_KEY, STXONECTOR_LIST],
      [PORTAGE_RECEIPTS_KEY, PORTAGE_LIST],
      [SATWAY_RECEIPTS, SATWAY_LIST],
      [STXONECTOR_WC_KEYCHAIN, '"stxonector"'],
      [PORTAGE_WC_KEYCHAIN, '"portage"'],
      [SATWAY_WC_KEYCHAIN, '"satway"'],
      [PORTAGE_SEND_KEY, JSON.stringify(sent(HASH))],
      [SATWAY_SEND_KEY, satwayRecord],
    ];
    const local = memoryStore(entries);
    migrateWith(local);
    expect(local.data).toEqual(new Map(entries));
  });

  it('leaves a migrated send record where the send-record lookup finds it', () => {
    const local = memoryStore([[PORTAGE_SEND_KEY, JSON.stringify(sent(HASH))]]);
    migrateWith(local);
    const records = createSendRecords(() => local);
    expect(records.read(TARGET, 'evm')).toEqual(sent(HASH));
    expect(records.read({ ...TARGET, memo: null }, 'evm')).toBeNull();
  });

  it('is idempotent across every generation', () => {
    const local = memoryStore([
      [STXONECTOR_RECEIPTS_KEY, STXONECTOR_LIST],
      [PORTAGE_RECEIPTS_KEY, PORTAGE_LIST],
      [STXONECTOR_WC_KEYCHAIN, '"stxonector"'],
      [PORTAGE_SEND_KEY, JSON.stringify(sent(HASH))],
    ]);
    migrateWith(local);
    const once = new Map(local.data);
    migrateBrowserStorage();
    expect(local.data).toEqual(once);
  });

  it('copies corrupt old receipts without crashing, and loading them still works', () => {
    const local = memoryStore([[PORTAGE_RECEIPTS_KEY, '{not json']]);
    migrateWith(local);
    expect(local.data.get(SATWAY_RECEIPTS)).toBe('{not json');
    expect(loadReceipts()).toEqual([]);
  });

  it('keeps every old key when writing the new names throws', () => {
    const entries: [string, string][] = [
      [STXONECTOR_RECEIPTS_KEY, STXONECTOR_LIST],
      [PORTAGE_RECEIPTS_KEY, PORTAGE_LIST],
      [PORTAGE_WC_KEYCHAIN, '"portage"'],
      [PORTAGE_SEND_KEY, JSON.stringify(sent(HASH))],
    ];
    const local = memoryStore(entries);
    local.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => migrateWith(local)).not.toThrow();
    expect(local.data).toEqual(new Map(entries));
  });

  it('does not crash when every storage call throws', () => {
    const local = memoryStore([[PORTAGE_RECEIPTS_KEY, PORTAGE_LIST]]);
    function fail(): never {
      throw new Error('SecurityError');
    }
    local.getItem = fail;
    local.key = fail;
    local.setItem = fail;
    local.removeItem = fail;
    expect(() => migrateWith(local, local)).not.toThrow();
    expect(local.data).toEqual(new Map([[PORTAGE_RECEIPTS_KEY, PORTAGE_LIST]]));
  });

  it('does nothing harmful when storage is missing', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => migrateBrowserStorage()).not.toThrow();
  });
});
