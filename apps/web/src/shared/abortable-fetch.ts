import type { FetchLike } from '@satway/core';

interface Joined {
  signal: AbortSignal;
  release(): void;
}

function joined(first: AbortSignal, second: AbortSignal): Joined {
  const controller = new AbortController();
  function fromFirst() {
    controller.abort(first.reason);
  }
  function fromSecond() {
    controller.abort(second.reason);
  }
  function release() {
    first.removeEventListener('abort', fromFirst);
    second.removeEventListener('abort', fromSecond);
  }
  if (first.aborted) fromFirst();
  else if (second.aborted) fromSecond();
  else {
    first.addEventListener('abort', fromFirst, { once: true });
    second.addEventListener('abort', fromSecond, { once: true });
  }
  return { signal: controller.signal, release };
}

function browserFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

export function abortableFetch(signal: AbortSignal, base: FetchLike = browserFetch): FetchLike {
  return async (input, init) => {
    const inner = init?.signal;
    if (!inner) return base(input, { ...init, signal });
    const both = joined(inner, signal);
    try {
      return await base(input, { ...init, signal: both.signal });
    } finally {
      both.release();
    }
  };
}
