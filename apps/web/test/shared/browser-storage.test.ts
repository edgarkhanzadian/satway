import { afterEach, describe, expect, it, vi } from 'vitest';

import { localStorageWorks } from '../../src/shared/browser-storage.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

describe('localStorageWorks', () => {
  it('is true when a value can be written, read back and removed, and leaves nothing behind', () => {
    const store = memoryStorage();
    vi.stubGlobal('localStorage', store);
    expect(localStorageWorks()).toBe(true);
    expect(store.data.size).toBe(0);
  });

  it('is false when the browser blocks access to localStorage', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      expect(localStorageWorks()).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('is false when writes fail', () => {
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      setItem() {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      },
    });
    expect(localStorageWorks()).toBe(false);
  });
});
