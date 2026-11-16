import {
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
  type OneClickToken,
  type RequestOptions,
  SLOW_REQUEST_TIMEOUT_MS,
  SwapNotListedError,
  oneClickQuoteResponseSchema,
  oneClickStatusResponseSchema,
  oneClickTokensSchema,
  parseWith,
  z,
} from '@satway/core';

import { call, endpointOf, messageOf, send } from './backend-request.js';

export const UNKNOWN_SWAP = 'unknown-swap';
export const SWAP_LIMIT = 'swap-limit';

export type BackgroundRegistration =
  | { kind: 'registered'; address: string }
  | { kind: 'rejected'; status: number; message: string; code?: typeof UNKNOWN_SWAP }
  | { kind: 'unavailable'; status: number | null; message: string; retryAfterSeconds?: number };

export interface Backend {
  tokens(): Promise<OneClickToken[]>;
  quote(request: OneClickQuoteRequest): Promise<OneClickQuoteResponse>;
  status(depositAddress: string, depositMemo?: string): Promise<OneClickStatusResponse>;
  register(
    depositScript: string,
    reclaimScript: string,
    swapDepositAddress: string
  ): Promise<BackgroundRegistration>;
}

const registeredSchema = z.looseObject({ address: z.string() });
const unknownSwapSchema = z.looseObject({ code: z.literal(UNKNOWN_SWAP) });
const swapLimitSchema = z.looseObject({ code: z.literal(SWAP_LIMIT) });

function statusFailure(status: number, message: string): Error {
  return status === 404 ? new SwapNotListedError(message) : new Error(message);
}

function registrationFrom(url: string, res: Response, body: unknown): BackgroundRegistration {
  const message = messageOf(body) ?? `Request failed (${res.status})`;
  const covered = res.status === 409 && !swapLimitSchema.safeParse(body).success;
  if (res.ok || covered) {
    const { address } = parseWith(registeredSchema, body, `the backend at ${endpointOf(url)}`);
    return { kind: 'registered', address };
  }
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    const unknownSwap = res.status === 400 && unknownSwapSchema.safeParse(body).success;
    return {
      kind: 'rejected',
      status: res.status,
      message,
      ...(unknownSwap ? { code: UNKNOWN_SWAP } : {}),
    };
  }
  const retryAfter = res.headers.get('retry-after')?.trim() ?? '';
  return {
    kind: 'unavailable',
    status: res.status,
    message,
    ...(/^\d+$/.test(retryAfter) ? { retryAfterSeconds: Number(retryAfter) } : {}),
  };
}

export function createBackend(baseUrl: string): Backend {
  const base = baseUrl.replace(/\/$/, '');
  function jsonPost(body: unknown): RequestOptions {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS,
    };
  }
  return {
    tokens: () => call(`${base}/tokens`, oneClickTokensSchema),
    quote: (request: OneClickQuoteRequest) =>
      call(`${base}/quote`, oneClickQuoteResponseSchema, { init: jsonPost(request) }),
    status(depositAddress, depositMemo) {
      const params = new URLSearchParams({ depositAddress });
      if (depositMemo) params.set('depositMemo', depositMemo);
      return call(`${base}/status?${params.toString()}`, oneClickStatusResponseSchema, {
        failure: statusFailure,
      });
    },
    async register(depositScript, reclaimScript, swapDepositAddress) {
      const url = `${base}/deposits`;
      let sent: { res: Response; body: unknown };
      try {
        sent = await send(url, jsonPost({ depositScript, reclaimScript, swapDepositAddress }));
      } catch {
        return { kind: 'unavailable', status: null, message: 'The backend could not be reached' };
      }
      return registrationFrom(url, sent.res, sent.body);
    },
  };
}
