import {
  type FetchLike,
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  SLOW_REQUEST_TIMEOUT_MS,
  oneClickQuoteResponseSchema,
  parseWith,
  withTimeout,
} from '@satway/core';

export interface WithdrawalBackend {
  quote(request: OneClickQuoteRequest): Promise<OneClickQuoteResponse>;
}

function messageOf(body: unknown): string | undefined {
  const message =
    typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;
  return typeof message === 'string' ? message : undefined;
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createWithdrawalBackend(
  baseUrl: string,
  fetchFn: FetchLike = (input, init) => fetch(input, init)
): WithdrawalBackend {
  const url = `${baseUrl.replace(/\/$/, '')}/withdrawal-quote`;
  return {
    async quote(request) {
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        timeoutMs: SLOW_REQUEST_TIMEOUT_MS,
      };
      const { res, text } = await withTimeout(url, init, async signalled => {
        const answer = await fetchFn(url, signalled);
        return { res: answer, text: await answer.text() };
      });
      const body = parseBody(text);
      if (!res.ok) throw new Error(messageOf(body) ?? `Request failed (${res.status})`);
      return parseWith(oneClickQuoteResponseSchema, body, 'the backend at /withdrawal-quote');
    },
  };
}
