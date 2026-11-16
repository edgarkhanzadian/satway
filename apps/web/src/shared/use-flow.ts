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
  const [store] = useState(() =>
    createFlowStore(machine, initial(), effect => runRef.current?.(effect))
  );
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);

  useEffect(() => {
    store.attach();
    return () => store.detach();
  }, [store]);

  return useMemo(
    () => ({ state, dispatch: store.dispatch, current: store.get, signal: store.signal }),
    [state, store]
  );
}
