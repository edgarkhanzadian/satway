import { type FetchLike, type RequestOptions, parseWith, withTimeout, type z } from '@satway/core';

export function endpointOf(url: string): string {
  return url.split('?')[0] ?? url;
}

export function messageOf(body: unknown): string | undefined {
  const message =
    typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;
  return typeof message === 'string' ? message : undefined;
}

function globalFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

export async function send(
  url: string,
  init?: RequestOptions,
  fetchFn: FetchLike = globalFetch
): Promise<{ res: Response; body: unknown }> {
  const { res, text } = await withTimeout(url, init, async signalled => {
    const answer = await fetchFn(url, signalled);
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

export type FailureOf = (status: number, message: string) => Error;

function plainFailure(_status: number, message: string): Error {
  return new Error(message);
}

export interface CallOptions {
  init?: RequestOptions;
  fetchFn?: FetchLike;
  failure?: FailureOf;
  source?: string;
}

export async function call<T>(
  url: string,
  schema: z.ZodType<T>,
  options: CallOptions = {}
): Promise<T> {
  const { res, body } = await send(url, options.init, options.fetchFn);
  if (!res.ok) {
    const failure = options.failure ?? plainFailure;
    throw failure(res.status, messageOf(body) ?? `Request failed (${res.status})`);
  }
  return parseWith(schema, body, options.source ?? `the backend at ${endpointOf(url)}`);
}
