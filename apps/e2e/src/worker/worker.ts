import worker, { type Env, handle } from '@satway/api';

import { APP_ORIGIN, TEST_ONECLICK_JWT } from '../config.js';
import { RealDate } from '../world/clock.js';
import type { FetchLike, World } from '../world/world.js';
import { MemoryKv } from './kv.js';
import { FakeRateLimiter } from './rate-limiter.js';

type HandleOptions = NonNullable<Parameters<typeof handle>[3]>;
type SignerKeyState = NonNullable<HandleOptions['signerState']>;

export const DEPOSIT_RATE = { limit: 5, periodSeconds: 60 };
export const PROXY_RATE = { limit: 120, periodSeconds: 60 };

export interface WorkerRequestLog {
  method: string;
  path: string;
  status: number;
  requestBody: string | null;
  responseBody: string;
}

function globalFetchFrom(fetchFn: FetchLike): typeof fetch {
  return (input, init) => {
    if (typeof input === 'string') return fetchFn(input, init);
    if (input instanceof URL) return fetchFn(input.href, init);
    return Promise.reject(
      new Error('The notifier passed a Request object; the e2e world only takes URLs')
    );
  };
}

export type WorkerEnvOverrides = Partial<Omit<Env, 'DEPOSITS'>>;

interface WorkerClock {
  depth: number;
  generation: number;
  world: World | null;
}

const clock: WorkerClock = { depth: 0, generation: 0, world: null };

function worldNowMs(): number {
  return clock.world ? clock.world.now().getTime() : RealDate.now();
}

class WorldDate extends RealDate {
  constructor(value?: number | string | Date) {
    if (value === undefined) super(worldNowMs());
    else super(value);
  }

  static override now(): number {
    return worldNowMs();
  }
}

async function onWorldClock<T>(world: World, run: () => Promise<T>): Promise<T> {
  if (clock.depth > 0 && clock.world !== world) resetWorkerClock();
  const generation = clock.generation;
  clock.world = world;
  clock.depth += 1;
  Reflect.set(globalThis, 'Date', WorldDate);
  try {
    return await run();
  } finally {
    if (generation === clock.generation) {
      clock.depth -= 1;
      if (clock.depth === 0) {
        Reflect.set(globalThis, 'Date', RealDate);
        clock.world = null;
      }
    }
  }
}

export function resetWorkerClock(): void {
  clock.generation += 1;
  clock.depth = 0;
  clock.world = null;
  Reflect.set(globalThis, 'Date', RealDate);
}

export function workerClockActive(): boolean {
  return clock.depth > 0;
}

let scheduledRunning = false;

export class ApiWorker {
  readonly kv: MemoryKv;
  readonly requests: WorkerRequestLog[] = [];
  readonly notifierReports: unknown[] = [];
  readonly env: Env;
  readonly limiters: { deposit: FakeRateLimiter; proxy: FakeRateLimiter };
  readonly signerState: SignerKeyState = { memory: null };
  private readonly fallbackLimiters: { deposit: FakeRateLimiter; proxy: FakeRateLimiter };
  private readonly world: World;

  constructor(world: World, env: WorkerEnvOverrides = {}) {
    this.world = world;
    function now(): number {
      return world.now().getTime();
    }
    this.kv = new MemoryKv(now);
    this.limiters = {
      deposit: new FakeRateLimiter(DEPOSIT_RATE, now),
      proxy: new FakeRateLimiter(PROXY_RATE, now),
    };
    this.fallbackLimiters = {
      deposit: new FakeRateLimiter(DEPOSIT_RATE, now),
      proxy: new FakeRateLimiter(PROXY_RATE, now),
    };
    this.env = {
      DEPOSITS: this.kv,
      ALLOWED_ORIGINS: APP_ORIGIN,
      ONECLICK_JWT: TEST_ONECLICK_JWT,
      DEPOSIT_RATE_LIMITER: this.limiters.deposit,
      PROXY_RATE_LIMITER: this.limiters.proxy,
      ...env,
    };
  }

  async dispatch(request: Request): Promise<Response> {
    const requestBody = request.method === 'GET' ? null : await request.clone().text();
    const options: HandleOptions = {
      now: () => this.world.now(),
      signerState: this.signerState,
      fallbackLimiters: this.fallbackLimiters,
    };
    const response = await onWorldClock(this.world, () =>
      handle(request, this.env, this.world.fetchFor('worker'), options)
    );
    const responseBody = await response.clone().text();
    this.requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      requestBody,
      responseBody,
    });
    return response;
  }

  watched(): string[] {
    return this.kv.keys('dep:').map(k => k.slice(4));
  }

  watch(depositAddress: string): unknown {
    return this.kv.json(`dep:${depositAddress}`);
  }

  depositPosts(): WorkerRequestLog[] {
    return this.requests.filter(r => r.method === 'POST' && r.path === '/deposits');
  }

  async runScheduled(): Promise<unknown> {
    if (scheduledRunning) throw new Error('A notifier run is already in progress in this worker');
    scheduledRunning = true;
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const lines: unknown[] = [];
    globalThis.fetch = globalFetchFrom(this.world.fetchFor('notifier'));
    console.log = (...args: unknown[]) => {
      lines.push(...args);
    };
    try {
      await onWorldClock(this.world, () =>
        worker.scheduled(
          { cron: '*/2 * * * *', scheduledTime: this.world.now().getTime() },
          this.env
        )
      );
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
      scheduledRunning = false;
    }
    const report: unknown =
      lines.length === 1 && typeof lines[0] === 'string' ? JSON.parse(lines[0]) : lines;
    this.notifierReports.push(report);
    return report;
  }
}
