export interface UnmountLatch {
  mount(): void;
  unmount(): void;
}

export function realUnmount(cleanup: () => void): UnmountLatch {
  let generation = 0;
  let mounted = false;
  return {
    mount() {
      mounted = true;
      generation += 1;
    },
    unmount() {
      mounted = false;
      generation += 1;
      const mine = generation;
      queueMicrotask(() => {
        if (!mounted && generation === mine) cleanup();
      });
    },
  };
}
