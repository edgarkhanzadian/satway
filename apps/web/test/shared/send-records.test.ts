import { afterEach, describe, expect, it, vi } from 'vitest';

import { webLocksClaim } from '../../src/shared/send-records.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function fakeLockManager() {
  const held = new Set<string>();
  const requests: { name: string; mode: string | undefined; ifAvailable: boolean | undefined }[] =
    [];
  async function request(
    name: string,
    options: LockOptions,
    task: (lock: Lock | null) => Promise<void>
  ): Promise<void> {
    requests.push({ name, mode: options.mode, ifAvailable: options.ifAvailable });
    if (held.has(name)) {
      await task(null);
      return;
    }
    held.add(name);
    try {
      await task({ name, mode: options.mode ?? 'exclusive' });
    } finally {
      held.delete(name);
    }
  }
  return { held, requests, request };
}

describe('webLocksClaim', () => {
  it('claims an exclusive Web Lock without waiting, holds it until released, and lets one tab re-enter', async () => {
    const fake = fakeLockManager();
    const tabA = webLocksClaim(fake);
    const tabB = webLocksClaim(fake);
    const name = 'satway:send-record:v1:0xswap::lock';
    expect(await tabA.claim(name)).toBe(true);
    expect(fake.held.has(name)).toBe(true);
    expect(await tabA.claim(name)).toBe(true);
    expect(await tabB.claim(name)).toBe(false);
    tabA.release(name);
    await vi.waitFor(() => expect(fake.held.has(name)).toBe(false));
    expect(await tabB.claim(name)).toBe(true);
    expect(fake.requests[0]).toEqual({ name, mode: 'exclusive', ifAvailable: true });
  });
});

describe('sendRecords', () => {
  it('refuses wallet sending when the browser has no Web Locks', async () => {
    vi.stubGlobal('navigator', {});
    const { sendRecords } = await import('../../src/shared/send-records.js');
    expect(sendRecords.lockable()).toBe(false);
    expect(await sendRecords.claim({ address: '0xswap', memo: null })).toBe('unavailable');
  });
});
