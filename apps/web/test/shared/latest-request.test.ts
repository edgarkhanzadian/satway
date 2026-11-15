import { describe, expect, it } from 'vitest';

import { latestRequests } from '../../src/shared/latest-request.js';

function deferred<T>() {
  let settle: ((value: T) => void) | null = null;
  const promise = new Promise<T>(r => {
    settle = r;
  });
  function resolve(value: T) {
    settle?.(value);
  }
  return { promise, resolve };
}

describe('latestRequests', () => {
  it('applies only the latest selection when an earlier one finishes last', async () => {
    const requests = latestRequests();
    const shown: string[] = [];
    const slowA = deferred<string>();
    const fastB = deferred<string>();

    async function select(load: Promise<string>) {
      const isLatest = requests.begin();
      const snapshot = await load;
      if (isLatest()) shown.push(snapshot);
    }

    const a = select(slowA.promise);
    const b = select(fastB.promise);
    fastB.resolve('snapshot of B');
    await b;
    slowA.resolve('snapshot of A');
    await a;
    expect(shown).toEqual(['snapshot of B']);
  });

  it('lets a follow-up step check the selection it started under without starting a new one', () => {
    const requests = latestRequests();
    const open = requests.begin();
    const reclaim = requests.current();
    expect(open()).toBe(true);
    expect(reclaim()).toBe(true);
    requests.begin();
    expect(open()).toBe(false);
    expect(reclaim()).toBe(false);
  });

  it('drops a pending result once the inputs change', () => {
    const requests = latestRequests();
    const quote = requests.begin();
    requests.cancel();
    expect(quote()).toBe(false);
    expect(requests.begin()()).toBe(true);
  });
});
