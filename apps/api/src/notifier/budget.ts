import type { FetchLike } from '@portage/core';

import type { KV } from '../store/index.js';

export class BudgetExhausted extends Error {
  constructor() {
    super('The per-run request budget is spent; the rest waits for the next run');
    this.name = 'BudgetExhausted';
  }
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

export function countedFetch(fetchFn: FetchLike | undefined, budget: Budget): FetchLike {
  const base = fetchFn ?? globalFetch;
  return (input, init) => {
    budget.take();
    return base(input, init);
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
