import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { abortableFetch } from '../../src/shared/index.js';

const any: unknown = Reflect.get(AbortSignal, 'any');

function recording() {
  const seen: (AbortSignal | null | undefined)[] = [];
  function base(_input: string, init?: RequestInit) {
    seen.push(init?.signal);
    return Promise.resolve(new Response('ok'));
  }
  return { seen, base };
}

function hanging(reason: Error) {
  const seen: (AbortSignal | null | undefined)[] = [];
  function base(_input: string, init?: RequestInit) {
    seen.push(init?.signal);
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(reason));
    });
  }
  return { seen, base };
}

describe('abortableFetch without AbortSignal.any', () => {
  beforeEach(() => {
    Reflect.deleteProperty(AbortSignal, 'any');
  });
  afterEach(() => {
    Reflect.set(AbortSignal, 'any', any);
  });

  it('passes the outer signal when the call has none', async () => {
    const outer = new AbortController();
    const { seen, base } = recording();
    await abortableFetch(outer.signal, base)('https://example.test');
    expect(seen).toEqual([outer.signal]);
  });

  it('aborts an in-flight request when either the outer or the call signal aborts', async () => {
    for (const which of ['outer', 'inner']) {
      const outer = new AbortController();
      const inner = new AbortController();
      const reason = new Error(which);
      const { seen, base } = hanging(reason);
      const pending = abortableFetch(outer.signal, base)('https://example.test', {
        signal: inner.signal,
      });
      (which === 'outer' ? outer : inner).abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(seen[0]?.aborted).toBe(true);
      expect(seen[0]?.reason).toBe(reason);
    }
  });

  it('lets go of both signals once the request settles', async () => {
    const outer = new AbortController();
    const inner = new AbortController();
    const { seen, base } = recording();
    await abortableFetch(outer.signal, base)('https://example.test', { signal: inner.signal });
    outer.abort(new Error('later'));
    expect(seen[0]?.aborted).toBe(false);
  });

  it('starts aborted when a signal already is', async () => {
    const outer = new AbortController();
    const inner = new AbortController();
    inner.abort(new Error('before'));
    const { seen, base } = recording();
    await abortableFetch(outer.signal, base)('https://example.test', { signal: inner.signal });
    expect(seen[0]?.aborted).toBe(true);
  });
});
