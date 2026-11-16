import {
  type OneClickQuoteResponse,
  ResponseShapeError,
  type WatchedWithdrawal,
  type WithdrawalFlowConfig,
  type WithdrawalReceipt,
  assertMainnetSender,
  assertWithdrawalInvariants,
  encodeWithdrawalRecipient,
  errorMessage,
  normalizeStacksTxid,
  oneClickQuoteResponseSchema,
  sameRecipient,
  z,
} from '@satway/core';

export const WITHDRAWAL_RECEIPT_KIND = 'satway-withdrawal';

export interface WithdrawalDestination {
  assetId: string;
  chain: string;
  symbol: string;
  decimals: number;
  address: string;
}

export interface WithdrawalReceiptFile {
  kind: typeof WITHDRAWAL_RECEIPT_KIND;
  version: 1;
  createdAt: string;
  stacksTxid: string | null;
  sender: string;
  amountSats: number;
  maxFeeSats: number;
  depositAddress: string;
  recipient: { version: string; hashbytes: string };
  destination: WithdrawalDestination;
  refundTo: string;
  quoteResponse: OneClickQuoteResponse;
  quoteDeadline: string;
}

const text = z.string().min(1);
const hexText = z.string().regex(/^(?:[0-9a-f]{2})+$/);

const receiptSchema: z.ZodType<WithdrawalReceiptFile> = z.looseObject({
  kind: z.literal(WITHDRAWAL_RECEIPT_KIND),
  version: z.literal(1),
  createdAt: text,
  stacksTxid: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  sender: text,
  amountSats: z.number().int().positive(),
  maxFeeSats: z.number().int().positive(),
  depositAddress: text,
  recipient: z.looseObject({ version: hexText, hashbytes: hexText }),
  destination: z.looseObject({
    assetId: text,
    chain: text,
    symbol: text,
    decimals: z.number().int().nonnegative().max(36),
    address: text,
  }),
  refundTo: text,
  quoteResponse: oneClickQuoteResponseSchema,
  quoteDeadline: text,
});

export type WithdrawalReceiptConfig = Pick<WithdrawalFlowConfig, 'btcAssetId'>;

function hasKind(value: object, kind: string): boolean {
  return 'kind' in value && value.kind === kind;
}

export function looksLikeWithdrawalReceipt(value: unknown): boolean {
  return typeof value === 'object' && value !== null && hasKind(value, WITHDRAWAL_RECEIPT_KIND);
}

function parseReceipt(value: unknown): WithdrawalReceiptFile {
  if (typeof value !== 'object' || value === null) throw new Error('Not a receipt file');
  if (!hasKind(value, WITHDRAWAL_RECEIPT_KIND)) {
    throw new Error(
      'This is not a withdrawal receipt. Deposit receipts are loaded in the section above.'
    );
  }
  const result = receiptSchema.safeParse(value);
  if (result.success) return result.data;
  const failed = new Set(result.error.issues.map(issue => issue.path[0]));
  if (failed.has('version')) throw new Error('Unsupported withdrawal receipt version');
  throw new ResponseShapeError('the withdrawal receipt file', result.error.issues);
}

function check(ok: boolean, problem: string): void {
  if (!ok) throw new Error(`Receipt does not add up: ${problem}`);
}

function sameInstant(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1000;
}

function addsUp(config: WithdrawalReceiptConfig, r: WithdrawalReceiptFile): void {
  assertMainnetSender(r.sender);
  assertWithdrawalInvariants(r.amountSats, r.maxFeeSats);
  const encoded = encodeWithdrawalRecipient(r.depositAddress);
  check(encoded.address === r.depositAddress, 'its swap address is not in standard form');
  check(sameRecipient(encoded.recipient, r.recipient), 'its recipient is not its swap address');
  const { quote, quoteRequest } = r.quoteResponse;
  check(quote.depositAddress === r.depositAddress, 'the quote pays a different swap address');
  check(quoteRequest.dry === false, 'the quote is a dry quote');
  check(quoteRequest.originAsset === config.btcAssetId, 'the quote does not swap from BTC');
  check(
    quoteRequest.destinationAsset === r.destination.assetId,
    'the quote swaps into a different asset'
  );
  check(quoteRequest.recipient === r.destination.address, 'the quote pays a different recipient');
  check(quoteRequest.refundTo === r.refundTo, 'the quote refunds to a different address');
  check(quoteRequest.amount === String(r.amountSats), 'the quote is for a different amount');
  check(sameInstant(quoteRequest.deadline, r.quoteDeadline), 'the quote has a different deadline');
  check(Number.isFinite(Date.parse(r.createdAt)), 'its creation time is not a date');
}

export function verifyWithdrawalReceipt(
  config: WithdrawalReceiptConfig,
  value: unknown
): WithdrawalReceiptFile {
  const receipt = parseReceipt(value);
  try {
    addsUp(config, receipt);
  } catch (err) {
    const message = errorMessage(err) ?? String(err);
    throw new Error(
      message.startsWith('Receipt does not add up')
        ? message
        : `Receipt does not add up: ${message}`,
      { cause: err }
    );
  }
  return receipt;
}

export function withdrawalReceiptOf(
  prepared: WithdrawalReceipt,
  destination: Omit<WithdrawalDestination, 'address'>
): WithdrawalReceiptFile {
  return {
    kind: WITHDRAWAL_RECEIPT_KIND,
    version: 1,
    createdAt: prepared.preparedAt,
    stacksTxid: null,
    sender: prepared.sender,
    amountSats: prepared.amountSats,
    maxFeeSats: prepared.maxFeeSats,
    depositAddress: prepared.depositAddress,
    recipient: prepared.recipient.recipient,
    destination: { ...destination, address: prepared.destinationRecipient },
    refundTo: prepared.refundTo,
    quoteResponse: prepared.quoteResponse,
    quoteDeadline: prepared.quoteDeadline,
  };
}

