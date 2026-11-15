import {
  type OneClickQuoteResponse,
  ResponseShapeError,
  buildDepositAddress,
  oneClickQuoteResponseSchema,
  z,
} from '@portage/core';

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
  priorOutpoints?: string[];
  priorTruncated?: boolean;
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
  priorOutpoints: z.array(z.string().regex(/^[0-9a-f]{64}:\d+$/)).optional(),
  priorTruncated: z.boolean().optional(),
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

export const RECEIPTS_KEY = 'portage.receipts.v1';

export function loadReceipts(): Receipt[] {
  try {
    const raw = localStorage.getItem(RECEIPTS_KEY);
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

export function receiptId(receipt: Receipt): string {
  return `${receipt.quoteResponse.quote.depositAddress ?? receipt.depositAddress}|${receipt.createdAt}`;
}

export const UNREADABLE_RECEIPTS_PREFIX = `${RECEIPTS_KEY}.unreadable.`;
export const MAX_UNREADABLE_BACKUPS = 100;

type ReceiptStore = Pick<Storage, 'getItem' | 'setItem'>;

function backUpUnreadable(store: ReceiptStore, raw: string): boolean {
  for (let slot = 0; slot < MAX_UNREADABLE_BACKUPS; slot++) {
    const key = `${UNREADABLE_RECEIPTS_PREFIX}${slot}`;
    const existing = store.getItem(key);
    if (existing === raw) return true;
    if (existing === null) {
      store.setItem(key, raw);
      return store.getItem(key) === raw;
    }
  }
  return false;
}

function storedItems(store: ReceiptStore): unknown[] | null {
  const raw = store.getItem(RECEIPTS_KEY);
  if (raw === null || raw === '') return [];
  let parsed: unknown = null;
  let readable = true;
  try {
    parsed = JSON.parse(raw);
  } catch {
    readable = false;
  }
  if (readable && Array.isArray(parsed)) return parsed.map((item: unknown) => item);
  return backUpUnreadable(store, raw) ? [] : null;
}

function isSavedCopyOf(item: unknown, id: string): boolean {
  try {
    return receiptId(verifyReceipt(item)) === id;
  } catch {
    return false;
  }
}

export function rememberReceipt(receipt: Receipt): boolean {
  try {
    const store = globalThis.localStorage;
    const items = storedItems(store);
    if (items === null) return false;
    const id = receiptId(receipt);
    const json = JSON.stringify([receipt, ...items.filter(item => !isSavedCopyOf(item, id))]);
    store.setItem(RECEIPTS_KEY, json);
    return store.getItem(RECEIPTS_KEY) === json;
  } catch {
    return false;
  }
}

export function receiptFileName(receipt: Receipt): string {
  return `portage-deposit-${receipt.createdAt.slice(0, 10)}-${receipt.depositAddress.slice(-8)}.json`;
}

export const REVOKE_DOWNLOAD_URL_AFTER_MS = 60_000;

export function downloadReceipt(receipt: Receipt): void {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = receiptFileName(receipt);
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DOWNLOAD_URL_AFTER_MS);
  }
}
