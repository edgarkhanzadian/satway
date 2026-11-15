import { base64 } from '@scure/base';

import { errorMessage } from '@portage/core';

export interface RpcResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type RpcFetch = (url: string, init: RequestInit) => Promise<RpcResponse>;

export interface RawAccount {
  owner: string;
  lamports: bigint;
  data: Uint8Array;
  executable: boolean;
}

export interface SimulationResult {
  err: string | null;
  logs: string[];
  unitsConsumed: number | null;
}

export interface LatestBlockhash {
  blockhash: string;
  lastValidBlockHeight: bigint;
}

export interface SignatureStatus {
  err: string | null;
  confirmation: string | null;
}

export interface SolanaRpc {
  latestBlockhash(): Promise<LatestBlockhash>;
  accounts(addresses: readonly string[]): Promise<(RawAccount | null)[]>;
  rentExemptMinimum(space: number): Promise<bigint>;
  simulate(wireBase64: string): Promise<SimulationResult>;
  send(wireBase64: string): Promise<string>;
  signatureStatus(signature: string): Promise<SignatureStatus | null>;
  blockHeight(): Promise<bigint>;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const read: unknown = Reflect.get(value, key);
  return read;
}

function strings(value: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

function integer(value: unknown, what: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    return BigInt(Math.trunc(value));
  throw new Error(`The Solana RPC returned an invalid ${what}`);
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '')
    throw new Error(`The Solana RPC returned an invalid ${what}`);
  return value;
}

export function describeRpcError(err: unknown): string {
  if (err === null || err === undefined) return 'unknown error';
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown error';
  }
}

export function readAccount(value: unknown): RawAccount | null {
  if (value === null) return null;
  const data = field(value, 'data');
  const encoded: unknown = Array.isArray(data) && data[1] === 'base64' ? data[0] : undefined;
  if (typeof encoded !== 'string')
    throw new Error('The Solana RPC returned account data in an unexpected form');
  const executable = field(value, 'executable');
  return {
    owner: text(field(value, 'owner'), 'account owner'),
    lamports: integer(field(value, 'lamports'), 'account balance'),
    data: base64.decode(encoded),
    executable: executable === true,
  };
}

export function createSolanaRpc(url: string, fetchFn: RpcFetch = fetch): SolanaRpc {
  let id = 0;
  async function call(method: string, params: unknown[]): Promise<unknown> {
    id += 1;
    let response: RpcResponse;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
    } catch (err) {
      throw new Error(`Could not reach the Solana RPC: ${errorMessage(err) ?? 'network error'}`);
    }
    if (!response.ok) throw new Error(`The Solana RPC answered ${response.status}`);
    const body = await response.json();
    const error = field(body, 'error');
    if (error !== undefined) {
      const message = field(error, 'message');
      throw new Error(
        `Solana RPC error: ${typeof message === 'string' ? message : describeRpcError(error)}`
      );
    }
    if (!(typeof body === 'object' && body !== null && 'result' in body))
      throw new Error('The Solana RPC returned no result');
    return field(body, 'result');
  }

  return {
    async latestBlockhash() {
      const value = field(await call('getLatestBlockhash', [{ commitment: 'confirmed' }]), 'value');
      return {
        blockhash: text(field(value, 'blockhash'), 'blockhash'),
        lastValidBlockHeight: integer(field(value, 'lastValidBlockHeight'), 'block height'),
      };
    },
    async accounts(addresses) {
      const value = field(
        await call('getMultipleAccounts', [
          addresses,
          { encoding: 'base64', commitment: 'confirmed' },
        ]),
        'value'
      );
      if (!Array.isArray(value) || value.length !== addresses.length)
        throw new Error('The Solana RPC returned the wrong number of accounts');
      return value.map(readAccount);
    },
    async rentExemptMinimum(space) {
      return integer(
        await call('getMinimumBalanceForRentExemption', [space, { commitment: 'confirmed' }]),
        'rent minimum'
      );
    },
    async simulate(wireBase64) {
      const value = field(
        await call('simulateTransaction', [
          wireBase64,
          {
            encoding: 'base64',
            sigVerify: false,
            replaceRecentBlockhash: false,
            commitment: 'confirmed',
          },
        ]),
        'value'
      );
      if (typeof value !== 'object' || value === null)
        throw new Error('The Solana RPC returned no simulation result');
      const err = field(value, 'err');
      const logs = field(value, 'logs');
      const units = field(value, 'unitsConsumed');
      return {
        err: err === null || err === undefined ? null : describeRpcError(err),
        logs: strings(logs),
        unitsConsumed: typeof units === 'number' ? units : null,
      };
    },
    async send(wireBase64) {
      return text(
        await call('sendTransaction', [
          wireBase64,
          { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' },
        ]),
        'transaction signature'
      );
    },
    async signatureStatus(signature) {
      const value = field(
        await call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
        'value'
      );
      if (!Array.isArray(value) || value.length !== 1)
        throw new Error('The Solana RPC returned no signature status');
      const status: unknown = value[0];
      if (status === null) return null;
      if (typeof status !== 'object')
        throw new Error('The Solana RPC returned an invalid signature status');
      const err = field(status, 'err');
      const confirmation = field(status, 'confirmationStatus');
      return {
        err: err === null || err === undefined ? null : describeRpcError(err),
        confirmation: typeof confirmation === 'string' ? confirmation : null,
      };
    },
    async blockHeight() {
      return integer(await call('getBlockHeight', [{ commitment: 'confirmed' }]), 'block height');
    },
  };
}
