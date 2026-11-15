import {
  type KeyValueStore,
  type SendLock,
  type SendRecords,
  createSendRecords,
} from '@portage/chains';

function browserStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface LockRequester {
  request(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<void>
  ): Promise<unknown>;
}

export function webLocksClaim(locks: LockRequester): SendLock {
  const held = new Map<string, () => void>();
  function claim(name: string): Promise<boolean> {
    if (held.has(name)) return Promise.resolve(true);
    return new Promise<boolean>((resolve, reject) => {
      async function hold(lock: Lock | null): Promise<void> {
        if (lock === null) {
          resolve(false);
          return;
        }
        await new Promise<void>(release => {
          held.set(name, release);
          resolve(true);
        });
      }
      async function request(): Promise<void> {
        try {
          await locks.request(name, { mode: 'exclusive', ifAvailable: true }, hold);
        } catch (err) {
          held.delete(name);
          reject(err instanceof Error ? err : new Error('The browser refused the lock'));
        }
      }
      void request();
    });
  }
  function release(name: string): void {
    const free = held.get(name);
    held.delete(name);
    free?.();
  }
  return { claim, release };
}

function browserLock(): SendLock | null {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return null;
  return webLocksClaim(navigator.locks);
}

export const sendRecords: SendRecords = createSendRecords(browserStorage, browserLock());
