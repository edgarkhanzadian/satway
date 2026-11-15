import { type FetchLike, withTimeout } from '@satway/core';

import type { KV } from '../store/index.js';

export const WORKER_REQUEST_TIMEOUT_MS = 10_000;
export const RUN_TIME_BUDGET_MS = 75_000;

export class BudgetExhausted extends Error {
  constructor(message = 'The per-run request budget is spent; the rest waits for the next run') {
    super(message);
    this.name = 'BudgetExhausted';
  }
}

export interface RunClock {
  now(): number;
  deadline: number;
}

export function runClock(
  timeBudgetMs = RUN_TIME_BUDGET_MS,
  now: () => number = Date.now
): RunClock {
  return { now, deadline: now() + timeBudgetMs };
}

export class Budget {
  private spent = 0;

  constructor(readonly max: number) {}

  get used(): number {
    return this.spent;
  }

  remaining(): number {
    return this.max - this.spent;
  }

  take(): void {
    if (this.spent >= this.max) throw new BudgetExhausted();
    this.spent += 1;
  }
}

function globalFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

export function countedFetch(
  fetchFn: FetchLike | undefined,
  budget: Budget,
  clock: RunClock = runClock()
): FetchLike {
  const base = fetchFn ?? globalFetch;
  return (input, init) => {
    const left = clock.deadline - clock.now();
    if (left <= 0) {
      return Promise.reject(
        new BudgetExhausted('The run is out of time; the rest waits for the next run')
      );
    }
    budget.take();
    const timeoutMs = Math.min(WORKER_REQUEST_TIMEOUT_MS, left);
    return withTimeout(input, { ...init, timeoutMs }, signalled => base(input, signalled));
  };
}

export function countedKv(kv: KV, budget: Budget): KV {
  return {
    get(key) {
      budget.take();
      return kv.get(key);
    },
    put(key, value, options) {
      budget.take();
      return kv.put(key, value, options);
    },
    delete(key) {
      budget.take();
      return kv.delete(key);
    },
    list(options) {
      budget.take();
      return kv.list(options);
    },
  };
}
