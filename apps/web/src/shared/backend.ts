import {
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
  type OneClickToken,
  type RequestOptions,
  SLOW_REQUEST_TIMEOUT_MS,
  oneClickQuoteResponseSchema,
  oneClickStatusResponseSchema,
  oneClickTokensSchema,
  parseWith,
  withTimeout,
  z,
} from '@satway/core';

export const UNKNOWN_SWAP = 'unknown-swap';

export type BackgroundRegistration =
  | { kind: 'registered'; address: string }
  | { kind: 'rejected'; status: number; message: string; code?: typeof UNKNOWN_SWAP }
  | { kind: 'unavailable'; status: number | null; message: string };

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

function endpointOf(url: string): string {
  return url.split('?')[0] ?? url;
}

function messageOf(body: unknown): string | undefined {
  const message =
    typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;
  return typeof message === 'string' ? message : undefined;
}

async function send(url: string, init?: RequestOptions): Promise<{ res: Response; body: unknown }> {
  const { res, text } = await withTimeout(url, init, async signalled => {
    const answer = await fetch(url, signalled);
    return { res: answer, text: await answer.text() };
  });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { res, body };
}

async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestOptions): Promise<T> {
  const { res, body } = await send(url, init);
  if (!res.ok) throw new Error(messageOf(body) ?? `Request failed (${res.status})`);
  return parseWith(schema, body, `the backend at ${endpointOf(url)}`);
}

function registrationFrom(url: string, res: Response, body: unknown): BackgroundRegistration {
  const message = messageOf(body) ?? `Request failed (${res.status})`;
  if (res.ok || res.status === 409) {
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
  return { kind: 'unavailable', status: res.status, message };
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
      call(`${base}/quote`, oneClickQuoteResponseSchema, jsonPost(request)),
    status(depositAddress, depositMemo) {
      const params = new URLSearchParams({ depositAddress });
      if (depositMemo) params.set('depositMemo', depositMemo);
      return call(`${base}/status?${params.toString()}`, oneClickStatusResponseSchema);
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
