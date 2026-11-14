import { type FetchLike, HttpError, MAINNET_CONFIG as config } from '@portage/core';

import { registerDeposit, runNotifier } from './notifier.js';
import { BadRequest, sanitizeQuoteRequest } from './proxy.js';
import type { KV } from './store.js';

export interface Env {
  DEPOSITS: KV;
  ONECLICK_JWT?: string;
  ALLOWED_ORIGINS?: string;
}

const MAX_BODY_BYTES = 4_096;

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
    vary: 'origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new BadRequest('Body too large');
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

async function relay(upstream: Response, cors: Record<string, string>): Promise<Response> {
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json', ...cors },
  });
}

export async function handle(
  request: Request,
  env: Env,
  fetchFn: FetchLike = fetch
): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, apiKey: Boolean(env.ONECLICK_JWT) }, 200, cors);
    }

    if (request.method === 'GET' && url.pathname === '/tokens') {
      return relay(
        await fetchFn(`${config.oneClickBaseUrl}/v0/tokens`, {
          headers: upstreamHeaders(env, false),
        }),
        cors
      );
    }

    if (request.method === 'POST' && url.pathname === '/quote') {
      const clean = sanitizeQuoteRequest(await readJson(request), config);
      return relay(
        await fetchFn(`${config.oneClickBaseUrl}/v0/quote`, {
          method: 'POST',
          headers: upstreamHeaders(env, true),
          body: JSON.stringify(clean),
        }),
        cors
      );
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      const depositAddress = url.searchParams.get('depositAddress');
      if (!depositAddress || depositAddress.length > 200)
        throw new BadRequest('"depositAddress" is required');
      const params = new URLSearchParams({ depositAddress });
      const memo = url.searchParams.get('depositMemo');
      if (memo) params.set('depositMemo', memo.slice(0, 200));
      return relay(
        await fetchFn(`${config.oneClickBaseUrl}/v0/status?${params.toString()}`, {
          headers: upstreamHeaders(env, false),
        }),
        cors
      );
    }

    if (request.method === 'POST' && url.pathname === '/deposits') {
      const registered = await registerDeposit(env.DEPOSITS, await readJson(request), {
        btcApiUrl: config.btcApiUrl,
        fetchFn,
      });
      return json(registered, 201, cors);
    }

    return json({ message: 'Not found' }, 404, cors);
  } catch (err) {
    if (err instanceof BadRequest) return json({ message: err.message }, 400, cors);
    if (err instanceof HttpError) return json({ message: 'Upstream error' }, 502, cors);
    return json({ message: 'Internal error' }, 500, cors);
  }
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const report = await runNotifier(env.DEPOSITS, config);
    console.log(JSON.stringify(report));
  },
};
