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

function browserLock(): SendLock | null {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return null;
  const locks = navigator.locks;
  async function lock<T>(name: string, task: () => Promise<T>): Promise<T> {
    return await locks.request(name, { mode: 'exclusive' }, task);
  }
  return lock;
}

export const sendRecords: SendRecords = createSendRecords(browserStorage);

export const sendLock: SendLock | null = browserLock();
