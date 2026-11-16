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

export interface WatchRegistration {
  createdAt: string;
  priorOutpoints: string[] | null;
  priorTruncated?: boolean;
  swapDepositAddress?: string;
  deadline?: string;
}

export interface RegisteredOutput {
  outpoint: string;
  confirmed: boolean;
  blockTime: number | null;
}

export interface WatchedDeposit {
  depositScript: string;
  reclaimScript: string;
  createdAt: string;
  registrations?: WatchRegistration[];
  registered?: RegisteredOutput[];
}

const OUTPOINT = /^[0-9a-f]{64}:\d+$/;

const watchedDepositSchema: z.ZodType<WatchedDeposit> = z.looseObject({
  depositScript: z.string(),
  reclaimScript: z.string(),
  createdAt: z.string(),
  registrations: z
    .array(
      z.looseObject({
        createdAt: z.string(),
        priorOutpoints: z.array(z.string().regex(OUTPOINT)).nullable(),
        priorTruncated: z.boolean().optional(),
        swapDepositAddress: z.string().optional(),
        deadline: z.string().optional(),
      })
    )
    .optional(),
  registered: z
    .array(
      z.looseObject({
        outpoint: z.string().regex(OUTPOINT),
        confirmed: z.boolean(),
        blockTime: z.number().nullable(),
      })
    )
    .optional(),
});

const PREFIX = 'dep:';
const SIGNER_KEY_CACHE = 'meta:signer-key';
export const WATCH_TTL_SECONDS = 14 * 24 * 60 * 60;
export const MAX_REGISTRATIONS_PER_ADDRESS = 8;
export const MAX_LIST_PAGES = 2;
const MIN_TTL_SECONDS = 60;

export function registrationsOf(deposit: WatchedDeposit): WatchRegistration[] {
  if (deposit.registrations && deposit.registrations.length > 0) return deposit.registrations;
  return [{ createdAt: deposit.createdAt, priorOutpoints: null }];
}

function remainingTtl(deposit: WatchedDeposit, now: Date): number {
  const newest = Math.max(
    ...registrationsOf(deposit)
      .map(r => Date.parse(r.createdAt))
      .filter(Number.isFinite),
    0
  );
  const age = newest > 0 ? Math.floor((now.getTime() - newest) / 1000) : 0;
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
    metadata: { registrations: registrationsOf(deposit).length },
  });
}

function registrationsInMetadata(metadata: unknown): number {
  const count: unknown =
    typeof metadata === 'object' && metadata !== null
      ? Reflect.get(metadata, 'registrations')
      : undefined;
  return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 ? count : 1;
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
): Promise<{ addresses: string[]; registrations: number; truncated: boolean; pages: number }> {
  const found = new Map<string, number>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await kv.list({ prefix: PREFIX, cursor });
    pages += 1;
    for (const k of page.keys) {
      found.set(k.name.slice(PREFIX.length), registrationsInMetadata(k.metadata));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && pages < maxPages);
  return {
    addresses: [...found.keys()].sort(),
    registrations: [...found.values()].reduce((sum, n) => sum + n, 0),
    truncated: cursor !== undefined,
    pages,
  };
}

export async function countRegistrations(kv: KV, maxPages = MAX_LIST_PAGES): Promise<number> {
  const { registrations, truncated } = await listWatchedAddresses(kv, maxPages);
  return truncated ? Number.MAX_SAFE_INTEGER : registrations;
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
