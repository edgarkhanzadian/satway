import { afterEach, describe, expect, it, vi } from 'vitest';

import { RECEIPTS_KEY, loadReceipts } from '../src/receipt.js';
import {
  type AsyncKeyStore,
  type KeyStore,
  LEGACY_SENT_TX_PREFIX,
  OLD_RECEIPTS_KEY,
  OLD_SENT_TX_PREFIX,
  OLD_WALLETCONNECT_STORAGE_PREFIX,
  dropKeys,
  isLegacySentTxKey,
  migrateAsyncKeys,
  migrateBrowserStorage,
  migrateKeys,
  moveKey,
  renameWalletConnect,
} from '../src/storage-migration.js';

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

const NEW_RECEIPTS = 'portage.receipts.v1';
const HASH = '0x' + 'ab'.repeat(32);
const OTHER_HASH = '0x' + 'cd'.repeat(32);
const OLD_LIST = JSON.stringify(['old']);
const NEW_LIST = JSON.stringify(['new']);
const OLD_SENT_ONE = `${OLD_SENT_TX_PREFIX}bc1qone`;
const NEW_SENT_ONE = 'portage:sent-tx:bc1qone';
const NEW_SENT_TWO = 'portage:sent-tx:bc1qtwo';
const OLD_WC_KEYCHAIN = `wc@2:core:0.3${OLD_WALLETCONNECT_STORAGE_PREFIX}//keychain`;
const NEW_WC_KEYCHAIN = 'wc@2:core:0.3portage-evm//keychain';
const OLD_WC_SESSION_IDB = `wc@2:client:0.3${OLD_WALLETCONNECT_STORAGE_PREFIX}:session`;
const NEW_WC_SESSION_IDB = 'wc@2:client:0.3portage-evm:session';
const WC_UNPREFIXED = 'wc@2:core:0.3//x';

describe('storage names', () => {
  it('keeps the old names apart from the new ones', () => {
    expect(OLD_RECEIPTS_KEY).toBe('stxonector.receipts.v1');
    expect(RECEIPTS_KEY).toBe(NEW_RECEIPTS);
    expect(OLD_SENT_TX_PREFIX).toBe('stxonector:sent-tx:');
    expect(OLD_WALLETCONNECT_STORAGE_PREFIX).toBe('stxonector-evm');
  });

  it('recognises both generations of address-keyed sent-tx records by prefix only', () => {
    expect(LEGACY_SENT_TX_PREFIX).toBe('portage:sent-tx:');
    expect(isLegacySentTxKey(OLD_SENT_ONE)).toBe(true);
    expect(isLegacySentTxKey(NEW_SENT_ONE)).toBe(true);
    expect(isLegacySentTxKey(`other:${OLD_SENT_ONE}`)).toBe(false);
    expect(isLegacySentTxKey('portage:send-record:v1:x:')).toBe(false);
  });

  it('renames WalletConnect keys in both separator forms and nothing else', () => {
    expect(renameWalletConnect(OLD_WC_KEYCHAIN)).toBe(NEW_WC_KEYCHAIN);
    expect(renameWalletConnect(OLD_WC_SESSION_IDB)).toBe(NEW_WC_SESSION_IDB);
    expect(renameWalletConnect(NEW_WC_KEYCHAIN)).toBeNull();
    expect(renameWalletConnect(WC_UNPREFIXED)).toBeNull();
    expect(renameWalletConnect(`app:${OLD_WALLETCONNECT_STORAGE_PREFIX}//keychain`)).toBeNull();
  });
});

describe('moveKey', () => {
  it('moves old-only data to the new key', () => {
    const store = memoryStore([[OLD_RECEIPTS_KEY, '[]']]);
    moveKey(store, OLD_RECEIPTS_KEY, NEW_RECEIPTS);
    expect(store.data).toEqual(new Map([[NEW_RECEIPTS, '[]']]));
  });

  it('never overwrites new data with old data and keeps the old copy', () => {
    const store = memoryStore([
      [OLD_RECEIPTS_KEY, OLD_LIST],
      [NEW_RECEIPTS, NEW_LIST],
    ]);
    moveKey(store, OLD_RECEIPTS_KEY, NEW_RECEIPTS);
    expect(store.data.get(NEW_RECEIPTS)).toBe(NEW_LIST);
    expect(store.data.get(OLD_RECEIPTS_KEY)).toBe(OLD_LIST);
  });

  it('is idempotent', () => {
    const store = memoryStore([[OLD_RECEIPTS_KEY, OLD_LIST]]);
    moveKey(store, OLD_RECEIPTS_KEY, NEW_RECEIPTS);
    const once = new Map(store.data);
    moveKey(store, OLD_RECEIPTS_KEY, NEW_RECEIPTS);
    expect(store.data).toEqual(once);
  });

  it('keeps the old key when the write fails', () => {
    const store = memoryStore([[OLD_RECEIPTS_KEY, OLD_LIST]]);
    store.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => moveKey(store, OLD_RECEIPTS_KEY, NEW_RECEIPTS)).not.toThrow();
    expect(store.data).toEqual(new Map([[OLD_RECEIPTS_KEY, OLD_LIST]]));
  });

  it('does not crash when storage itself throws', () => {
    const store = memoryStore();
    store.getItem = () => {
      throw new Error('SecurityError');
    };
    expect(() => moveKey(store, OLD_RECEIPTS_KEY, NEW_RECEIPTS)).not.toThrow();
  });
});

