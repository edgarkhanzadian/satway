export interface Transition<S, X> {
  readonly state: S;
  readonly effects: readonly X[];
}

export interface FlowMachine<S, E, X> {
  reduce(state: S, event: E): Transition<S, X>;
  pending?(state: S): readonly number[];
}

export interface FlowStore<S, E> {
  get(): S;
  dispatch(event: E): void;
  signal(request: number): AbortSignal;
  subscribe(listener: () => void): () => void;
  abortAll(): void;
}

export function transition<S, X>(state: S, effects: readonly X[] = []): Transition<S, X> {
  return { state, effects };
}

export function pureMachine<S, E>(
  reduce: (state: S, event: E) => S,
  pending?: (state: S) => readonly number[]
): FlowMachine<S, E, never> {
  return {
    reduce: (state, event) => ({ state: reduce(state, event), effects: [] }),
    ...(pending === undefined ? {} : { pending }),
  };
}

export function nextRequest(last: number): number {
  return last + 1;
}

export function createFlowStore<S, E, X>(
  machine: FlowMachine<S, E, X>,
  initial: S,
  run: (effect: X) => void
): FlowStore<S, E> {
  let state = initial;
  const listeners = new Set<() => void>();
  const controllers = new Map<number, AbortController>();

  function pendingNow(): readonly number[] {
    return machine.pending?.(state) ?? [];
  }

  function reconcile(): void {
    const live = new Set(pendingNow());
    for (const [request, controller] of controllers) {
      if (live.has(request)) continue;
      controller.abort();
      controllers.delete(request);
    }
  }

  return {
    get() {
      return state;
    },
    dispatch(event) {
      const next = machine.reduce(state, event);
      const changed = next.state !== state;
      state = next.state;
      if (changed) {
        reconcile();
        for (const listener of [...listeners]) listener();
      }
      for (const effect of next.effects) run(effect);
    },
    signal(request) {
      if (!pendingNow().includes(request)) return AbortSignal.abort();
      const existing = controllers.get(request);
      if (existing) return existing.signal;
      const controller = new AbortController();
      controllers.set(request, controller);
      return controller.signal;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    abortAll() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    },
  };
}
