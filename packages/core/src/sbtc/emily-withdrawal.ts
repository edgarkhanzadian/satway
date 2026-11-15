import { type FetchLike, HttpError, defaultFetch, requestJson, z } from '../shared/index.js';

export interface WithdrawalLimits {
  perWithdrawalCap: number | null;
  rollingWithdrawalBlocks: number | null;
  rollingWithdrawalCap: number | null;
  availableToWithdraw: number | null;
}

const satsField = z.number().int().nonnegative().nullable();

const withdrawalLimitsSchema: z.ZodType<WithdrawalLimits> = z.looseObject({
  perWithdrawalCap: satsField,
  rollingWithdrawalBlocks: satsField,
  rollingWithdrawalCap: satsField,
  availableToWithdraw: satsField,
});

export async function fetchWithdrawalLimits(
  sbtcApiUrl: string,
  fetchFn: FetchLike = defaultFetch
): Promise<WithdrawalLimits> {
  return requestJson(fetchFn, `${sbtcApiUrl}/limits`, withdrawalLimitsSchema);
}

export interface EmilyWithdrawalFulfillment {
  BitcoinTxid: string;
  BitcoinTxIndex: number;
  StacksTxid: string;
  BtcFee: number;
}

export interface EmilyWithdrawal {
  requestId: number;
  txid: string;
  status: string;
  amount: number;
  recipient: string;
  fulfillment?: EmilyWithdrawalFulfillment | null;
}

const emilyWithdrawalSchema: z.ZodType<EmilyWithdrawal> = z.looseObject({
  requestId: z.number().int(),
  txid: z.string(),
  status: z.string(),
  amount: z.number(),
  recipient: z.string(),
  fulfillment: z
    .looseObject({
      BitcoinTxid: z.string(),
      BitcoinTxIndex: z.number().int().nonnegative(),
      StacksTxid: z.string(),
      BtcFee: z.number(),
    })
    .nullable()
    .optional(),
});

export async function fetchEmilyWithdrawal(
  sbtcApiUrl: string,
  requestId: number,
  fetchFn: FetchLike = defaultFetch
): Promise<EmilyWithdrawal | null> {
  if (!Number.isSafeInteger(requestId) || requestId < 0) {
    throw new Error('A withdrawal request id is a non-negative integer');
  }
  try {
    return await requestJson(
      fetchFn,
      `${sbtcApiUrl}/withdrawal/${requestId}`,
      emilyWithdrawalSchema
    );
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}
