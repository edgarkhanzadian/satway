import { type KeyValueStore, type SendRecords, createSendRecords } from '@portage/chains';

function browserStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const sendRecords: SendRecords = createSendRecords(browserStorage);
