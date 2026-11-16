import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { type FlowMachine, createFlowStore } from './flow-store.js';

export interface Flow<S, E> {
  readonly state: S;
  dispatch(event: E): void;
  current(): S;
  signal(request: number): AbortSignal;
}

export function useFlow<S, E, X>(
  machine: FlowMachine<S, E, X>,
  initial: () => S,
  run?: (effect: X) => void
): Flow<S, E> {
  const runRef = useRef(run);
  runRef.current = run;
  const mounted = useRef(true);
  const [store] = useState(() =>
    createFlowStore(machine, initial(), effect => {
      if (mounted.current) runRef.current?.(effect);
    })
  );
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      store.abortAll();
    };
  }, [store]);

  return useMemo(
    () => ({ state, dispatch: store.dispatch, current: store.get, signal: store.signal }),
    [state, store]
  );
}
