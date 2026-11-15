const PROBE_KEY = 'portage:storage-probe';

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
