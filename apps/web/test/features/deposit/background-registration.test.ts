import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UNKNOWN_SWAP_RETRY_DELAYS_MS,
  registerForBackground,
} from '../../../src/features/deposit/background-registration.js';
import { type BackgroundRegistration, createBackend } from '../../../src/shared/backend.js';

const UNKNOWN: BackgroundRegistration = {
  kind: 'rejected',
  status: 400,
  message: '"swapDepositAddress" is not a known 1Click swap',
  code: 'unknown-swap',
};
const REGISTERED: BackgroundRegistration = { kind: 'registered', address: 'bc1pwatched' };

function scripted(answers: readonly (BackgroundRegistration | Error)[]) {
  const calls: number[] = [];
  function register(): Promise<BackgroundRegistration> {
    calls.push(Date.now());
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next === undefined) return Promise.reject(new Error('no answer scripted'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
  return { calls, register };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('registerForBackground', () => {
  it('returns after the first attempt and retries an unknown swap in the background', async () => {
    const { calls, register } = scripted([UNKNOWN, UNKNOWN, REGISTERED]);
    const { first, settled } = await registerForBackground(register);
    expect(first).toEqual(UNKNOWN);
    expect(calls).toEqual([0]);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(calls).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([0, 2_000]);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls).toEqual([0, 2_000, 6_000]);
    expect(await settled).toEqual(REGISTERED);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(3);
  });

  it('gives up quietly after a bounded number of attempts within about ten seconds', async () => {
    const { calls, register } = scripted([UNKNOWN]);
    const { settled } = await registerForBackground(register);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await settled).toEqual(UNKNOWN);
    expect(calls).toEqual([0, 2_000, 6_000, 10_000]);
    expect(calls).toHaveLength(UNKNOWN_SWAP_RETRY_DELAYS_MS.length + 1);
  });

  it.each([
    ['registered', REGISTERED],
    ['another rejection', { kind: 'rejected', status: 400, message: 'The swap has already ended' }],
    ['a busy backend', { kind: 'unavailable', status: 503, message: 'at capacity' }],
  ] satisfies [string, BackgroundRegistration][])('does not retry %s', async (_name, answer) => {
    const { calls, register } = scripted([answer]);
    const { first, settled } = await registerForBackground(register);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(first).toEqual(answer);
    expect(await settled).toEqual(answer);
    expect(calls).toEqual([0]);
  });

  it('treats a thrown attempt as non-fatal and stops retrying', async () => {
    const { calls, register } = scripted([UNKNOWN, new Error('Unexpected data')]);
    const { settled } = await registerForBackground(register);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await settled).toBeNull();
    expect(calls).toEqual([0, 2_000]);
  });

  it('retries through the real backend client on the Worker’s unknown-swap code only', async () => {
    const statuses: number[] = [];
    const replies = [
      { status: 400, body: { message: 'not known', code: 'unknown-swap' } },
      { status: 400, body: { message: 'not known', code: 'unknown-swap' } },
      { status: 201, body: { address: 'bc1pwatched', deadline: '2026-11-15T14:00:00.000Z' } },
    ];
    vi.stubGlobal('fetch', () => {
      const reply = replies[Math.min(statuses.length, replies.length - 1)];
      if (!reply) return Promise.reject(new Error('no reply scripted'));
      statuses.push(reply.status);
      return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
    });
    const backend = createBackend('https://api.example');
    const { first, settled } = await registerForBackground(() =>
      backend.register('aa', 'bb', '0xswap')
    );
    expect(first).toEqual({
      kind: 'rejected',
      status: 400,
      message: 'not known',
      code: 'unknown-swap',
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await settled).toEqual(REGISTERED);
    expect(statuses).toEqual([400, 400, 201]);
  });
});
