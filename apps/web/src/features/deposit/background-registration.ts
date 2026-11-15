import { type BackgroundRegistration, UNKNOWN_SWAP } from '../../shared/index.js';

export const UNKNOWN_SWAP_RETRY_DELAYS_MS: readonly number[] = [
  5_000, 20_000, 60_000, 120_000, 240_000,
];
export const TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 30_000, 60_000];
export const MAX_RETRY_DELAY_MS = 120_000;
export const MAX_RETRY_AFTER_MS = 15 * 60_000;

export type RegistrationProblem = 'busy' | 'unreachable' | 'unknown-swap' | 'refused';

export type RegistrationState =
  | { kind: 'registering' }
  | { kind: 'registered' }
  | { kind: 'retrying'; problem: RegistrationProblem }
  | { kind: 'not-registered'; problem: RegistrationProblem; message: string };

export interface AttemptCounts {
  transient: number;
  unknownSwap: number;
}

export interface RegistrationStep {
  state: RegistrationState;
  delayMs: number | null;
}

function transientDelay(count: number): number {
  return TRANSIENT_RETRY_DELAYS_MS[count] ?? MAX_RETRY_DELAY_MS;
}

export function registrationStep(
  result: BackgroundRegistration | null,
  counts: AttemptCounts
): RegistrationStep {
  if (result === null) {
    return {
      state: { kind: 'retrying', problem: 'unreachable' },
      delayMs: transientDelay(counts.transient),
    };
  }
  if (result.kind === 'registered') return { state: { kind: 'registered' }, delayMs: null };
  if (result.kind === 'rejected') {
    const delay = UNKNOWN_SWAP_RETRY_DELAYS_MS[counts.unknownSwap];
    if (result.code === UNKNOWN_SWAP && delay !== undefined) {
      return { state: { kind: 'retrying', problem: 'unknown-swap' }, delayMs: delay };
    }
    return {
      state: {
        kind: 'not-registered',
        problem: result.code === UNKNOWN_SWAP ? 'unknown-swap' : 'refused',
        message: result.message,
      },
      delayMs: null,
    };
  }
  const busy = result.status === 429 || result.status === 503;
  const asked = Math.min((result.retryAfterSeconds ?? 0) * 1000, MAX_RETRY_AFTER_MS);
  return {
    state: { kind: 'retrying', problem: busy ? 'busy' : 'unreachable' },
    delayMs: Math.max(asked, transientDelay(counts.transient)),
  };
}

async function attempt(
  register: () => Promise<BackgroundRegistration>
): Promise<BackgroundRegistration | null> {
  try {
    return await register();
  } catch {
    return null;
  }
}

export interface RegisteredSwaps {
  has(swapAddress: string): boolean;
  add(swapAddress: string): void;
}

export function registeredSwapsInMemory(): RegisteredSwaps {
  const known = new Set<string>();
  return {
    has: swapAddress => known.has(swapAddress),
    add(swapAddress) {
      known.add(swapAddress);
    },
  };
}

export const registeredThisSession: RegisteredSwaps = registeredSwapsInMemory();

export function keepRegistering(
  register: () => Promise<BackgroundRegistration>,
  options: {
    first?: BackgroundRegistration | null;
    known?: { swaps: RegisteredSwaps; swapAddress: string };
    onState(state: RegistrationState): void;
  }
): () => void {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const counts: AttemptCounts = { transient: 0, unknownSwap: 0 };
  const known = options.known;

  if (known?.swaps.has(known.swapAddress) === true) {
    options.onState({ kind: 'registered' });
    return () => undefined;
  }

  function settle(result: BackgroundRegistration | null): void {
    if (!live) return;
    const step = registrationStep(result, counts);
    if (step.state.kind === 'registered' && known) known.swaps.add(known.swapAddress);
    if (result === null || result.kind === 'unavailable') counts.transient += 1;
    if (result?.kind === 'rejected' && result.code === UNKNOWN_SWAP) counts.unknownSwap += 1;
    options.onState(step.state);
    if (step.delayMs !== null) timer = setTimeout(() => void next(), step.delayMs);
  }

  async function next(): Promise<void> {
    settle(await attempt(register));
  }

  if (options.first === undefined) {
    options.onState({ kind: 'registering' });
    void next();
  } else {
    settle(options.first);
  }

  return () => {
    live = false;
    clearTimeout(timer);
  };
}

export const CLOSE_PAGE_NOTE =
  'You can close this page. The deposit continues, and you can check on it later by loading the receipt file.';

const REASONS: Record<RegistrationProblem, string> = {
  busy: 'our server is busy',
  unreachable: 'our server could not be reached',
  'unknown-swap': 'the swap provider has not listed this swap yet',
  refused: 'our server refused it',
};

export function closingNote(state: RegistrationState, terminal: boolean): string {
  if (terminal || state.kind === 'registered') return CLOSE_PAGE_NOTE;
  if (state.kind === 'registering')
    return 'Keep this page open for now: the deposit is being registered for background tracking.';
  if (state.kind === 'retrying')
    return `Keep this page open: the deposit is not registered for background tracking yet, because ${REASONS[state.problem]}. This page keeps trying. Until it succeeds, only this page can register your Bitcoin payment with the sBTC signers, so if you close it, open it again later and load the receipt file.`;
  return `Keep this page open until the deposit completes: it could not be registered for background tracking (${state.message}). While it is open, this page registers your Bitcoin payment with the sBTC signers itself. If you close it, open it again later and load the receipt file.`;
}

export async function firstRegistration(
  register: () => Promise<BackgroundRegistration>
): Promise<BackgroundRegistration | null> {
  return attempt(register);
}
