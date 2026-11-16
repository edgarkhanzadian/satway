const PROBE_KEY = 'satway:storage-probe';

export function emptyListNote(what: 'deposits' | 'withdrawals', storageWorks: boolean): string {
  if (storageWorks) {
    return what === 'deposits'
      ? 'This browser does not remember any deposits yet.'
      : 'This browser does not remember any withdrawals.';
  }
  return `This browser’s storage is unavailable, so it cannot remember your ${what} here. Load a receipt file below to check one.`;
}

export function localStorageWorks(): boolean {
  try {
    const store = globalThis.localStorage;
    store.setItem(PROBE_KEY, '1');
    const ok = store.getItem(PROBE_KEY) === '1';
    store.removeItem(PROBE_KEY);
    return ok;
  } catch {
    return false;
  }
}
