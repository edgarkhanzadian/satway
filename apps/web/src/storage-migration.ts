import { WALLETCONNECT_STORAGE_PREFIX } from './config.js';
import { RECEIPTS_KEY } from './receipt.js';
import { SENT_TX_PREFIX } from './source-wallet.js';

export const OLD_RECEIPTS_KEY = 'stxonector.receipts.v1';
export const OLD_SENT_TX_PREFIX = 'stxonector:sent-tx:';
export const OLD_WALLETCONNECT_STORAGE_PREFIX = 'stxonector-evm';

export const WALLETCONNECT_IDB_NAME = 'WALLET_CONNECT_V2_INDEXED_DB';
export const WALLETCONNECT_IDB_STORE = 'keyvaluestorage';
const WALLETCONNECT_MIGRATION_TIMEOUT_MS = 3000;

export type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface AsyncKeyStore {
  keys(): Promise<string[]>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export type Rename = (key: string) => string | null;

export function renameSentTx(key: string): string | null {
  if (!key.startsWith(OLD_SENT_TX_PREFIX)) return null;
  return SENT_TX_PREFIX + key.slice(OLD_SENT_TX_PREFIX.length);
}

export function renameWalletConnect(key: string): string | null {
  if (!key.startsWith('wc@')) return null;
  for (const separator of ['//', ':']) {
    const marker = OLD_WALLETCONNECT_STORAGE_PREFIX + separator;
    if (key.includes(marker)) return key.replace(marker, WALLETCONNECT_STORAGE_PREFIX + separator);
  }
  return null;
}

function listKeys(store: KeyStore): string[] {
  const keys: string[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

export function moveKey(store: KeyStore, from: string, to: string): void {
  try {
    const value = store.getItem(from);
    if (value === null || store.getItem(to) !== null) return;
    store.setItem(to, value);
    if (store.getItem(to) === value) store.removeItem(from);
  } catch {
    return;
  }
}

export function migrateKeys(store: KeyStore, rename: Rename): void {
  let keys: string[] = [];
  try {
    keys = listKeys(store);
  } catch {
    return;
  }
  for (const key of keys) {
    const target = rename(key);
    if (target !== null) moveKey(store, key, target);
  }
}

async function moveAsyncKey(store: AsyncKeyStore, from: string, to: string): Promise<void> {
  try {
    const value = await store.get(from);
    if (value === undefined || (await store.get(to)) !== undefined) return;
    await store.set(to, value);
    if ((await store.get(to)) !== undefined) await store.remove(from);
  } catch {
    return;
  }
}

export async function migrateAsyncKeys(store: AsyncKeyStore, rename: Rename): Promise<void> {
  let keys: string[] = [];
  try {
    keys = await store.keys();
  } catch {
    return;
  }
  for (const key of keys) {
    const target = rename(key);
    if (target !== null) await moveAsyncKey(store, key, target);
  }
}

function runRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WALLETCONNECT_IDB_STORE, mode);
    const request = work(tx.objectStore(WALLETCONNECT_IDB_STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function idbKeyStore(db: IDBDatabase): AsyncKeyStore {
  return {
    async keys() {
      const keys = await runRequest(db, 'readonly', store => store.getAllKeys());
      return keys.flatMap(key => (typeof key === 'string' ? [key] : []));
    },
    async get(key) {
      const value: unknown = await runRequest(db, 'readonly', store => store.get(key));
      return value;
    },
    async set(key, value) {
      await runRequest(db, 'readwrite', store => store.put(value, key));
    },
    async remove(key) {
      await runRequest(db, 'readwrite', store => store.delete(key));
    },
  };
}

function openExistingDatabase(factory: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    const request = factory.open(WALLETCONNECT_IDB_NAME);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
    };
    request.onerror = event => {
      event.preventDefault();
      resolve(null);
    };
    request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(WALLETCONNECT_IDB_STORE)) {
        resolve(db);
        return;
      }
      db.close();
      resolve(null);
    };
  });
}

async function migrateWalletConnectDatabase(): Promise<void> {
  try {
    if (typeof indexedDB === 'undefined') return;
    const db = await openExistingDatabase(indexedDB);
    if (!db) return;
    try {
      await migrateAsyncKeys(idbKeyStore(db), renameWalletConnect);
    } finally {
      db.close();
    }
  } catch {
    return;
  }
}

function browserStore(name: 'localStorage' | 'sessionStorage'): KeyStore | null {
  try {
    return globalThis[name];
  } catch {
    return null;
  }
}

export function migrateBrowserStorage(): void {
  const local = browserStore('localStorage');
  if (local) {
    moveKey(local, OLD_RECEIPTS_KEY, RECEIPTS_KEY);
    migrateKeys(local, renameWalletConnect);
  }
  const session = browserStore('sessionStorage');
  if (session) migrateKeys(session, renameSentTx);
}

let walletConnectMigration: Promise<void> | null = null;

export function migrateWalletConnectStorage(): Promise<void> {
  walletConnectMigration ??= Promise.race([
    migrateWalletConnectDatabase(),
    new Promise<void>(resolve => {
      setTimeout(resolve, WALLETCONNECT_MIGRATION_TIMEOUT_MS);
    }),
  ]);
  return walletConnectMigration;
}
