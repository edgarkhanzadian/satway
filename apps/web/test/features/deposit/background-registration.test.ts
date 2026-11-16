import { describe, expect, it } from 'vitest';

import {
  CLOSE_PAGE_NOTE,
  MAX_RETRY_DELAY_MS,
  type RegistrationState,
  TRANSIENT_RETRY_DELAYS_MS,
  UNKNOWN_SWAP_RETRY_DELAYS_MS,
  closingNote,
  registrationStep,
} from '../../../src/features/deposit/background-registration.js';
import type { BackgroundRegistration } from '../../../src/shared/backend.js';

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

describe('registrationStep', () => {
  it('is registered on success, including a repeat the Worker answers with 409', () => {
    expect(registrationStep(REGISTERED, { transient: 0, unknownSwap: 0 })).toEqual({
      state: { kind: 'registered' },
      delayMs: null,
    });
  });

  it('a swap the Worker cannot add to an address it already follows keeps the page open', () => {
    const full: BackgroundRegistration = {
      kind: 'rejected',
      status: 409,
      message: 'This deposit address already has as many swaps as background tracking follows',
    };
    const step = registrationStep(full, { transient: 0, unknownSwap: 0 });
    expect(step).toMatchObject({
      state: { kind: 'not-registered', problem: 'refused' },
      delayMs: null,
    });
    expect(closingNote(step.state, false)).toMatch(
      /^Keep this page open until the deposit completes/
    );
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
