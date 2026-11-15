import { parseWith, z } from '../shared/index.js';
import type { OneClickStatusResponse } from './oneclick.js';

function dropNull(value: unknown): unknown {
  return value === null ? undefined : value;
}

const nullableText = z.preprocess(dropNull, z.string().optional());

const txHashSchema = z.looseObject({ hash: z.string(), explorerUrl: z.string() });

export const oneClickSwapStatusSchema: z.ZodType<OneClickStatusResponse> = z.looseObject({
  status: z.enum([
    'KNOWN_DEPOSIT_TX',
    'PENDING_DEPOSIT',
    'INCOMPLETE_DEPOSIT',
    'PROCESSING',
    'SUCCESS',
    'REFUNDED',
    'FAILED',
  ]),
  updatedAt: z.string(),
  swapDetails: z.looseObject({
    amountOut: nullableText,
    refundedAmount: nullableText,
    refundReason: nullableText,
    originChainTxHashes: z.array(txHashSchema),
    destinationChainTxHashes: z.array(txHashSchema),
  }),
});

export function parseOneClickStatus(value: unknown): OneClickStatusResponse {
  return parseWith(oneClickSwapStatusSchema, value, '1Click status');
}
