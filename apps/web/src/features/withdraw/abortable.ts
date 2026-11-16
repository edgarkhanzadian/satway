import type { FetchLike } from '@satway/core';

import type { Backend } from '../../shared/index.js';

export function abortableFetch(signal: AbortSignal): FetchLike {
  return (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
    });
}

export function abortableStatus(backend: Pick<Backend, 'status'>, signal: AbortSignal) {
  return {
    status(depositAddress: string) {
      if (signal.aborted) return Promise.reject(new Error('This check was stopped.'));
      return backend.status(depositAddress);
    },
  };
}
