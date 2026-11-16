import { describe, expect, it } from 'vitest';

import { realUnmount } from '../../src/shared/index.js';

describe('realUnmount', () => {
  it('runs the cleanup after a real unmount, once', async () => {
    let runs = 0;
    const latch = realUnmount(() => {
      runs += 1;
    });
    latch.mount();
    latch.unmount();
    expect(runs).toBe(0);
    await Promise.resolve();
    expect(runs).toBe(1);
    await Promise.resolve();
    expect(runs).toBe(1);
  });

  it('skips the cleanup when StrictMode mounts again in the same task', async () => {
    let runs = 0;
    const latch = realUnmount(() => {
      runs += 1;
    });
    latch.mount();
    latch.unmount();
    latch.mount();
    await Promise.resolve();
    expect(runs).toBe(0);
    latch.unmount();
    await Promise.resolve();
    expect(runs).toBe(1);
  });
});
