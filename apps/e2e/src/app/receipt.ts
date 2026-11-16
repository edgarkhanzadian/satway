import { z } from '@satway/core';

export const receiptFileSchema = z.looseObject({
  version: z.literal(2),
  scriptVersion: z.literal('v1'),
  createdAt: z.string(),
  stacksAddress: z.string(),
  reclaimPublicKey: z.string(),
  reclaimKeyAddress: z.string(),
  signersPublicKey: z.string(),
  depositIndex: z.number(),
  maxSignerFeeSats: z.number(),
  reclaimLockBlocks: z.number(),
  depositAddress: z.string(),
  depositScriptPubKey: z.string(),
  depositScript: z.string(),
  reclaimScript: z.string(),
  origin: z.looseObject({ chain: z.string(), symbol: z.string(), assetId: z.string() }),
  refundTo: z.string(),
  quoteResponse: z.looseObject({
    quote: z.looseObject({
      depositAddress: z.string(),
      amountIn: z.string(),
      amountInFormatted: z.string(),
      amountOut: z.string(),
      minAmountOut: z.string(),
    }),
    quoteRequest: z.looseObject({
      recipient: z.string(),
      refundTo: z.string(),
      amount: z.string(),
    }),
    signature: z.string(),
    timestamp: z.string(),
    correlationId: z.string(),
  }),
});

export type ReceiptFile = z.infer<typeof receiptFileSchema>;
