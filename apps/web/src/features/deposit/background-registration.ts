import { type BackgroundRegistration, UNKNOWN_SWAP } from '../../shared/index.js';

export const UNKNOWN_SWAP_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 4_000];

export interface RetryOptions {
  delaysMs?: readonly number[];
  wait?(ms: number): Promise<void>;
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export function isUnknownSwap(result: BackgroundRegistration | null): boolean {
  return result?.kind === 'rejected' && result.code === UNKNOWN_SWAP;
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

export async function retryUnknownSwap(
  register: () => Promise<BackgroundRegistration>,
  first: BackgroundRegistration | null,
  options: RetryOptions = {}
): Promise<BackgroundRegistration | null> {
  const wait = options.wait ?? pause;
  let result = first;
  for (const delay of options.delaysMs ?? UNKNOWN_SWAP_RETRY_DELAYS_MS) {
    if (!isUnknownSwap(result)) return result;
    await wait(delay);
    result = await attempt(register);
  }
  return result;
}

export async function registerForBackground(
  register: () => Promise<BackgroundRegistration>,
  options: RetryOptions = {}
): Promise<{
  first: BackgroundRegistration | null;
  settled: Promise<BackgroundRegistration | null>;
}> {
  const first = await attempt(register);
  return { first, settled: retryUnknownSwap(register, first, options) };
}
