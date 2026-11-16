import type { Backend } from '../../shared/index.js';

export function abortableStatus(backend: Pick<Backend, 'status'>, signal: AbortSignal) {
  return {
    status(depositAddress: string) {
      if (signal.aborted) return Promise.reject(new Error('This check was stopped.'));
      return backend.status(depositAddress);
    },
  };
}
