import { parseWith, z } from '@portage/core';

export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface WatchRegistration {
  createdAt: string;
  priorOutpoints: string[] | null;
  priorTruncated?: boolean;
  swapDepositAddress?: string;
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
export const WATCH_TTL_SECONDS = 14 * 24 * 60 * 60;
export const MAX_REGISTRATIONS_PER_ADDRESS = 8;
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
  });
}

export async function getWatched(kv: KV, address: string): Promise<WatchedDeposit | null> {
  const raw = await kv.get(PREFIX + address);
  if (!raw) return null;
  try {
    return parseWith(watchedDepositSchema, JSON.parse(raw), `KV record ${PREFIX + address}`);
  } catch {
    return null;
  }
}

export async function deleteWatched(kv: KV, address: string): Promise<void> {
  await kv.delete(PREFIX + address);
}

export async function listWatched(
  kv: KV,
  max = 500
): Promise<{ address: string; deposit: WatchedDeposit }[]> {
  const out: { address: string; deposit: WatchedDeposit }[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: PREFIX, cursor });
    for (const { name } of page.keys) {
      if (out.length >= max) return out;
      const raw = await kv.get(name);
      if (!raw) continue;
      try {
        out.push({
          address: name.slice(PREFIX.length),
          deposit: parseWith(watchedDepositSchema, JSON.parse(raw), `KV record ${name}`),
        });
      } catch {
        await kv.delete(name);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
