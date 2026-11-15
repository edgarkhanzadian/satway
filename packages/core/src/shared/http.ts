import { parseWith, type z } from './schema.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

function endpointOf(url: string): string {
  return url.split('?')[0] ?? url;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const SLOW_REQUEST_TIMEOUT_MS = 30_000;

export class RequestTimeoutError extends Error {
  constructor(
    readonly url: string,
    readonly timeoutMs: number
  ) {
    super(`No answer from ${endpointOf(url)} within ${Math.ceil(timeoutMs / 1000)} seconds`);
    this.name = 'RequestTimeoutError';
  }
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

export async function withTimeout<T>(
  url: string,
  options: RequestOptions | undefined,
  run: (init: RequestInit) => Promise<T>
): Promise<T> {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...init } = options ?? {};
  const controller = new AbortController();
  const outer = init.signal ?? null;
  function forward() {
    controller.abort(outer?.reason);
  }
  if (outer?.aborted) forward();
  else outer?.addEventListener('abort', forward, { once: true });
  const timeout = new RequestTimeoutError(url, timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeout);
      reject(timeout);
    }, timeoutMs);
  });
  try {
    return await Promise.race([run({ ...init, signal: controller.signal }), expired]);
  } catch (err) {
    if (controller.signal.reason === timeout) throw timeout;
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forward);
  }
}

export async function requestJson<T>(
  fetchFn: FetchLike,
  url: string,
  schema: z.ZodType<T>,
  init?: RequestOptions
): Promise<T> {
  const { res, text } = await withTimeout(url, init, async signalled => {
    const answer = await fetchFn(url, signalled);
    return { res: answer, text: await answer.text() };
  });
  if (!res.ok) throw new HttpError(res.status, url, text);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(res.status, url, `Response was not JSON: ${text.slice(0, 120)}`);
  }
  return parseWith(schema, body, endpointOf(url));
}

export async function requestText(
  fetchFn: FetchLike,
  url: string,
  init?: RequestOptions
): Promise<string> {
  const { res, text } = await withTimeout(url, init, async signalled => {
    const answer = await fetchFn(url, signalled);
    return { res: answer, text: await answer.text() };
  });
  if (!res.ok) throw new HttpError(res.status, url, text);
  return text;
}

export function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}
