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

export async function requestJson<T>(
  fetchFn: FetchLike,
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit
): Promise<T> {
  const res = await fetchFn(url, init);
  const text = await res.text();
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
  init?: RequestInit
): Promise<string> {
  const res = await fetchFn(url, init);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return text;
}

export function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}
