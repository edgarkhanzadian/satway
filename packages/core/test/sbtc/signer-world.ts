import {
  type FetchLike,
  MAINNET_CONFIG,
  type SweepTransaction,
  sweepTransactionSchema,
} from '../../src/index.js';
import { REGISTRY_RESULT, jsonResponse } from '../fixtures.js';
import {
  EVIDENCE_DEPOSITS,
  EVIDENCE_FUNDING_HEX,
  EVIDENCE_OUTSPENDS,
  EVIDENCE_SWEEPS,
  EVIDENCE_TIP,
} from './signer-evidence-fixtures.js';

export const PRIMARY = MAINNET_CONFIG.stxApiUrl;
export const SECONDARY = MAINNET_CONFIG.stxSecondaryApiUrl;
export const BTC = MAINNET_CONFIG.btcApiUrl;
export const FIRST_SWEEP = 'abc3e21b4028dd3a3a3f0aaebb7da2ab4a6331107608a0c28d0bb062dbf0927c';
export const SECOND_SWEEP = '13722963457daa096f6bcb73314bb9c8eb9db7db04192714cced9a46c9217c67';

export interface SignerWorld {
  primary?: unknown;
  secondary?: unknown;
  secondaryStatus?: number;
  secondaryDown?: boolean;
  deposits?: unknown;
  tip?: string;
  funding?: Readonly<Record<string, string>>;
  outspends?: Readonly<Record<string, unknown>>;
  sweep?(txid: string, sweep: SweepTransaction): unknown;
}

export function realDeposits(): { deposits: (typeof EVIDENCE_DEPOSITS)[number][] } {
  return { deposits: [...EVIDENCE_DEPOSITS] };
}

export function realSweep(txid: string): SweepTransaction {
  return sweepTransactionSchema.parse(JSON.parse(JSON.stringify(EVIDENCE_SWEEPS[txid])));
}

export function registryResultFor(xOnlyKey: string): string {
  return `0x020000002102${xOnlyKey}`;
}

export function signerWorld(w: SignerWorld = {}): { fetchFn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  function route(url: string): Response {
    if (url.startsWith(`${PRIMARY}/v2/contracts/call-read/`)) {
      return jsonResponse(w.primary ?? { okay: true, result: REGISTRY_RESULT });
    }
    if (url.startsWith(`${SECONDARY}/v2/data_var/`)) {
      if (w.secondaryDown) throw new TypeError('Failed to fetch');
      return jsonResponse(w.secondary ?? { data: REGISTRY_RESULT }, w.secondaryStatus ?? 200);
    }
    if (url.includes('/deposit?status=confirmed'))
      return jsonResponse(w.deposits ?? realDeposits());
    if (url === `${BTC}/blocks/tip/height`) return new Response(w.tip ?? String(EVIDENCE_TIP));
    const hexMatch = /\/tx\/([0-9a-f]{64})\/hex$/.exec(url);
    if (hexMatch?.[1]) {
      const raw = w.funding?.[hexMatch[1]] ?? EVIDENCE_FUNDING_HEX[hexMatch[1]];
      return raw === undefined
        ? new Response('Transaction not found', { status: 404 })
        : new Response(raw);
    }
    const outspendMatch = /\/tx\/([0-9a-f]{64})\/outspend\/\d+$/.exec(url);
    if (outspendMatch?.[1]) {
      const body = w.outspends?.[outspendMatch[1]] ?? EVIDENCE_OUTSPENDS[outspendMatch[1]];
      return body === undefined ? jsonResponse({ spent: false }) : jsonResponse(body);
    }
    const txMatch = /\/tx\/([0-9a-f]{64})$/.exec(url);
    if (txMatch?.[1] && EVIDENCE_SWEEPS[txMatch[1]] !== undefined) {
      const sweep = realSweep(txMatch[1]);
      return jsonResponse(w.sweep ? w.sweep(txMatch[1], sweep) : sweep);
    }
    if (txMatch) return new Response('Transaction not found', { status: 404 });
    throw new Error(`unexpected url ${url}`);
  }
  function fetchFn(url: string): Promise<Response> {
    urls.push(url);
    return new Promise(resolve => resolve(route(url)));
  }
  return { fetchFn, urls };
}
