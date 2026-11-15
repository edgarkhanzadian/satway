export interface LatestRequests {
  begin(): () => boolean;
  current(): () => boolean;
  cancel(): void;
}

export function latestRequests(): LatestRequests {
  let generation = 0;
  function checker(): () => boolean {
    const mine = generation;
    return () => mine === generation;
  }
  return {
    begin() {
      generation += 1;
      return checker();
    },
    current: checker,
    cancel() {
      generation += 1;
    },
  };
}
