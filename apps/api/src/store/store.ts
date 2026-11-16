import { parseWith, z } from '@satway/core';

export interface KV {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: Record<string, number> }
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface RegisteredOutput {
  outpoint: string;
}

export interface WatchedDeposit {
  depositScript: string;
  reclaimScript: string;
  createdAt: string;
  swapDepositAddress: string;
  deadline: string;
  registered: RegisteredOutput[];
}

const OUTPOINT = /^[0-9a-f]{64}:\d+$/;

const watchedDepositSchema: z.ZodType<WatchedDeposit> = z.looseObject({
  depositScript: z.string(),
  reclaimScript: z.string(),
  createdAt: z.string(),
  swapDepositAddress: z.string(),
  deadline: z.string(),
  registered: z.array(z.looseObject({ outpoint: z.string().regex(OUTPOINT) })),
});

const PREFIX = 'dep:';
const SIGNER_KEY_CACHE = 'meta:signer-key';
export const WATCH_TTL_SECONDS = 14 * 24 * 60 * 60;
export const MAX_LIST_PAGES = 2;
const MIN_TTL_SECONDS = 60;

function remainingTtl(deposit: WatchedDeposit, now: Date): number {
  const created = Date.parse(deposit.createdAt);
  const age = Number.isFinite(created) ? Math.floor((now.getTime() - created) / 1000) : 0;
  return Math.max(MIN_TTL_SECONDS, WATCH_TTL_SECONDS - Math.max(0, age));
}

export async function putWatched(
  kv: KV,
  address: string,
  deposit: WatchedDeposit,
  now = new Date()
): Promise<void> {
  await kv.put(PREFIX + address, JSON.stringify(deposit), {
    expirationTtl: remainingTtl(deposit, now),
  });
}

function parseWatched(raw: string, key: string): WatchedDeposit | null {
  try {
    return parseWith(watchedDepositSchema, JSON.parse(raw), `KV record ${key}`);
  } catch {
    return null;
  }
}

export async function getWatched(kv: KV, address: string): Promise<WatchedDeposit | null> {
  const raw = await kv.get(PREFIX + address);
  if (!raw) return null;
  return parseWatched(raw, PREFIX + address);
}

export async function loadWatched(
  kv: KV,
  address: string
): Promise<{ deposit: WatchedDeposit | null; broken: boolean }> {
  const raw = await kv.get(PREFIX + address);
  if (!raw) return { deposit: null, broken: false };
  const deposit = parseWatched(raw, PREFIX + address);
  return { deposit, broken: deposit === null };
}

export async function deleteWatched(kv: KV, address: string): Promise<void> {
  await kv.delete(PREFIX + address);
}

export async function listWatchedAddresses(
  kv: KV,
  maxPages = MAX_LIST_PAGES
): Promise<{ addresses: string[]; truncated: boolean; pages: number }> {
  const found = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await kv.list({ prefix: PREFIX, cursor });
    pages += 1;
    for (const k of page.keys) found.add(k.name.slice(PREFIX.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && pages < maxPages);
  return { addresses: [...found].sort(), truncated: cursor !== undefined, pages };
}

export async function countWatches(kv: KV, maxPages = MAX_LIST_PAGES): Promise<number> {
  const { addresses, truncated } = await listWatchedAddresses(kv, maxPages);
  return truncated ? Number.MAX_SAFE_INTEGER : addresses.length;
}

export interface CachedSignerKey {
  key: string;
  fetchedAt: number;
}

const cachedSignerKeySchema: z.ZodType<CachedSignerKey> = z.looseObject({
  key: z.string().regex(/^[0-9a-f]{64}$/),
  fetchedAt: z.number(),
});

export async function getCachedSignerKey(kv: KV): Promise<CachedSignerKey | null> {
  const raw = await kv.get(SIGNER_KEY_CACHE);
  if (!raw) return null;
  try {
    return parseWith(cachedSignerKeySchema, JSON.parse(raw), `KV record ${SIGNER_KEY_CACHE}`);
  } catch {
    return null;
  }
}

export async function putCachedSignerKey(
  kv: KV,
  entry: CachedSignerKey,
  ttlSeconds: number
): Promise<void> {
  await kv.put(SIGNER_KEY_CACHE, JSON.stringify(entry), {
    expirationTtl: Math.max(MIN_TTL_SECONDS, ttlSeconds),
  });
}
