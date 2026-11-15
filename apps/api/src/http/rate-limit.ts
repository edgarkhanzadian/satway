import { ApiError } from './errors.js';

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateRule {
  readonly scope: string;
  readonly limit: number;
  readonly periodSeconds: number;
}

export const DEPOSIT_RATE: RateRule = { scope: 'deposits', limit: 5, periodSeconds: 60 };
export const PROXY_RATE: RateRule = { scope: 'proxy', limit: 120, periodSeconds: 60 };

export const UNKNOWN_CLIENT = 'unknown';
const MAX_TRACKED_KEYS = 10_000;
const MAX_KEY_LENGTH = 64;

export function clientKeyOf(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')?.trim();
  if (!ip || ip.length > MAX_KEY_LENGTH) return UNKNOWN_CLIENT;
  return ip.toLowerCase();
}

export class WindowLimiter implements RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly rule: Pick<RateRule, 'limit' | 'periodSeconds'>,
    private readonly clock: () => number = Date.now
  ) {}

  limit({ key }: { key: string }): Promise<{ success: boolean }> {
    const now = this.clock();
    const periodMs = this.rule.periodSeconds * 1000;
    const start = now - (now % periodMs);
    const current = this.windows.get(key);
    if (!current || current.start !== start) {
      if (this.windows.size >= MAX_TRACKED_KEYS) this.prune(start);
      this.windows.set(key, { start, count: 1 });
      return Promise.resolve({ success: true });
    }
    current.count += 1;
    return Promise.resolve({ success: current.count <= this.rule.limit });
  }

  private prune(start: number): void {
    for (const [key, window] of this.windows) {
      if (window.start !== start) this.windows.delete(key);
    }
    if (this.windows.size >= MAX_TRACKED_KEYS) this.windows.clear();
  }
}

export class RateLimited extends ApiError {
  constructor(retryAfterSeconds: number) {
    super('Too many requests. Try again later.', 429, {
      'retry-after': String(retryAfterSeconds),
    });
    this.name = 'RateLimited';
  }
}

export async function enforceRateLimit(
  limiters: { binding: RateLimiter | undefined; fallback: RateLimiter },
  rule: RateRule,
  request: Request
): Promise<void> {
  const key = `${rule.scope}:${clientKeyOf(request)}`;
  let outcome: { success: boolean };
  try {
    outcome = await (limiters.binding ?? limiters.fallback).limit({ key });
  } catch {
    outcome = await limiters.fallback.limit({ key });
  }
  if (!outcome.success) throw new RateLimited(rule.periodSeconds);
}
