import worker, { type Env, handle } from '@portage/api';

import { APP_ORIGIN, TEST_ONECLICK_JWT } from '../config.js';
import { RealDate } from '../world/clock.js';
import type { FetchLike, World } from '../world/world.js';
import { MemoryKv } from './kv.js';

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
  private readonly world: World;

  constructor(world: World, env: WorkerEnvOverrides = {}) {
    this.world = world;
    this.kv = new MemoryKv(() => world.now().getTime());
    this.env = {
      DEPOSITS: this.kv,
      ALLOWED_ORIGINS: APP_ORIGIN,
      ONECLICK_JWT: TEST_ONECLICK_JWT,
      ...env,
    };
  }

  async dispatch(request: Request): Promise<Response> {
    const requestBody = request.method === 'GET' ? null : await request.clone().text();
    const response = await onWorldClock(this.world, () =>
      handle(request, this.env, this.world.fetchFor('worker'))
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
