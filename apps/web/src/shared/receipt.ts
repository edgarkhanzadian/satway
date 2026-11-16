import {
  type OneClickQuoteResponse,
  ResponseShapeError,
  buildDepositAddress,
  formatBaseUnits,
  oneClickQuoteResponseSchema,
  z,
} from '@satway/core';

import type { BackgroundRegistration } from './backend.js';
import { looksLikeWithdrawalReceipt } from './withdrawal-receipt.js';

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
  origin: { chain: string; symbol: string; assetId: string; decimals: number };
  refundTo: string;
  quoteResponse: OneClickQuoteResponse;
  priorOutpoints?: string[];
  priorTruncated?: boolean;
}

export interface ActiveDeposit {
  receipt: Receipt;
  receiptUnsaved: boolean;
  firstRegistration?: BackgroundRegistration | null;
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

const MAX_TOKEN_DECIMALS = 36;

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
  origin: z.looseObject({
    chain: z.string(),
    symbol: z.string(),
    assetId: z.string(),
    decimals: z.number().int().min(0).max(MAX_TOKEN_DECIMALS),
  }),
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
  if (looksLikeWithdrawalReceipt(value)) {
    throw new Error('This is a withdrawal receipt. Load it under “Follow a withdrawal” below.');
  }
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

export type SendAmount = { kind: 'verified'; text: string } | { kind: 'base-units'; units: string };

export function sendAmountOf(receipt: Receipt, owed?: bigint): SendAmount {
  const amountIn = receipt.quoteResponse.quote.amountIn;
  const units = owed?.toString() ?? amountIn;
  if (!/^\d+$/.test(units)) return { kind: 'base-units', units };
  return { kind: 'verified', text: formatBaseUnits(BigInt(units), receipt.origin.decimals) };
}

export function sendAmountText(amount: SendAmount, symbol: string): string {
  return amount.kind === 'verified'
    ? `${amount.text} ${symbol}`
    : `${amount.units} base units of ${symbol}`;
}

export const RECEIPTS_KEY = 'satway.receipts.v1';

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
  return `satway-deposit-${receipt.createdAt.slice(0, 10)}-${receipt.depositAddress.slice(-8)}.json`;
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
