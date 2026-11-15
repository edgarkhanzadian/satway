import type { Env } from '@portage/api';

type RateLimiter = NonNullable<Env['DEPOSIT_RATE_LIMITER']>;

export class FakeRateLimiter implements RateLimiter {
  readonly calls: { key: string; success: boolean }[] = [];
  deny = false;
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly limitPerPeriod: number;
  private readonly periodMs: number;
  private readonly now: () => number;

  constructor(rule: { limit: number; periodSeconds: number }, now: () => number) {
    this.limitPerPeriod = rule.limit;
    this.periodMs = rule.periodSeconds * 1000;
    this.now = now;
  }

  limit({ key }: { key: string }): Promise<{ success: boolean }> {
    const now = this.now();
    const start = now - (now % this.periodMs);
    const current = this.windows.get(key);
    const count = current?.start === start ? current.count + 1 : 1;
    this.windows.set(key, { start, count });
    const success = !this.deny && count <= this.limitPerPeriod;
    this.calls.push({ key, success });
    return Promise.resolve({ success });
  }
}
