import { fetchTransactionHex, verifyDepositTransaction } from './bitcoin.js';
import type { NetworkConfig } from './config.js';
import { type FetchLike, HttpError, defaultFetch, requestJson } from './http.js';
import { z } from './schema.js';

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
  statusMessage: z.string().optional(),
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
