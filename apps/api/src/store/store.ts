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

export interface Registration {
  depositScript: string;
  reclaimScript: string;
  swapDepositAddress: string;
  deadline: string;
  createdAt: string;
}

export interface WatchSwap {
  swapDepositAddress: string;
  deadline: string;
  createdAt: string;
}

export interface Watch {
  address: string;
  depositScript: string;
  reclaimScript: string;
  createdAt: string;
  swaps: WatchSwap[];
  registered: string[];
}

export interface QueueEntry {
  address: string;
  outpoint: string;
  attempts: number;
  nextAt: number;
  refused: boolean;
}

export interface Rotation {
  at: number;
  run: number;
}

export interface WatchIndex {
  watches: Watch[];
  rotation: Rotation;
  queue: QueueEntry[];
  pending: string[];
  ended: Record<string, number>;
  listedAt: number | null;
  listCursor: string | null;
  loadHash: string | null;
  loadAt: number | null;
}

export interface WatchLoad {
  addresses: string[];
  full: string[];
}

export const REGISTRATION_PREFIX = 'dep:';
export const INDEX_KEY = 'meta:watch-index';
export const LOAD_KEY = 'meta:watch-load';
export const SIGNAL_KEY = 'meta:registered-at';
const SIGNER_KEY_CACHE = 'meta:signer-key';
export const MAX_EXTRA_SWAPS = 3;
export const MAX_SWAPS_PER_WATCH = 1 + MAX_EXTRA_SWAPS;
export const WATCH_TTL_SECONDS = 14 * 24 * 60 * 60;
const MIN_TTL_SECONDS = 60;
const OUTPOINT = /^[0-9a-f]{64}:\d+$/;

const registrationSchema: z.ZodType<Registration> = z.looseObject({
  depositScript: z.string(),
  reclaimScript: z.string(),
  swapDepositAddress: z.string(),
  deadline: z.string(),
  createdAt: z.string(),
});

const watchSwapSchema: z.ZodType<WatchSwap> = z.looseObject({
  swapDepositAddress: z.string(),
  deadline: z.string(),
  createdAt: z.string(),
});

const watchSchema: z.ZodType<Watch> = z.looseObject({
  address: z.string(),
  depositScript: z.string(),
  reclaimScript: z.string(),
  createdAt: z.string(),
  swaps: z.array(watchSwapSchema).min(1),
  registered: z.array(z.string().regex(OUTPOINT)),
});

const queueEntrySchema: z.ZodType<QueueEntry> = z.looseObject({
  address: z.string(),
  outpoint: z.string().regex(OUTPOINT),
  attempts: z.number(),
  nextAt: z.number(),
  refused: z.boolean(),
});

const watchIndexSchema: z.ZodType<WatchIndex> = z.looseObject({
  watches: z.array(watchSchema),
  rotation: z.looseObject({ at: z.number(), run: z.number() }),
  queue: z.array(queueEntrySchema),
  pending: z.array(z.string()),
  ended: z.record(z.string(), z.number()),
  listedAt: z.number().nullable(),
  listCursor: z.string().nullable(),
  loadHash: z.string().nullable(),
  loadAt: z.number().nullable(),
});

const watchLoadSchema: z.ZodType<WatchLoad> = z.looseObject({
  addresses: z.array(z.string()),
  full: z.array(z.string()),
});

function parsed<T>(schema: z.ZodType<T>, raw: string, key: string): T | null {
  try {
    return parseWith(schema, JSON.parse(raw), `KV record ${key}`);
  } catch {
    return null;
  }
}

export function registrationKey(address: string, swapDepositAddress: string): string {
  return `${REGISTRATION_PREFIX}${address}:${swapDepositAddress}`;
}

export function registrationKeyParts(
  name: string
): { address: string; swapDepositAddress: string } | null {
  if (!name.startsWith(REGISTRATION_PREFIX)) return null;
  const rest = name.slice(REGISTRATION_PREFIX.length);
  const split = rest.indexOf(':');
  if (split <= 0 || split === rest.length - 1) return null;
  return { address: rest.slice(0, split), swapDepositAddress: rest.slice(split + 1) };
}

export async function putRegistration(
  kv: KV,
  address: string,
  registration: Registration
): Promise<void> {
  await kv.put(
    registrationKey(address, registration.swapDepositAddress),
    JSON.stringify(registration),
    { expirationTtl: WATCH_TTL_SECONDS }
  );
}

export async function registrationExists(
  kv: KV,
  address: string,
  swapDepositAddress: string
): Promise<boolean> {
  return (await kv.get(registrationKey(address, swapDepositAddress))) !== null;
}

export async function getRegistration(
  kv: KV,
  name: string
): Promise<{ registration: Registration | null; broken: boolean }> {
  const raw = await kv.get(name);
  if (raw === null) return { registration: null, broken: false };
  const registration = parsed(registrationSchema, raw, name);
  return { registration, broken: registration === null };
}

export async function deleteRegistration(kv: KV, name: string): Promise<void> {
  await kv.delete(name);
}

export async function listRegistrations(
  kv: KV,
  cursor: string | null
): Promise<{ names: string[]; cursor: string | null }> {
  const page = await kv.list({
    prefix: REGISTRATION_PREFIX,
    ...(cursor === null ? {} : { cursor }),
  });
  const next = page.list_complete ? null : (page.cursor ?? null);
  return { names: page.keys.map(k => k.name), cursor: next };
}

export function emptyIndex(): WatchIndex {
  return {
    watches: [],
    rotation: { at: 0, run: 0 },
    queue: [],
    pending: [],
    ended: {},
    listedAt: null,
    listCursor: null,
    loadHash: null,
    loadAt: null,
  };
}

export function parseIndex(raw: string): WatchIndex | null {
  return parsed(watchIndexSchema, raw, INDEX_KEY);
}

export async function getIndex(kv: KV): Promise<{ index: WatchIndex | null; broken: boolean }> {
  const raw = await kv.get(INDEX_KEY);
  if (raw === null) return { index: null, broken: false };
  const index = parseIndex(raw);
  return { index, broken: index === null };
}

export async function putIndex(kv: KV, index: WatchIndex): Promise<void> {
  await kv.put(INDEX_KEY, JSON.stringify(index));
}

export function loadOf(index: Pick<WatchIndex, 'watches'>): WatchLoad {
  return {
    addresses: index.watches.map(w => w.address),
    full: index.watches.filter(w => w.swaps.length >= MAX_SWAPS_PER_WATCH).map(w => w.address),
  };
}

export async function getLoad(kv: KV): Promise<WatchLoad | null> {
  const raw = await kv.get(LOAD_KEY);
  return raw === null ? null : parsed(watchLoadSchema, raw, LOAD_KEY);
}

export async function putLoad(kv: KV, load: WatchLoad): Promise<void> {
  await kv.put(LOAD_KEY, JSON.stringify(load));
}

export async function getRegisteredAt(kv: KV): Promise<number | null> {
  const raw = await kv.get(SIGNAL_KEY);
  if (raw === null) return null;
  const ms = Number(raw);
  return Number.isFinite(ms) ? ms : null;
}

export async function putRegisteredAt(kv: KV, ms: number): Promise<void> {
  await kv.put(SIGNAL_KEY, String(ms), { expirationTtl: WATCH_TTL_SECONDS });
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
  return raw === null ? null : parsed(cachedSignerKeySchema, raw, SIGNER_KEY_CACHE);
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
