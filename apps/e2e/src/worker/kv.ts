import type { Env } from '@portage/api';

type Kv = Env['DEPOSITS'];

export interface KvEntry {
  value: string;
  expirationTtl: number | null;
  expiresAt: number | null;
}

const LIST_PAGE = 2;
const MIN_TTL_SECONDS = 60;

export class MemoryKv implements Kv {
  readonly entries = new Map<string, KvEntry>();
  readonly operations: string[] = [];
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  private live(key: string): KvEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.operations.push(`expired ${key}`);
      return null;
    }
    return entry;
  }

  private purge(): void {
    for (const key of [...this.entries.keys()]) this.live(key);
  }

  get(key: string): Promise<string | null> {
    this.operations.push(`get ${key}`);
    return Promise.resolve(this.live(key)?.value ?? null);
  }

  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.operations.push(`put ${key}`);
    const ttl = options?.expirationTtl ?? null;
    if (ttl !== null && (!Number.isFinite(ttl) || ttl < MIN_TTL_SECONDS))
      return Promise.reject(
        new Error(
          `KV PUT failed: 400 Invalid expiration_ttl of ${ttl}. Expiration TTL must be at least ${MIN_TTL_SECONDS}.`
        )
      );
    this.entries.set(key, {
      value,
      expirationTtl: ttl,
      expiresAt: ttl === null ? null : this.now() + ttl * 1000,
    });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.operations.push(`delete ${key}`);
    this.entries.delete(key);
    return Promise.resolve();
  }

  list(options: { prefix: string; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }> {
    this.operations.push(`list ${options.prefix}`);
    this.purge();
    const names = [...this.entries.keys()].filter(k => k.startsWith(options.prefix)).sort();
    const start = options.cursor === undefined ? 0 : Number(options.cursor);
    const page = names.slice(start, start + LIST_PAGE);
    const next = start + page.length;
    const complete = next >= names.length;
    return Promise.resolve({
      keys: page.map(name => ({ name })),
      list_complete: complete,
      ...(complete ? {} : { cursor: String(next) }),
    });
  }

  json(key: string): unknown {
    const raw = this.live(key)?.value;
    if (raw === undefined) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  }

  expiresInMs(key: string): number | null {
    const entry = this.live(key);
    if (!entry || entry.expiresAt === null) return null;
    return entry.expiresAt - this.now();
  }

  keys(prefix = ''): string[] {
    this.purge();
    return [...this.entries.keys()].filter(k => k.startsWith(prefix)).sort();
  }
}
