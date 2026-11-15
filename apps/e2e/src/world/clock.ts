export const RealDate = Date;

export function realNow(): number {
  return RealDate.now();
}

export interface Gate {
  release(): void;
  readonly promise: Promise<void>;
}

export function gate(): Gate {
  let open: (() => void) | null = null;
  const promise = new Promise<void>(resolve => {
    open = resolve;
  });
  return {
    promise,
    release() {
      open?.();
    },
  };
}
