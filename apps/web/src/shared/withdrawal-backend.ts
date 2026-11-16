import {
  type FetchLike,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  SLOW_REQUEST_TIMEOUT_MS,
  oneClickQuoteResponseSchema,
} from '@satway/core';

import { call } from './backend-request.js';

export interface WithdrawalBackend {
  quote(request: OneClickQuoteRequest): Promise<OneClickQuoteResponse>;
}

export function createWithdrawalBackend(baseUrl: string, fetchFn?: FetchLike): WithdrawalBackend {
  const url = `${baseUrl.replace(/\/$/, '')}/withdrawal-quote`;
  return {
    quote(request) {
      return call(url, oneClickQuoteResponseSchema, {
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
          timeoutMs: SLOW_REQUEST_TIMEOUT_MS,
        },
        fetchFn,
        source: 'the backend at /withdrawal-quote',
      });
    },
  };
}
