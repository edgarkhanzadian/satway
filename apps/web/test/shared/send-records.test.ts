import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadLock() {
  const { sendLock } = await import('../../src/shared/send-records.js');
  return sendLock;
}

describe('sendLock', () => {
  it('runs the task inside an exclusive Web Lock with the given name', async () => {
    const requests: { name: string; mode: string | undefined }[] = [];
    vi.stubGlobal('navigator', {
      locks: {
        request(name: string, options: { mode?: string }, task: () => Promise<unknown>) {
          requests.push({ name, mode: options.mode });
          return task();
        },
      },
    });
    const lock = await loadLock();
    expect(lock).not.toBeNull();
    expect(await lock?.('portage:send-record:v1:0xswap::lock', () => Promise.resolve(7))).toBe(7);
    expect(requests).toEqual([{ name: 'portage:send-record:v1:0xswap::lock', mode: 'exclusive' }]);
  });

  it('is absent when the browser has no Web Locks, so wallet sending is refused', async () => {
    vi.stubGlobal('navigator', {});
    expect(await loadLock()).toBeNull();
  });
});