describe('dropKeys', () => {
  it('drops every address-keyed sent-tx record and leaves other keys alone', () => {
    const store = memoryStore([
      [OLD_SENT_ONE, HASH],
      [NEW_SENT_TWO, OTHER_HASH],
      ['unrelated', 'x'],
    ]);
    dropKeys(store, isLegacySentTxKey);
    expect(store.data).toEqual(new Map([['unrelated', 'x']]));
  });

  it('does not crash when listing or removing keys throws', () => {
    const listing = memoryStore([[OLD_SENT_ONE, HASH]]);
    listing.key = () => {
      throw new Error('SecurityError');
    };
    expect(() => dropKeys(listing, isLegacySentTxKey)).not.toThrow();
    const removing = memoryStore([[OLD_SENT_ONE, HASH]]);
    removing.removeItem = () => {
      throw new Error('SecurityError');
    };
    expect(() => dropKeys(removing, isLegacySentTxKey)).not.toThrow();
  });
});

describe('migrateKeys', () => {
  it('is idempotent', () => {
    const store = memoryStore([[OLD_WC_KEYCHAIN, '{"a":1}']]);
    migrateKeys(store, renameWalletConnect);
    const once = new Map(store.data);
    migrateKeys(store, renameWalletConnect);
    expect(store.data).toEqual(once);
    expect(store.data.get(NEW_WC_KEYCHAIN)).toBe('{"a":1}');
  });

  it('does not crash when listing keys throws', () => {
    const store = memoryStore();
    store.key = () => {
      throw new Error('SecurityError');
    };
    expect(() => migrateKeys(store, renameWalletConnect)).not.toThrow();
  });
});

describe('migrateAsyncKeys', () => {
  it('moves old-only WalletConnect entries to the new prefix', async () => {
    const value = { topic: 't' };
    const store = memoryAsyncStore([
      [OLD_WC_SESSION_IDB, value],
      [WC_UNPREFIXED, 1],
    ]);
    await migrateAsyncKeys(store, renameWalletConnect);
    expect(store.data.get(NEW_WC_SESSION_IDB)).toBe(value);
    expect(store.data.has(OLD_WC_SESSION_IDB)).toBe(false);
    expect(store.data.get(WC_UNPREFIXED)).toBe(1);
  });

  it('never overwrites a new entry', async () => {
    const store = memoryAsyncStore([
      [OLD_WC_SESSION_IDB, 'old'],
      [NEW_WC_SESSION_IDB, 'new'],
    ]);
    await migrateAsyncKeys(store, renameWalletConnect);
    expect(store.data.get(NEW_WC_SESSION_IDB)).toBe('new');
    expect(store.data.get(OLD_WC_SESSION_IDB)).toBe('old');
  });

  it('keeps the old entry when the write fails', async () => {
    const store = memoryAsyncStore([[OLD_WC_SESSION_IDB, 'old']], true);
    await expect(migrateAsyncKeys(store, renameWalletConnect)).resolves.toBeUndefined();
    expect(store.data).toEqual(new Map([[OLD_WC_SESSION_IDB, 'old']]));
  });

  it('is idempotent', async () => {
    const store = memoryAsyncStore([[OLD_WC_SESSION_IDB, 'old']]);
    await migrateAsyncKeys(store, renameWalletConnect);
    const once = new Map(store.data);
    await migrateAsyncKeys(store, renameWalletConnect);
    expect(store.data).toEqual(once);
  });

  it('does not crash when listing keys fails', async () => {
    const store = memoryAsyncStore();
    store.keys = () => Promise.reject(new Error('InvalidStateError'));
    await expect(migrateAsyncKeys(store, renameWalletConnect)).resolves.toBeUndefined();
  });
});

describe('migrateBrowserStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('migrates receipts and WalletConnect fallback keys, and drops address-keyed sent-tx records', () => {
    const local = memoryStore([
      [OLD_RECEIPTS_KEY, '[]'],
      [OLD_WC_KEYCHAIN, '"k"'],
    ]);
    const session = memoryStore([
      [OLD_SENT_ONE, HASH],
      [NEW_SENT_TWO, OTHER_HASH],
      ['other', 'kept'],
    ]);
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);
    migrateBrowserStorage();
    expect(local.data).toEqual(
      new Map([
        [NEW_RECEIPTS, '[]'],
        [NEW_WC_KEYCHAIN, '"k"'],
      ])
    );
    expect(session.data).toEqual(new Map([['other', 'kept']]));
  });

  it('copies corrupt old receipts without crashing, and loading them still works', () => {
    const local = memoryStore([[OLD_RECEIPTS_KEY, '{not json']]);
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', memoryStore());
    expect(() => migrateBrowserStorage()).not.toThrow();
    expect(local.data.get(NEW_RECEIPTS)).toBe('{not json');
    expect(loadReceipts()).toEqual([]);
  });

  it('does nothing harmful when storage is missing', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => migrateBrowserStorage()).not.toThrow();
  });
});
