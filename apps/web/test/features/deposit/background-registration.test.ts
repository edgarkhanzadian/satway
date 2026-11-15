import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLOSE_PAGE_NOTE,
  MAX_RETRY_DELAY_MS,
  type RegistrationState,
  TRANSIENT_RETRY_DELAYS_MS,
  UNKNOWN_SWAP_RETRY_DELAYS_MS,
  closingNote,
  keepRegistering,
  registeredSwapsInMemory,
  registrationStep,
} from '../../../src/features/deposit/background-registration.js';
import { type BackgroundRegistration, createBackend } from '../../../src/shared/backend.js';

const UNKNOWN: BackgroundRegistration = {
  kind: 'rejected',
  status: 400,
  message: '"swapDepositAddress" is not a known 1Click swap',
  code: 'unknown-swap',
};
const REGISTERED: BackgroundRegistration = { kind: 'registered', address: 'bc1pwatched' };
const LIMITED: BackgroundRegistration = {
  kind: 'unavailable',
  status: 429,
  message: 'Too many requests. Try again later.',
  retryAfterSeconds: 60,
};
const AT_CAPACITY: BackgroundRegistration = {
  kind: 'unavailable',
  status: 503,
  message: 'Background tracking is at capacity.',
  retryAfterSeconds: 900,
};
const OFFLINE: BackgroundRegistration = {
  kind: 'unavailable',
  status: null,
  message: 'The backend could not be reached',
};
const ENDED: BackgroundRegistration = {
  kind: 'rejected',
  status: 400,
  message: 'The swap has already ended',
};

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

