import {
  type OneClickQuoteResponse,
  ResponseShapeError,
  buildDepositAddress,
  oneClickQuoteResponseSchema,
  z,
} from '@stxonector/core';

export interface Receipt {
  version: 1;
  createdAt: string;
  stacksAddress: string;
  reclaimPublicKey: string;
  reclaimKeyAddress: string;
  signersPublicKey: string;
  maxSignerFeeSats: number;
  reclaimLockBlocks: number;
  depositAddress: string;
  depositScriptPubKey: string;
  depositScript: string;
  reclaimScript: string;
  origin: { chain: string; symbol: string; assetId: string };
  refundTo: string;
  quoteResponse: OneClickQuoteResponse;
}

const REQUIRED_TEXT = [
  'stacksAddress',
  'reclaimPublicKey',
  'reclaimKeyAddress',
  'signersPublicKey',
  'depositAddress',
  'depositScriptPubKey',
  'depositScript',
  'reclaimScript',
  'refundTo',
] as const;

const text = z.string().min(1);

const receiptSchema: z.ZodType<Receipt> = z.looseObject({
  version: z.literal(1),
  createdAt: z.string(),
  stacksAddress: text,
  reclaimPublicKey: text,
  reclaimKeyAddress: text,
  signersPublicKey: text,
  maxSignerFeeSats: z.number(),
  reclaimLockBlocks: z.number(),
  depositAddress: text,
  depositScriptPubKey: text,
  depositScript: text,
  reclaimScript: text,
  origin: z.looseObject({ chain: z.string(), symbol: z.string(), assetId: z.string() }),
  refundTo: text,
  quoteResponse: oneClickQuoteResponseSchema,
});

function parseReceipt(value: unknown): Receipt {
  const result = receiptSchema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues;
  const failed = new Set(issues.map(issue => issue.path[0]));
  if (failed.has('version')) throw new Error('Unsupported receipt version');
  const missing = REQUIRED_TEXT.find(key => failed.has(key));
  if (missing) throw new Error(`Receipt is missing "${missing}"`);
  if (failed.has('maxSignerFeeSats') || failed.has('reclaimLockBlocks'))
    throw new Error('Receipt is missing its fee cap or timelock');
  throw new ResponseShapeError('the receipt file', issues);
}

export function verifyReceipt(value: unknown): Receipt {
  if (typeof value !== 'object' || value === null) throw new Error('Not a receipt file');
  const r = parseReceipt(value);
  const rebuilt = buildDepositAddress({
    stacksAddress: r.stacksAddress,
    reclaimPublicKey: r.reclaimPublicKey,
    signersPublicKey: r.signersPublicKey,
    maxSignerFeeSats: r.maxSignerFeeSats,
    reclaimLockBlocks: r.reclaimLockBlocks,
  });
  if (
    rebuilt.address !== r.depositAddress ||
    rebuilt.scriptPubKey !== r.depositScriptPubKey ||
    rebuilt.depositScript !== r.depositScript ||
    rebuilt.reclaimScript !== r.reclaimScript
  ) {
    throw new Error('Receipt does not add up: its address does not match its parameters');
  }
  if (r.quoteResponse.quoteRequest.recipient !== r.depositAddress) {
    throw new Error('Receipt does not add up: the quote pays a different address');
  }
  return r;
}

const KEY = 'stxonector.receipts.v1';

export function loadReceipts(): Receipt[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.flatMap((item: unknown) => {
      try {
        return [verifyReceipt(item)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function rememberReceipt(receipt: Receipt): void {
  try {
    const rest = loadReceipts().filter(r => r.depositAddress !== receipt.depositAddress);
    localStorage.setItem(KEY, JSON.stringify([receipt, ...rest].slice(0, 20)));
  } catch {
    return;
  }
}

export function receiptFileName(receipt: Receipt): string {
  return `stxonector-deposit-${receipt.createdAt.slice(0, 10)}-${receipt.depositAddress.slice(-8)}.json`;
}

export function downloadReceipt(receipt: Receipt): void {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = receiptFileName(receipt);
  a.click();
  URL.revokeObjectURL(url);
}
