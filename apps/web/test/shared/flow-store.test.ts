import { describe, expect, it } from 'vitest';

import {
  type FlowMachine,
  createFlowStore,
  nextRequest,
  pureMachine,
  transition,
} from '../../src/shared/flow-store.js';

type QuoteState =
  | { kind: 'editing'; last: number }
  | { kind: 'quoting'; last: number; request: number; amount: string }
  | { kind: 'quoted'; last: number; amount: string; quote: string };

type QuoteEvent =
  | { type: 'edited' }
  | { type: 'requested'; amount: string }
  | { type: 'answered'; request: number; quote: string };

function reduceQuote(state: QuoteState, event: QuoteEvent): QuoteState {
  switch (event.type) {
    case 'edited':
      return state.kind === 'editing' ? state : { kind: 'editing', last: state.last };
    case 'requested': {
      if (state.kind === 'quoting') return state;
      const request = nextRequest(state.last);
      return { kind: 'quoting', last: request, request, amount: event.amount };
    }
    case 'answered':
      if (state.kind !== 'quoting' || state.request !== event.request) return state;
      return { kind: 'quoted', last: state.last, amount: state.amount, quote: event.quote };
    default:
      throw new Error(`Unknown event ${String(event satisfies never)}`);
  }
}

function pendingQuote(state: QuoteState): readonly number[] {
  return state.kind === 'quoting' ? [state.request] : [];
}

const quoteMachine = pureMachine(reduceQuote, pendingQuote);

function quoteStore() {
  return createFlowStore(quoteMachine, { kind: 'editing', last: 0 }, () => undefined);
}

function requestOf(state: QuoteState): number {
  if (state.kind !== 'quoting') throw new Error(`Expected quoting, got ${state.kind}`);
  return state.request;
}

describe('createFlowStore', () => {
  it('applies a reply only when it answers the request the state is waiting on', () => {
    const store = quoteStore();
    store.dispatch({ type: 'requested', amount: '1' });
    const first = requestOf(store.get());
    store.dispatch({ type: 'edited' });
    store.dispatch({ type: 'requested', amount: '2' });
    const second = requestOf(store.get());
    store.dispatch({ type: 'answered', request: first, quote: 'late, for 1' });
    expect(store.get()).toMatchObject({ kind: 'quoting', amount: '2' });
    store.dispatch({ type: 'answered', request: second, quote: 'for 2' });
    expect(store.get()).toEqual({ kind: 'quoted', last: second, amount: '2', quote: 'for 2' });
  });

  it('aborts the signal of a request as soon as the state stops waiting on it', () => {
    const store = quoteStore();
    store.dispatch({ type: 'requested', amount: '1' });
    const signal = store.signal(requestOf(store.get()));
    expect(signal.aborted).toBe(false);
    store.dispatch({ type: 'edited' });
    expect(signal.aborted).toBe(true);
  });

  it('keeps the signal of a request alive while the state still waits on it', () => {
    const store = quoteStore();
    store.dispatch({ type: 'requested', amount: '1' });
    const request = requestOf(store.get());
    const signal = store.signal(request);
    store.dispatch({ type: 'requested', amount: 'ignored while quoting' });
    expect(store.signal(request)).toBe(signal);
    expect(signal.aborted).toBe(false);
  });

  it('hands out an already aborted signal for a request that is not pending', () => {
    const store = quoteStore();
    expect(store.signal(7).aborted).toBe(true);
  });

  it('aborts the pending request once the answer is applied, so a late abort is harmless', () => {
    const store = quoteStore();
    store.dispatch({ type: 'requested', amount: '1' });
    const request = requestOf(store.get());
    const signal = store.signal(request);
    store.dispatch({ type: 'answered', request, quote: 'q' });
    expect(signal.aborted).toBe(true);
    expect(store.get().kind).toBe('quoted');
  });

  it('notifies subscribers only when the state changes, and stops after unsubscribing', () => {
    const store = quoteStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.dispatch({ type: 'edited' });
    expect(calls).toBe(0);
    store.dispatch({ type: 'requested', amount: '1' });
    expect(calls).toBe(1);
    unsubscribe();
    store.dispatch({ type: 'edited' });
    expect(calls).toBe(1);
  });

  it('abortAll aborts every pending request', () => {
    const store = quoteStore();
    store.dispatch({ type: 'requested', amount: '1' });
    const signal = store.signal(requestOf(store.get()));
    store.abortAll();
    expect(signal.aborted).toBe(true);
  });

  it('runs the effects of a transition after the state is updated', () => {
    interface Counter {
      count: number;
    }
    interface Effect {
      kind: 'saw';
      count: number;
    }
    const machine: FlowMachine<Counter, 'add' | 'noop', Effect> = {
      reduce(state, event) {
        if (event === 'noop') return transition(state);
        const next = { count: state.count + 1 };
        return transition(next, [{ kind: 'saw', count: next.count }]);
      },
    };
    const seen: { effect: Effect; state: Counter }[] = [];
    const store = createFlowStore(machine, { count: 0 }, effect => {
      seen.push({ effect, state: store.get() });
    });
    store.dispatch('add');
    store.dispatch('noop');
    store.dispatch('add');
    expect(seen).toEqual([
      { effect: { kind: 'saw', count: 1 }, state: { count: 1 } },
      { effect: { kind: 'saw', count: 2 }, state: { count: 2 } },
    ]);
  });

  it('lets an effect dispatch again, seeing the state its transition produced', () => {
    type Effect = 'echo';
    const machine: FlowMachine<string[], string, Effect> = {
      reduce(state, event) {
        const next = [...state, event];
        return transition(next, event === 'ping' ? ['echo'] : []);
      },
    };
    const store = createFlowStore<string[], string, Effect>(machine, [], () =>
      store.dispatch('pong')
    );
    store.dispatch('ping');
    expect(store.get()).toEqual(['ping', 'pong']);
  });
});

describe('nextRequest', () => {
  it('issues a new identity after the last one', () => {
    expect(nextRequest(0)).toBe(1);
    expect(nextRequest(41)).toBe(42);
  });
});
