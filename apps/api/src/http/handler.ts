import {
  type FetchLike,
  HttpError,
  MAINNET_WITHDRAWAL_FLOW_CONFIG,
  type RequestOptions,
  RequestTimeoutError,
  SLOW_REQUEST_TIMEOUT_MS,
  MAINNET_CONFIG as config,
  withTimeout,
} from '@satway/core';

import type { KV } from '../store/index.js';
import { ApiError, BadRequest } from './errors.js';
import { sanitizeQuoteRequest } from './proxy.js';
import {
  DEPOSIT_RATE,
  PROXY_RATE,
  type RateLimiter,
  type RateRule,
  WindowLimiter,
  enforceRateLimit,
} from './rate-limit.js';
import { registerDeposit } from './register-deposit.js';
import { type SignerKeyState, newSignerKeyState } from './signer-key.js';
import { sanitizeWithdrawalQuoteRequest } from './withdrawal-proxy.js';

export interface Env {
  DEPOSITS: KV;
  ONECLICK_JWT?: string;
  ALLOWED_ORIGINS?: string;
  DEPOSIT_RATE_LIMITER?: RateLimiter;
  PROXY_RATE_LIMITER?: RateLimiter;
}

export interface HandleOptions {
  now?(): Date;
  signerState?: SignerKeyState;
  fallbackLimiters?: { deposit: RateLimiter; proxy: RateLimiter };
}

export const MAX_BODY_BYTES = 4_096;
export const MAX_DEPOSIT_BODY_BYTES = 2_048;

const isolateSignerState = newSignerKeyState();
const isolateLimiters = {
  deposit: new WindowLimiter(DEPOSIT_RATE),
  proxy: new WindowLimiter(PROXY_RATE),
};

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-expose-headers': 'retry-after',
    vary: 'origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function tooLarge(): ApiError {
  return new ApiError('Body too large', 413);
}

async function readBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function readJson(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const text = await readBody(request, maxBytes);
  if (text === null) throw new BadRequest('Body must be JSON');
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest('Body must be JSON');
  }
}

function upstreamHeaders(env: Env, withBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (withBody) headers['content-type'] = 'application/json';
  if (env.ONECLICK_JWT) headers.authorization = `Bearer ${env.ONECLICK_JWT}`;
  return headers;
}

async function relay(
  fetchFn: FetchLike,
  url: string,
  init: RequestOptions,
  cors: Record<string, string>
): Promise<Response> {
  const { status, text } = await withTimeout(url, init, async signalled => {
    const upstream = await fetchFn(url, signalled);
    return { status: upstream.status, text: await upstream.text() };
  });
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json', ...cors },
  });
}

export async function handle(
  request: Request,
  env: Env,
  fetchFn: FetchLike = fetch,
  options: HandleOptions = {}
): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const fallback = options.fallbackLimiters ?? isolateLimiters;
  function limit(rule: RateRule, binding: RateLimiter | undefined): Promise<void> {
    const backup = rule === DEPOSIT_RATE ? fallback.deposit : fallback.proxy;
    return enforceRateLimit({ binding, fallback: backup }, rule, request);
  }

  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, apiKey: Boolean(env.ONECLICK_JWT) }, 200, cors);
    }

    if (request.method === 'GET' && url.pathname === '/tokens') {
      await limit(PROXY_RATE, env.PROXY_RATE_LIMITER);
      return await relay(
        fetchFn,
        `${config.oneClickBaseUrl}/v0/tokens`,
        { headers: upstreamHeaders(env, false) },
        cors
      );
    }

    if (request.method === 'POST' && url.pathname === '/quote') {
      const clean = sanitizeQuoteRequest(await readJson(request), config);
      await limit(PROXY_RATE, env.PROXY_RATE_LIMITER);
      return await relay(
        fetchFn,
        `${config.oneClickBaseUrl}/v0/quote`,
        {
          method: 'POST',
          headers: upstreamHeaders(env, true),
          body: JSON.stringify(clean),
          timeoutMs: SLOW_REQUEST_TIMEOUT_MS,
        },
        cors
      );
    }

    if (request.method === 'POST' && url.pathname === '/withdrawal-quote') {
      const clean = sanitizeWithdrawalQuoteRequest(
        await readJson(request),
        MAINNET_WITHDRAWAL_FLOW_CONFIG,
        options.now?.() ?? new Date()
      );
      await limit(PROXY_RATE, env.PROXY_RATE_LIMITER);
      return await relay(
        fetchFn,
        `${config.oneClickBaseUrl}/v0/quote`,
        {
          method: 'POST',
          headers: upstreamHeaders(env, true),
          body: JSON.stringify(clean),
          timeoutMs: SLOW_REQUEST_TIMEOUT_MS,
        },
        cors
      );
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      const depositAddress = url.searchParams.get('depositAddress');
      if (!depositAddress || depositAddress.length > 200)
        throw new BadRequest('"depositAddress" is required');
      await limit(PROXY_RATE, env.PROXY_RATE_LIMITER);
      const params = new URLSearchParams({ depositAddress });
      const memo = url.searchParams.get('depositMemo');
      if (memo) params.set('depositMemo', memo.slice(0, 200));
      return await relay(
        fetchFn,
        `${config.oneClickBaseUrl}/v0/status?${params.toString()}`,
        { headers: upstreamHeaders(env, false) },
        cors
      );
    }

    if (request.method === 'POST' && url.pathname === '/deposits') {
      const body = await readJson(request, MAX_DEPOSIT_BODY_BYTES);
      const registered = await registerDeposit(env.DEPOSITS, body, {
        config,
        fetchFn,
        oneClickJwt: env.ONECLICK_JWT,
        now: options.now?.() ?? new Date(),
        signerState: options.signerState ?? isolateSignerState,
        afterShapeChecks: () => limit(DEPOSIT_RATE, env.DEPOSIT_RATE_LIMITER),
      });
      return json(registered, 201, cors);
    }

    return json({ message: 'Not found' }, 404, cors);
  } catch (err) {
    if (err instanceof ApiError) {
      return json({ message: err.message, ...err.extra }, err.status, { ...cors, ...err.headers });
    }
    if (err instanceof HttpError) return json({ message: 'Upstream error' }, 502, cors);
    if (err instanceof RequestTimeoutError) {
      return json({ message: 'The swap provider did not answer in time' }, 504, cors);
    }
    return json({ message: 'Internal error' }, 500, cors);
  }
}
