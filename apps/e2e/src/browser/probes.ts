import type { Page } from '@playwright/test';

export interface TimerCounts {
  timeouts: number;
  intervals: number;
  longTimeouts: number;
}

export interface CodeEvalCounts {
  evalCalls: number;
  functionCalls: number;
}

function numberAt(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null) return -1;
  const read: unknown = Reflect.get(value, key);
  return typeof read === 'number' ? read : -1;
}

async function readProbe(page: Page, name: string): Promise<unknown> {
  return page.evaluate(probe => {
    const read: unknown = Reflect.get(window, probe);
    if (typeof read !== 'function') throw new Error(`The ${probe} probe is not installed`);
    const value: unknown = Reflect.apply(read, window, []);
    return value;
  }, name);
}

export async function installTimerProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const timeouts = new Map<number, number>();
    const intervals = new Set<number>();
    const setT = window.setTimeout;
    const clearT = window.clearTimeout;
    const setI = window.setInterval;
    const clearI = window.clearInterval;
    function asId(value: unknown): number {
      return typeof value === 'number' ? value : -1;
    }
    function wrappedSetTimeout(handler: unknown, ms?: number, ...args: unknown[]): number {
      const id = asId(
        Reflect.apply(setT, window, [
          (...inner: unknown[]) => {
            timeouts.delete(id);
            if (typeof handler === 'function') Reflect.apply(handler, window, inner);
          },
          ms,
          ...args,
        ])
      );
      timeouts.set(id, typeof ms === 'number' ? ms : 0);
      return id;
    }
    function wrappedClearTimeout(id?: number): void {
      if (id !== undefined) timeouts.delete(id);
      Reflect.apply(clearT, window, [id]);
    }
    function wrappedSetInterval(handler: unknown, ms?: number, ...args: unknown[]): number {
      const id = asId(Reflect.apply(setI, window, [handler, ms, ...args]));
      intervals.add(id);
      return id;
    }
    function wrappedClearInterval(id?: number): void {
      if (id !== undefined) intervals.delete(id);
      Reflect.apply(clearI, window, [id]);
    }
    function counts() {
      return {
        timeouts: timeouts.size,
        intervals: intervals.size,
        longTimeouts: [...timeouts.values()].filter(ms => ms >= 1_000).length,
      };
    }
    Reflect.set(window, 'setTimeout', wrappedSetTimeout);
    Reflect.set(window, 'clearTimeout', wrappedClearTimeout);
    Reflect.set(window, 'setInterval', wrappedSetInterval);
    Reflect.set(window, 'clearInterval', wrappedClearInterval);
    Object.defineProperty(window, '__e2eTimers', { enumerable: false, value: counts });
  });
}

export async function timerCounts(page: Page): Promise<TimerCounts> {
  const counts = await readProbe(page, '__e2eTimers');
  return {
    timeouts: numberAt(counts, 'timeouts'),
    intervals: numberAt(counts, 'intervals'),
    longTimeouts: numberAt(counts, 'longTimeouts'),
  };
}

export async function installCodeEvalProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { evalCalls: 0, functionCalls: 0 };
    function fromPage(): boolean {
      return !(new Error().stack ?? '').includes('UtilityScript');
    }
    const originalEval = window.eval;
    const originalFunction = window.Function;
    const countedEval = new Proxy(originalEval, {
      apply(target, self, args): unknown {
        if (fromPage()) seen.evalCalls += 1;
        const out: unknown = Reflect.apply(target, self, args);
        return out;
      },
    });
    const countedFunction = new Proxy(originalFunction, {
      apply(target, self, args): unknown {
        if (fromPage()) seen.functionCalls += 1;
        const out: unknown = Reflect.apply(target, self, args);
        return out;
      },
      construct(target, args): object {
        if (fromPage()) seen.functionCalls += 1;
        const out: unknown = Reflect.construct(target, args);
        if (typeof out !== 'function') throw new TypeError('Function did not build a function');
        return out;
      },
    });
    function counts() {
      return { ...seen };
    }
    Reflect.set(window, 'eval', countedEval);
    Reflect.set(window, 'Function', countedFunction);
    Object.defineProperty(originalFunction.prototype, 'constructor', {
      configurable: true,
      writable: true,
      value: countedFunction,
    });
    Object.defineProperty(window, '__e2eCodeEval', { enumerable: false, value: counts });
  });
}

export async function codeEvalCounts(page: Page): Promise<CodeEvalCounts> {
  const counts = await readProbe(page, '__e2eCodeEval');
  return {
    evalCalls: numberAt(counts, 'evalCalls'),
    functionCalls: numberAt(counts, 'functionCalls'),
  };
}
