import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  SLOW_REQUEST_TIMEOUT_MS,
  fetchTipHeight,
  withTimeout,
  z,
} from '../../src/index.js';
import { requestJson } from '../../src/shared/index.js';

afterEach(() => {
  vi.useRealTimers();
});

function hanging(seen: (AbortSignal | null)[] = [], respectAbort = true) {
  function fetchFn(_url: string, init?: RequestInit): Promise<Response> {
    const signal = init?.signal ?? null;
    seen.push(signal);
    return new Promise((_, reject) => {
      if (respectAbort) {
        signal?.addEventListener('abort', () => {
          const reason: unknown = signal.reason;
          reject(reason instanceof Error ? reason : new Error('aborted'));
        });
      }
    });
  }
  return fetchFn;
}

describe('request timeouts', () => {
  it('gives up on a hanging read after the default timeout and aborts the request', async () => {
    vi.useFakeTimers();
    const seen: (AbortSignal | null)[] = [];
    const pending = fetchTipHeight('https://btc.example/api', hanging(seen));
    const outcome = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS - 1);
    expect(seen[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(seen[0]?.aborted).toBe(true);
    await expect(pending).rejects.toThrow(
      'No answer from https://btc.example/api/blocks/tip/height within 15 seconds'
    );
  });

  it('still gives up when the fetch function ignores the abort signal', async () => {
    vi.useFakeTimers();
    const pending = requestJson(hanging([], false), 'https://x.example/slow', z.looseObject({}), {
      timeoutMs: 1_000,
    });
    const outcome = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await outcome;
  });

  it('covers reading the body, not only the headers', async () => {
    vi.useFakeTimers();
    function slowBody(_url: string, init?: RequestInit): Promise<Response> {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }
    const pending = requestJson(slowBody, 'https://x.example/body', z.looseObject({}));
    const outcome = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    await outcome;
  });

  it('lets a quick answer through and clears its timer', async () => {
    vi.useFakeTimers();
    const answer = await withTimeout(
      'https://x.example',
      { timeoutMs: SLOW_REQUEST_TIMEOUT_MS },
      () => Promise.resolve(7)
    );
    expect(answer).toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a caller abort through without calling it a timeout', async () => {
    const outer = new AbortController();
    const pending = withTimeout('https://x.example', { signal: outer.signal }, init =>
      hanging()('https://x.example', init)
    );
    outer.abort(new Error('the page moved on'));
    await expect(pending).rejects.toThrow('the page moved on');
  });
});
