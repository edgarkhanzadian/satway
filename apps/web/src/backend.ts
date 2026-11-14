import {
  type OneClickQuoteRequest,
  oneClickQuoteResponseSchema,
  oneClickStatusResponseSchema,
  oneClickTokensSchema,
  parseWith,
  z,
} from '@portage/core';

import type { Backend } from './flow.js';

const registeredSchema = z.looseObject({ address: z.string() });

function endpointOf(url: string): string {
  return url.split('?')[0] ?? url;
}

async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;
    throw new Error(typeof message === 'string' ? message : `Request failed (${res.status})`);
  }
  return parseWith(schema, body, `the backend at ${endpointOf(url)}`);
}

export function createBackend(baseUrl: string): Backend {
  const base = baseUrl.replace(/\/$/, '');
  function jsonPost(body: unknown): RequestInit {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
  }
  return {
    tokens: () => call(`${base}/tokens`, oneClickTokensSchema),
    quote: (request: OneClickQuoteRequest) =>
      call(`${base}/quote`, oneClickQuoteResponseSchema, jsonPost(request)),
    status(depositAddress, depositMemo) {
      const params = new URLSearchParams({ depositAddress });
      if (depositMemo) params.set('depositMemo', depositMemo);
      return call(`${base}/status?${params.toString()}`, oneClickStatusResponseSchema);
    },
    register: (depositScript, reclaimScript, swapDepositAddress) =>
      call(
        `${base}/deposits`,
        registeredSchema,
        jsonPost({ depositScript, reclaimScript, swapDepositAddress })
      ),
  };
}