export function withStacksTxid(
  receipt: WithdrawalReceiptFile,
  txid: string
): WithdrawalReceiptFile {
  return { ...receipt, stacksTxid: normalizeStacksTxid(txid) };
}

export function watchedWithdrawalOf(
  receipt: WithdrawalReceiptFile,
  stacksTxid: string
): WatchedWithdrawal {
  return {
    stacksTxid,
    sender: receipt.sender,
    amountSats: receipt.amountSats,
    maxFeeSats: receipt.maxFeeSats,
    depositAddress: receipt.depositAddress,
    recipient: receipt.recipient,
    quoteResponse: receipt.quoteResponse,
    quoteDeadline: receipt.quoteDeadline,
  };
}

export function withdrawalId(receipt: WithdrawalReceiptFile): string {
  return receipt.depositAddress;
}

export const WITHDRAWALS_KEY = 'satway.withdrawals.v1';
export const ACTIVE_WITHDRAWAL_KEY = 'satway.withdrawals.active.v1';
export const UNREADABLE_WITHDRAWALS_PREFIX = `${WITHDRAWALS_KEY}.unreadable.`;
export const MAX_UNREADABLE_WITHDRAWAL_BACKUPS = 20;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function backUpUnreadable(s: Store, raw: string): boolean {
  for (let slot = 0; slot < MAX_UNREADABLE_WITHDRAWAL_BACKUPS; slot++) {
    const key = `${UNREADABLE_WITHDRAWALS_PREFIX}${slot}`;
    const existing = s.getItem(key);
    if (existing === raw) return true;
    if (existing === null) {
      s.setItem(key, raw);
      return s.getItem(key) === raw;
    }
  }
  return false;
}

function storedItems(s: Store): unknown[] | null {
  const raw = s.getItem(WITHDRAWALS_KEY);
  if (raw === null || raw === '') return [];
  let parsed: unknown = null;
  let readable = true;
  try {
    parsed = JSON.parse(raw);
  } catch {
    readable = false;
  }
  if (readable && Array.isArray(parsed)) return parsed.map((item: unknown) => item);
  return backUpUnreadable(s, raw) ? [] : null;
}

function verifiedOrNull(
  config: WithdrawalReceiptConfig,
  item: unknown
): WithdrawalReceiptFile | null {
  try {
    return verifyWithdrawalReceipt(config, item);
  } catch {
    return null;
  }
}

export function loadWithdrawals(config: WithdrawalReceiptConfig): WithdrawalReceiptFile[] {
  try {
    const s = store();
    const items = s ? storedItems(s) : null;
    return (items ?? []).flatMap(item => {
      const receipt = verifiedOrNull(config, item);
      return receipt ? [receipt] : [];
    });
  } catch {
    return [];
  }
}

export function rememberWithdrawal(
  config: WithdrawalReceiptConfig,
  receipt: WithdrawalReceiptFile
): boolean {
  try {
    const s = store();
    const items = s ? storedItems(s) : null;
    if (!s || items === null) return false;
    const id = withdrawalId(receipt);
    const others = items.filter(item => {
      const known = verifiedOrNull(config, item);
      return known === null || withdrawalId(known) !== id;
    });
    const json = JSON.stringify([receipt, ...others]);
    s.setItem(WITHDRAWALS_KEY, json);
    return s.getItem(WITHDRAWALS_KEY) === json;
  } catch {
    return false;
  }
}

export function forgetWithdrawalDraft(
  config: WithdrawalReceiptConfig,
  receipt: WithdrawalReceiptFile
): void {
  try {
    const s = store();
    const items = s ? storedItems(s) : null;
    if (!s || items === null) return;
    const id = withdrawalId(receipt);
    const kept = items.filter(item => {
      const known = verifiedOrNull(config, item);
      return known === null || withdrawalId(known) !== id || known.stacksTxid !== null;
    });
    if (kept.length !== items.length) s.setItem(WITHDRAWALS_KEY, JSON.stringify(kept));
  } catch {
    return;
  }
}

export function setActiveWithdrawal(receipt: WithdrawalReceiptFile | null): void {
  try {
    const s = store();
    if (!s) return;
    if (receipt === null) s.removeItem(ACTIVE_WITHDRAWAL_KEY);
    else s.setItem(ACTIVE_WITHDRAWAL_KEY, withdrawalId(receipt));
  } catch {
    return;
  }
}

export function activeWithdrawal(config: WithdrawalReceiptConfig): WithdrawalReceiptFile | null {
  try {
    const id = store()?.getItem(ACTIVE_WITHDRAWAL_KEY) ?? null;
    if (id === null) return null;
    return loadWithdrawals(config).find(r => withdrawalId(r) === id) ?? null;
  } catch {
    return null;
  }
}

export function withdrawalFileName(receipt: WithdrawalReceiptFile): string {
  return `satway-withdrawal-${receipt.createdAt.slice(0, 10)}-${receipt.depositAddress.slice(-8)}.json`;
}

export const REVOKE_WITHDRAWAL_URL_AFTER_MS = 60_000;

export function downloadWithdrawalReceipt(receipt: WithdrawalReceiptFile): void {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = withdrawalFileName(receipt);
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_WITHDRAWAL_URL_AFTER_MS);
  }
}
