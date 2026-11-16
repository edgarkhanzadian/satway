import { fetchTransactionHex } from '../bitcoin/index.js';
import {
  type FetchLike,
  HttpError,
  type NetworkConfig,
  SLOW_REQUEST_TIMEOUT_MS,
  defaultFetch,
  nullOrAbsent,
  requestJson,
  z,
} from '../shared/index.js';
import { toXOnly } from './deposit-address.js';
import { verifyDepositTransaction } from './verify-deposit-transaction.js';

export interface SbtcLimits {
  pegCap: number | null;
  perDepositMinimum: number | null;
  perDepositCap: number | null;
}

export type EmilyDepositStatus =
  | 'pending'
  | 'reprocessing'
  | 'accepted'
  | 'confirmed'
  | 'failed'
  | 'rbf';

export interface EmilyDeposit {
  bitcoinTxid: string;
  bitcoinTxOutputIndex: number;
  recipient: string;
  amount: number;
  status: EmilyDepositStatus;
  statusMessage?: string;
  reclaimScript: string;
  depositScript: string;
}

const limitsSchema: z.ZodType<SbtcLimits> = z.looseObject({
  pegCap: z.number().nullable(),
  perDepositMinimum: z.number().nullable(),
  perDepositCap: z.number().nullable(),
});

const emilyDepositSchema: z.ZodType<EmilyDeposit> = z.looseObject({
  bitcoinTxid: z.string(),
  bitcoinTxOutputIndex: z.number(),
  recipient: z.string(),
  amount: z.number(),
  status: z.enum(['pending', 'reprocessing', 'accepted', 'confirmed', 'failed', 'rbf']),
  statusMessage: nullOrAbsent(z.string()),
  reclaimScript: z.string(),
  depositScript: z.string(),
});

export async function fetchLimits(
  sbtcApiUrl: string,
  fetchFn: FetchLike = defaultFetch
): Promise<SbtcLimits> {
  return requestJson(fetchFn, `${sbtcApiUrl}/limits`, limitsSchema);
}

export interface NotifyDepositInput {
  bitcoinTxid: string;
  bitcoinTxOutputIndex: number;
  depositScript: string;
  reclaimScript: string;
}

export type DepositEndpoints = Pick<NetworkConfig, 'btcApiUrl' | 'sbtcApiUrl'>;

export async function notifyDeposit(
  endpoints: DepositEndpoints,
  input: NotifyDepositInput,
  fetchFn: FetchLike = defaultFetch
): Promise<EmilyDeposit> {
  const { sbtcApiUrl } = endpoints;
  const transactionHex = await fetchTransactionHex(endpoints.btcApiUrl, input.bitcoinTxid, fetchFn);
  verifyDepositTransaction(transactionHex, {
    txid: input.bitcoinTxid,
    vout: input.bitcoinTxOutputIndex,
    depositScript: input.depositScript,
    reclaimScript: input.reclaimScript,
  });
  try {
    return await requestJson(fetchFn, `${sbtcApiUrl}/deposit`, emilyDepositSchema, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        bitcoinTxid: input.bitcoinTxid,
        bitcoinTxOutputIndex: input.bitcoinTxOutputIndex,
        depositScript: input.depositScript,
        reclaimScript: input.reclaimScript,
        transactionHex,
      }),
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) {
      const existing = await fetchDeposit(
        sbtcApiUrl,
        input.bitcoinTxid,
        input.bitcoinTxOutputIndex,
        fetchFn
      );
      if (existing) return existing;
    }
    throw err;
  }
}

export async function fetchDeposit(
  sbtcApiUrl: string,
  txid: string,
  vout: number,
  fetchFn: FetchLike = defaultFetch
): Promise<EmilyDeposit | null> {
  try {
    return await requestJson(fetchFn, `${sbtcApiUrl}/deposit/${txid}/${vout}`, emilyDepositSchema);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

export interface EmilyReclaimKeyDeposit {
  bitcoinTxid: string;
  bitcoinTxOutputIndex: number;
  maxFee: number;
  amount: number;
  status: EmilyDepositStatus;
  depositScript: string;
  reclaimScript: string;
}

export interface EmilyReclaimKeyDeposits {
  deposits: EmilyReclaimKeyDeposit[];
  truncated: boolean;
}

const emilyReclaimKeyPageSchema = z.looseObject({
  nextToken: nullOrAbsent(z.string()),
  deposits: z.array(
    z.looseObject({
      bitcoinTxid: z.string(),
      bitcoinTxOutputIndex: z.number(),
      maxFee: z.number(),
      amount: z.number(),
      status: z.enum(['pending', 'reprocessing', 'accepted', 'confirmed', 'failed', 'rbf']),
      depositScript: z.string(),
      reclaimScript: z.string(),
    })
  ),
});

export const MAX_RECLAIM_KEY_PAGES = 10;

export async function fetchDepositsByReclaimKey(
  sbtcApiUrl: string,
  reclaimPublicKey: string,
  options: { fetchFn?: FetchLike; maxPages?: number; signal?: AbortSignal } = {}
): Promise<EmilyReclaimKeyDeposits> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const base = `${sbtcApiUrl}/deposit/reclaim-pubkeys/${toXOnly(reclaimPublicKey)}`;
  const maxPages = Math.max(1, options.maxPages ?? MAX_RECLAIM_KEY_PAGES);
  const deposits: EmilyReclaimKeyDeposit[] = [];
  let token: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = token === undefined ? base : `${base}?${new URLSearchParams({ nextToken: token })}`;
    const body = await requestJson(fetchFn, url, emilyReclaimKeyPageSchema, {
      signal: options.signal,
    });
    deposits.push(
      ...body.deposits.map(d => ({
        bitcoinTxid: d.bitcoinTxid.toLowerCase(),
        bitcoinTxOutputIndex: d.bitcoinTxOutputIndex,
        maxFee: d.maxFee,
        amount: d.amount,
        status: d.status,
        depositScript: d.depositScript.toLowerCase(),
        reclaimScript: d.reclaimScript.toLowerCase(),
      }))
    );
    token = body.nextToken || undefined;
    if (token === undefined) return { deposits, truncated: false };
  }
  return { deposits, truncated: true };
}
