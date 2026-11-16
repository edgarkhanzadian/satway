import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PastedWithdrawalCheck } from '@satway/core';

import {
  type PollEffect,
  type TrackingIo,
  type TxidEffect,
  trackingRunner,
} from '../../../src/features/withdraw/tracking-effects.js';
import {
  POLL_INTERVAL_MS,
  type TrackingEffect,
  type TrackingState,
  initialTracking,
  trackingMachine,
} from '../../../src/features/withdraw/tracking-state.js';
import { createFlowStore } from '../../../src/shared/flow-store.js';
import {
  type WithdrawalSnapshot,
  withdrawalMilestones,
} from '../../../src/shared/withdrawal-progress.js';
import { STACKS, observationOf, receiptFixture } from '../../shared/withdrawal-fixtures.js';

const SENT = receiptFixture();
const DRAFT = receiptFixture({ stacksTxid: null });
const OTHER_TXID = 'd'.repeat(64);

function snapshot(stacksTxid: string): WithdrawalSnapshot {
  const pending = observationOf({ stacks: STACKS.pending });
  const observation = { ...pending, facts: { ...pending.facts, stacksTxid } };
  return { observation, milestones: withdrawalMilestones(observation), swapError: null };
}

function deferred<T>() {
  let settle: ((value: T) => void) | null = null;
  const promise = new Promise<T>(resolve => {
    settle = resolve;
  });
  function resolve(value: T) {
    settle?.(value);
  }
  return { promise, resolve };
}

async function settled(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function harness(initial: TrackingState, options: { holdPolls?: boolean } = {}) {
  const polls: { effect: PollEffect; signal: AbortSignal }[] = [];
  const txids: {
    effect: TxidEffect;
    answer: ReturnType<typeof deferred<PastedWithdrawalCheck>>;
  }[] = [];
  const calls: string[] = [];
  const io: TrackingIo = {
    check(effect, signal) {
      polls.push({ effect, signal });
      if (options.holdPolls === true) return deferred<WithdrawalSnapshot>().promise;
      return Promise.resolve(snapshot(effect.stacksTxid));
    },
    checkTxid(effect) {
      const answer = deferred<PastedWithdrawalCheck>();
      txids.push({ effect, answer });
      return answer.promise;
    },
    adopt: receipt => calls.push(`adopt ${receipt.stacksTxid ?? 'none'}`),
    resume: () => calls.push('resume'),
    forget: () => calls.push('forget'),
  };
  let run: ((effect: TrackingEffect) => void) | null = null;
  const store = createFlowStore(trackingMachine, initial, effect => run?.(effect));
  run = trackingRunner(io, store);
  store.attach();
  return { store, polls, txids, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the tracking effects, run against the store as the screen mounts and unmounts', () => {
  it('polls, then keeps exactly one timer until the next poll', async () => {
    const { store, polls } = harness(initialTracking(SENT, false));
    store.dispatch({ type: 'shown', receipt: SENT, walletPrompt: false });
    await settled();
    expect(polls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await settled();
    expect(polls).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('Hide then Follow leaves one timer: the hidden screen’s timer and poll are stopped', async () => {
    const hidden = harness(initialTracking(SENT, false));
    hidden.store.dispatch({ type: 'shown', receipt: SENT, walletPrompt: false });
    await settled();
    hidden.store.detach();
    await settled();
    expect(vi.getTimerCount()).toBe(0);

    const followed = harness(initialTracking(SENT, false));
    followed.store.dispatch({ type: 'shown', receipt: SENT, walletPrompt: false });
    await settled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(hidden.polls).toHaveLength(1);
    expect(followed.polls).toHaveLength(4);
  });

  it('a poll in flight is aborted when the screen unmounts, not when StrictMode remounts it', async () => {
    const { store, polls } = harness(initialTracking(SENT, false), { holdPolls: true });
    store.dispatch({ type: 'shown', receipt: SENT, walletPrompt: false });
    store.detach();
    store.attach();
    await settled();
    expect(polls[0]?.signal.aborted).toBe(false);
    const next = harness(initialTracking(SENT, false), { holdPolls: true });
    next.store.dispatch({ type: 'shown', receipt: SENT, walletPrompt: false });
    const signal = next.polls[0]?.signal;
    next.store.detach();
    await settled();
    expect(signal?.aborted).toBe(true);
  });

  it('tab switch during wallet prompt: the answered prompt starts polling the sent txid', async () => {
    const { store, polls } = harness(initialTracking(DRAFT, true));
    store.dispatch({ type: 'shown', receipt: DRAFT, walletPrompt: true });
    expect(polls).toHaveLength(0);
    store.dispatch({ type: 'shown', receipt: SENT, walletPrompt: false });
    await settled();
    expect(polls.map(p => p.effect.stacksTxid)).toEqual([SENT.stacksTxid]);
  });

  it('a pasted txid verified after Hide is still adopted, but not polled', async () => {
    const { store, txids, calls, polls } = harness(initialTracking(DRAFT, false));
    store.dispatch({ type: 'txid-typed', text: OTHER_TXID });
    store.dispatch({ type: 'txid-submitted' });
    expect(txids).toHaveLength(1);
    store.detach();
    await settled();
    txids[0]?.answer.resolve({ kind: 'matches', stacksTxid: OTHER_TXID });
    await settled();
    expect(calls).toEqual([`adopt ${OTHER_TXID}`]);
    expect(polls).toHaveLength(0);
  });

  it('“Nothing was sent” is ignored while a pasted txid is being checked, so its answer is kept', async () => {
    const { store, txids, calls } = harness(initialTracking(DRAFT, false));
    store.dispatch({ type: 'txid-typed', text: OTHER_TXID });
    store.dispatch({ type: 'txid-submitted' });
    store.dispatch({ type: 'discard-requested', stored: DRAFT });
    expect(calls).toEqual([]);
    txids[0]?.answer.resolve({ kind: 'matches', stacksTxid: OTHER_TXID });
    await settled();
    expect(calls).toEqual([`adopt ${OTHER_TXID}`]);
  });
});
