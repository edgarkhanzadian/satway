import { parseWith, z } from '@stxonector/core';

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

export interface WatchedDeposit {
  depositScript: string;
  reclaimScript: string;
  createdAt: string;
}

const watchedDepositSchema: z.ZodType<WatchedDeposit> = z.looseObject({
  depositScript: z.string(),
  reclaimScript: z.string(),
  createdAt: z.string(),
});

const PREFIX = 'dep:';
export const WATCH_TTL_SECONDS = 14 * 24 * 60 * 60;

export async function putWatched(kv: KV, address: string, deposit: WatchedDeposit): Promise<void> {
  await kv.put(PREFIX + address, JSON.stringify(deposit), { expirationTtl: WATCH_TTL_SECONDS });
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