function run(
  answers: readonly (BackgroundRegistration | Error)[],
  first?: BackgroundRegistration | null
) {
  const { calls, register } = scripted(answers);
  const states: RegistrationState[] = [];
  const stop = keepRegistering(register, {
    ...(first === undefined ? {} : { first }),
    onState: s => states.push(s),
  });
  return { calls, states, stop };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('registrationStep', () => {
  it('is registered on success, including a repeat the Worker answers with 409', () => {
    expect(registrationStep(REGISTERED, { transient: 0, unknownSwap: 0 })).toEqual({
      state: { kind: 'registered' },
      delayMs: null,
    });
  });

  it('retries the rate limit no sooner than the Worker asks', () => {
    expect(registrationStep(LIMITED, { transient: 0, unknownSwap: 0 })).toEqual({
      state: { kind: 'retrying', problem: 'busy' },
      delayMs: 60_000,
    });
  });

  it('retries a full server after its Retry-After, capped', () => {
    expect(registrationStep(AT_CAPACITY, { transient: 0, unknownSwap: 0 }).delayMs).toBe(900_000);
    expect(
      registrationStep(
        { ...AT_CAPACITY, retryAfterSeconds: 86_400 },
        { transient: 0, unknownSwap: 0 }
      ).delayMs
    ).toBe(15 * 60_000);
  });

  it('backs off on network failures and 5xx, up to a ceiling, without ever giving up', () => {
    const delays = Array.from(
      { length: 9 },
      (_, transient) => registrationStep(OFFLINE, { transient, unknownSwap: 0 }).delayMs
    );
    expect(delays.slice(0, TRANSIENT_RETRY_DELAYS_MS.length)).toEqual(TRANSIENT_RETRY_DELAYS_MS);
    expect(delays.slice(TRANSIENT_RETRY_DELAYS_MS.length)).toEqual(
      Array(9 - TRANSIENT_RETRY_DELAYS_MS.length).fill(MAX_RETRY_DELAY_MS)
    );
    expect(registrationStep(OFFLINE, { transient: 50, unknownSwap: 0 }).state).toEqual({
      kind: 'retrying',
      problem: 'unreachable',
    });
    expect(
      registrationStep(
        { kind: 'unavailable', status: 502, message: 'Upstream error' },
        { transient: 0, unknownSwap: 0 }
      ).state
    ).toEqual({ kind: 'retrying', problem: 'unreachable' });
  });

  it('retries an unknown swap a bounded number of times, spaced to stay inside the rate limit', () => {
    expect(UNKNOWN_SWAP_RETRY_DELAYS_MS[0]).toBeGreaterThanOrEqual(5_000);
    const firstMinute = [0];
    for (const delay of UNKNOWN_SWAP_RETRY_DELAYS_MS) {
      const at = (firstMinute.at(-1) ?? 0) + delay;
      if (at < 60_000) firstMinute.push(at);
    }
    expect(firstMinute.length).toBeLessThanOrEqual(3);
    expect(
      registrationStep(UNKNOWN, {
        transient: 0,
        unknownSwap: UNKNOWN_SWAP_RETRY_DELAYS_MS.length,
      })
    ).toEqual({
      state: { kind: 'not-registered', problem: 'unknown-swap', message: UNKNOWN.message },
      delayMs: null,
    });
  });

  it('stops on any other rejection, which a retry would not change', () => {
    expect(registrationStep(ENDED, { transient: 0, unknownSwap: 0 })).toEqual({
      state: { kind: 'not-registered', problem: 'refused', message: ENDED.message },
      delayMs: null,
    });
  });

  it('retries an answer it could not read', () => {
    expect(registrationStep(null, { transient: 0, unknownSwap: 0 })).toEqual({
      state: { kind: 'retrying', problem: 'unreachable' },
      delayMs: TRANSIENT_RETRY_DELAYS_MS[0],
    });
  });
});

describe('closingNote', () => {
  it('says the page can be closed only once registered, or when the deposit is over', () => {
    expect(closingNote({ kind: 'registered' }, false)).toBe(CLOSE_PAGE_NOTE);
    expect(closingNote({ kind: 'retrying', problem: 'busy' }, true)).toBe(CLOSE_PAGE_NOTE);
    for (const state of [
      { kind: 'registering' },
      { kind: 'retrying', problem: 'busy' },
      { kind: 'not-registered', problem: 'refused', message: 'The swap has already ended' },
    ] satisfies RegistrationState[]) {
      const note = closingNote(state, false);
      expect(note).toMatch(/^Keep this page open/);
      expect(note).not.toContain('You can close this page');
    }
  });

  it('says why, and that reopening with the receipt registers the payment', () => {
    expect(closingNote({ kind: 'retrying', problem: 'busy' }, false)).toContain(
      'because our server is busy. This page keeps trying.'
    );
    expect(closingNote({ kind: 'retrying', problem: 'unreachable' }, false)).toContain(
      'because our server could not be reached'
    );
    const refused = closingNote(
      { kind: 'not-registered', problem: 'refused', message: 'The swap has already ended' },
      false
    );
    expect(refused).toContain('(The swap has already ended)');
    expect(refused).toContain('open it again later and load the receipt file');
  });
});

describe('keepRegistering', () => {
  it('reports registering, then registered, and makes no more calls', async () => {
    const { calls, states } = run([REGISTERED]);
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([{ kind: 'registering' }, { kind: 'registered' }]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls).toEqual([0]);
  });

  it('continues from the first attempt made at Continue without repeating it', async () => {
    const { calls, states } = run([REGISTERED], LIMITED);
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([{ kind: 'retrying', problem: 'busy' }]);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual([60_000]);
    expect(states.at(-1)).toEqual({ kind: 'registered' });
  });

  it('keeps retrying a rate-limited and then unreachable server while the page is open', async () => {
    const { calls, states } = run([LIMITED, OFFLINE, OFFLINE, REGISTERED]);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([0]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual([0, 60_000]);
    expect(states.at(-1)).toEqual({ kind: 'retrying', problem: 'unreachable' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(4);
    expect(states.at(-1)).toEqual({ kind: 'registered' });
  });

  it('does not ask again for a swap this tab already registered, so following it again costs nothing', async () => {
    const swaps = registeredSwapsInMemory();
    const first = scripted([REGISTERED]);
    keepRegistering(first.register, {
      known: { swaps, swapAddress: '0xswap' },
      onState: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(first.calls).toHaveLength(1);
    const again = scripted([REGISTERED]);
    const states: RegistrationState[] = [];
    keepRegistering(again.register, {
      known: { swaps, swapAddress: '0xswap' },
      onState: s => states.push(s),
    });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(again.calls).toEqual([]);
    expect(states).toEqual([{ kind: 'registered' }]);
    expect(swaps.has('0xother')).toBe(false);
  });

  it('stops calling once stopped, for instance when the page closes the deposit', async () => {
    const { calls, stop } = run([OFFLINE]);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(calls).toEqual([0]);
  });

  it('treats a thrown attempt as transient', async () => {
    const { calls, states } = run([new Error('Unexpected data'), REGISTERED]);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({ kind: 'retrying', problem: 'unreachable' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(2);
    expect(states.at(-1)).toEqual({ kind: 'registered' });
  });

  it('gives up on a swap 1Click never lists, and says so', async () => {
    const { calls, states } = run([UNKNOWN]);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(calls).toHaveLength(UNKNOWN_SWAP_RETRY_DELAYS_MS.length + 1);
    expect(states.at(-1)).toEqual({
      kind: 'not-registered',
      problem: 'unknown-swap',
      message: UNKNOWN.message,
    });
  });

  it('retries through the real backend client, reading Retry-After', async () => {
    const statuses: number[] = [];
    const replies: { status: number; body: unknown; headers: Record<string, string> }[] = [
      { status: 400, body: { message: 'not known', code: 'unknown-swap' }, headers: {} },
      {
        status: 429,
        body: { message: 'Too many requests. Try again later.' },
        headers: { 'retry-after': '60' },
      },
      { status: 201, body: { address: 'bc1pwatched' }, headers: {} },
    ];
    vi.stubGlobal('fetch', () => {
      const reply = replies[Math.min(statuses.length, replies.length - 1)];
      if (!reply) return Promise.reject(new Error('no reply scripted'));
      statuses.push(reply.status);
      return Promise.resolve(
        new Response(JSON.stringify(reply.body), { status: reply.status, headers: reply.headers })
      );
    });
    const backend = createBackend('https://api.example');
    const states: RegistrationState[] = [];
    keepRegistering(() => backend.register('aa', 'bb', '0xswap'), { onState: s => states.push(s) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(statuses).toEqual([400, 429]);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(statuses).toEqual([400, 429]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(statuses).toEqual([400, 429, 201]);
    expect(states.at(-1)).toEqual({ kind: 'registered' });
  });
});
