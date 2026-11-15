import { MAINNET_WITHDRAWAL_FLOW_CONFIG as C } from '../src/index.js';
import { jsonResponse } from './fixtures.js';
import { REAL_TIP_HEIGHT, type RealWithdrawal } from './real-withdrawals.js';

export type Reply = Response | (() => Response);

export interface FakeApiRoutes {
  stacksTxs?: Record<string, unknown>;
  readOnly?: Record<string, string | ((args: readonly string[]) => string | Response)>;
  emilyWithdrawals?: Record<number, unknown>;
  limits?: unknown;
  btcTxs?: Record<string, unknown>;
  btcHexes?: Record<string, string>;
  tipHeight?: number | Response;
  feeEstimates?: unknown;
  overrides?: Record<string, Reply>;
}

export interface FakeApis {
  fetchFn(url: string, init?: RequestInit): Promise<Response>;
  urls: string[];
}

function strip(txid: string): string {
  return txid.toLowerCase().replace(/^0x/, '');
}

const READ_ONLY_PREFIX = `${C.stxApiUrl}/v2/contracts/call-read/${C.sbtcContract}/${C.registryContractName}/`;

function argsOf(init: RequestInit | undefined): string[] {
  const body = init?.body;
  if (typeof body !== 'string') return [];
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || !('arguments' in parsed)) return [];
  const args = parsed.arguments;
  return Array.isArray(args) ? args.map(String) : [];
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

export function fakeWithdrawalApis(routes: FakeApiRoutes): FakeApis {
  const urls: string[] = [];
  function respond(url: string, init?: RequestInit): Response {
    const override = routes.overrides?.[url];
    if (override) return typeof override === 'function' ? override() : override;

    const stacksTx = /\/extended\/v1\/tx\/0x([0-9a-f]{64})\?event_limit=\d+$/.exec(url);
    if (stacksTx?.[1] !== undefined && url.startsWith(C.stxApiUrl)) {
      const tx = routes.stacksTxs?.[stacksTx[1]];
      return tx === undefined ? notFound() : jsonResponse(tx);
    }
    if (url.startsWith(READ_ONLY_PREFIX)) {
      const fn = url.slice(READ_ONLY_PREFIX.length);
      const handler = routes.readOnly?.[fn];
      if (handler === undefined) return jsonResponse({ okay: false, cause: 'no handler' });
      const result = typeof handler === 'function' ? handler(argsOf(init)) : handler;
      return typeof result === 'string' ? jsonResponse({ okay: true, result }) : result;
    }
    if (url === `${C.sbtcApiUrl}/limits`) {
      return routes.limits === undefined ? notFound() : jsonResponse(routes.limits);
    }
    const emily = new RegExp(`^${C.sbtcApiUrl}/withdrawal/(\\d+)$`).exec(url);
    if (emily?.[1] !== undefined) {
      const found = routes.emilyWithdrawals?.[Number(emily[1])];
      return found === undefined ? notFound() : jsonResponse(found);
    }
    if (url === `${C.btcApiUrl}/blocks/tip/height`) {
      const tip = routes.tipHeight ?? REAL_TIP_HEIGHT;
      return typeof tip === 'number' ? new Response(String(tip)) : tip;
    }
    if (url === `${C.btcApiUrl}/fee-estimates`) {
      return routes.feeEstimates === undefined ? notFound() : jsonResponse(routes.feeEstimates);
    }
    const btcHex = new RegExp(`^${C.btcApiUrl}/tx/([0-9a-f]{64})/hex$`).exec(url);
    if (btcHex?.[1] !== undefined) {
      const found = routes.btcHexes?.[btcHex[1]];
      return found === undefined ? notFound() : new Response(found);
    }
    const btcTx = new RegExp(`^${C.btcApiUrl}/tx/([0-9a-f]{64})$`).exec(url);
    if (btcTx?.[1] !== undefined) {
      const found = routes.btcTxs?.[btcTx[1]];
      return found === undefined ? notFound() : jsonResponse(found);
    }
    return notFound();
  }
  return {
    urls,
    fetchFn(url: string, init?: RequestInit): Promise<Response> {
      urls.push(url);
      return Promise.resolve(respond(url, init));
    },
  };
}

export function routesFor(w: RealWithdrawal): FakeApiRoutes {
  const routes: FakeApiRoutes = {
    stacksTxs: { [strip(w.requestTxid)]: w.requestTx },
    readOnly: {
      'get-withdrawal-request': w.getWithdrawalRequest,
      'get-completed-withdrawal-sweep-data': w.getSweepData,
    },
    emilyWithdrawals: { [w.id]: w.emily },
    btcTxs: {},
    btcHexes: {},
  };
  if (w.acceptTxid && w.acceptTx && routes.stacksTxs) {
    routes.stacksTxs[strip(w.acceptTxid)] = w.acceptTx;
  }
  if (w.payoutTxid && w.btcTx && w.btcTxHex && routes.btcTxs && routes.btcHexes) {
    routes.btcTxs[w.payoutTxid] = w.btcTx;
    routes.btcHexes[w.payoutTxid] = w.btcTxHex;
  }
  return routes;
}
