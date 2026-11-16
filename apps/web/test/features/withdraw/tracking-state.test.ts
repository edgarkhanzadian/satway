import { describe, expect, it } from 'vitest';

import type { WithdrawalObservation } from '@satway/core';

import {
  NOT_A_TXID,
  POLL_INTERVAL_MS,
  SETTLED_POLL_INTERVAL_MS,
  TXID_NOT_KNOWN,
  type TrackingEffect,
  type TrackingEvent,
  type TrackingState,
  initialTracking,
  reduceTracking,
  trackingView,
} from '../../../src/features/withdraw/tracking-state.js';
import {
  type WithdrawalSnapshot,
  withdrawalMilestones,
} from '../../../src/shared/withdrawal-progress.js';
import {
  STACKS,
  STACKS_TXID,
  observationOf,
  receiptFixture,
} from '../../shared/withdrawal-fixtures.js';

const OTHER_TXID = 'd'.repeat(64);
const SENT = receiptFixture();
const DRAFT = receiptFixture({ stacksTxid: null });

function snapshotOf(
  observation: WithdrawalObservation,
  over: Partial<WithdrawalSnapshot> = {}
): WithdrawalSnapshot {
  return { observation, milestones: withdrawalMilestones(observation), swapError: null, ...over };
}

function followedTo(observation: WithdrawalObservation, stacksTxid: string): WithdrawalObservation {
  return { ...observation, facts: { ...observation.facts, stacksTxid } };
}

function run(state: TrackingState, ...events: TrackingEvent[]) {
  let current = state;
  const effects: TrackingEffect[] = [];
  for (const event of events) {
    const next = reduceTracking(current, event);
    current = next.state;
    effects.push(...next.effects);
  }
  return { state: current, effects };
}

function following(state: TrackingState) {
  if (state.kind !== 'following') throw new Error(`Expected following, got ${state.kind}`);
  return state;
}

function pollRequest(state: TrackingState): number {
  const poll = following(state).poll;
  if (poll.kind !== 'checking' && poll.kind !== 'waiting') {
    throw new Error(`Expected a poll in flight, got ${poll.kind}`);
  }
  return poll.request;
}

function txidRequest(state: TrackingState): number {
  const entry = state.kind === 'unconfirmed' ? state.entry : following(state).change;
  if (entry?.check.kind !== 'checking') throw new Error('Expected a txid check in flight');
  return entry.check.request;
}

function started() {
  return run(initialTracking(SENT, false), { type: 'shown', receipt: SENT, walletPrompt: false });
}

function polledWith(state: TrackingState, snapshot: WithdrawalSnapshot) {
  return run(state, { type: 'polled', request: pollRequest(state), snapshot });
}

function due(state: TrackingState) {
  return run(state, { type: 'poll-due', request: pollRequest(state) });
}

const PENDING = snapshotOf(observationOf({ stacks: STACKS.pending }));
const FAILED = snapshotOf(observationOf({ stacks: STACKS.failed }));
const HARD_MISMATCH = snapshotOf(
  observationOf({ stacks: STACKS.mismatch, mismatches: ['The amount differs'] })
);
const SOFT = snapshotOf(observationOf({ stacks: STACKS.registryLag, softMismatches: 1 }));

describe('which screen a withdrawal shows', () => {
  it('waits for the wallet while the prompt is open, asks once it closed without a txid, follows once it has one', () => {
    expect(initialTracking(DRAFT, true).kind).toBe('wallet-prompt');
    expect(initialTracking(DRAFT, false).kind).toBe('unconfirmed');
    expect(initialTracking(SENT, false).kind).toBe('following');
  });

  it('tab switch during wallet prompt: the prompt view follows the wallet’s answer', () => {
    const waiting = initialTracking(DRAFT, true);
    const answered = run(waiting, { type: 'shown', receipt: SENT, walletPrompt: false });
    expect(answered.state.kind).toBe('following');
    expect(answered.effects).toEqual([
      expect.objectContaining({ type: 'check', stacksTxid: STACKS_TXID }),
    ]);
    const lost = run(waiting, { type: 'shown', receipt: DRAFT, walletPrompt: false });
    expect(lost.state.kind).toBe('unconfirmed');
    expect(lost.effects).toEqual([]);
  });

  it('starts polling once when shown, and showing the same withdrawal again is a no-op', () => {
    const first = started();
    expect(first.effects).toEqual([
      {
        type: 'check',
        request: pollRequest(first.state),
        receipt: SENT,
        stacksTxid: STACKS_TXID,
        softMismatches: 0,
      },
    ]);
    const again = run(first.state, { type: 'shown', receipt: { ...SENT }, walletPrompt: false });
    expect(again.state).toBe(first.state);
    expect(again.effects).toEqual([]);
  });

  it('starts over for a different withdrawal', () => {
    const first = polledWith(started().state, PENDING);
    const other = receiptFixture({ stacksTxid: OTHER_TXID });
    const next = run(first.state, { type: 'shown', receipt: other, walletPrompt: false });
    expect(following(next.state)).toMatchObject({
      stacksTxid: OTHER_TXID,
      snapshot: null,
      softMismatches: 0,
    });
    expect(next.effects).toEqual([
      expect.objectContaining({ type: 'check', stacksTxid: OTHER_TXID }),
    ]);
  });
});

describe('polling', () => {
  it('shows each poll result and waits the normal interval before the next', () => {
    const result = polledWith(started().state, PENDING);
    expect(following(result.state).snapshot).toBe(PENDING);
    expect(result.effects).toEqual([
      { type: 'wait', request: pollRequest(result.state), delayMs: POLL_INTERVAL_MS },
    ]);
    const next = due(result.state);
    expect(next.effects).toEqual([expect.objectContaining({ type: 'check' })]);
  });

  it('slows down on a terminal-looking stage that is not done', () => {
    const result = polledWith(started().state, FAILED);
    expect(result.effects).toEqual([
      expect.objectContaining({ type: 'wait', delayMs: SETTLED_POLL_INTERVAL_MS }),
    ]);
  });

  it('stops polling when the withdrawal is done', () => {
    const done = snapshotOf(observationOf({ stacks: STACKS.accepted, swap: 'SUCCESS' }));
    expect(done.observation.progress.stage).toBe('done');
    const result = polledWith(started().state, done);
    expect(following(result.state).poll).toEqual({ kind: 'stopped' });
    expect(result.effects).toEqual([]);
  });

  it('hard mismatch stays latched: no more polls, so its warning cannot flip back', () => {
    const result = polledWith(started().state, HARD_MISMATCH);
    expect(result.state.kind === 'following' && result.state.poll).toEqual({ kind: 'stopped' });
    const late = run(
      result.state,
      { type: 'poll-due', request: 1 },
      { type: 'poll-due', request: 2 },
      { type: 'polled', request: 2, snapshot: PENDING },
      { type: 'poll-failed', request: 2, message: 'x' }
    );
    expect(late.state).toBe(result.state);
    expect(late.effects).toEqual([]);
    expect(trackingView(late.state)).toMatchObject({
      stage: 'mismatch',
      mismatches: ['The amount differs'],
    });
  });

  it('ignores a poll result or timer for a request it is not waiting on', () => {
    const first = started();
    const stale = run(
      first.state,
      { type: 'polled', request: pollRequest(first.state) + 1, snapshot: PENDING },
      { type: 'poll-due', request: pollRequest(first.state) }
    );
    expect(stale.state).toBe(first.state);
    expect(stale.effects).toEqual([]);
  });

  it('a read error says so, keeps the last snapshot and retries at the same cadence', () => {
    const settled = polledWith(started().state, FAILED);
    const checking = due(settled.state);
    const failed = run(checking.state, {
      type: 'poll-failed',
      request: pollRequest(checking.state),
      message: 'Network down',
    });
    expect(following(failed.state)).toMatchObject({
      snapshot: FAILED,
      problem: 'Could not refresh: Network down. Retrying.',
    });
    expect(failed.effects).toEqual([
      expect.objectContaining({ type: 'wait', delayMs: SETTLED_POLL_INTERVAL_MS }),
    ]);
    const recovered = polledWith(due(failed.state).state, FAILED);
    expect(following(recovered.state).problem).toBeNull();
  });

  it('soft streak survives read error', () => {
    const soft = polledWith(started().state, SOFT);
    const checking = due(soft.state);
    const failed = run(checking.state, {
      type: 'poll-failed',
      request: pollRequest(checking.state),
      message: 'timeout',
    });
    const retry = due(failed.state);
    expect(retry.effects).toEqual([expect.objectContaining({ type: 'check', softMismatches: 1 })]);
  });

  it('replacement followed once: persists and downloads the new receipt, then follows it', () => {
    const replaced = snapshotOf(followedTo(PENDING.observation, OTHER_TXID));
    const hop = polledWith(started().state, replaced);
    const receipt = { ...SENT, stacksTxid: OTHER_TXID };
    expect(hop.effects).toEqual([
      { type: 'adopt', receipt },
      expect.objectContaining({ type: 'check', stacksTxid: OTHER_TXID, softMismatches: 0 }),
    ]);
    expect(following(hop.state)).toMatchObject({ stacksTxid: OTHER_TXID, snapshot: null });
    const echoed = run(hop.state, { type: 'shown', receipt, walletPrompt: false });
    expect(echoed.state).toBe(hop.state);
    expect(echoed.effects).toEqual([]);
    const same = snapshotOf(followedTo(PENDING.observation, OTHER_TXID));
    const after = polledWith(hop.state, same);
    expect(after.effects.filter(e => e.type === 'adopt')).toEqual([]);
  });
});

describe('a pasted transaction ID', () => {
  function unconfirmed() {
    return initialTracking(DRAFT, false);
  }

  it('refuses text that is not a txid without any request', () => {
    const result = run(
      unconfirmed(),
      { type: 'txid-typed', text: 'not a txid' },
      { type: 'txid-submitted' }
    );
    expect(trackingView(result.state)).toMatchObject({
      entry: { text: 'not a txid', checking: false, error: NOT_A_TXID },
    });
    expect(result.effects).toEqual([]);
  });

  it('pasted txid verified: checked against the withdrawal before it is followed and saved', () => {
    const asked = run(
      unconfirmed(),
      { type: 'txid-typed', text: `0x${OTHER_TXID}` },
      { type: 'txid-submitted' }
    );
    expect(asked.effects).toEqual([
      { type: 'check-txid', request: txidRequest(asked.state), receipt: DRAFT, txid: OTHER_TXID },
    ]);
    expect(trackingView(asked.state)).toMatchObject({ entry: { checking: true } });
    const twice = run(asked.state, { type: 'txid-submitted' });
    expect(twice.effects).toEqual([]);

    const request = txidRequest(asked.state);
    const unknown = run(asked.state, {
      type: 'txid-checked',
      request,
      check: { kind: 'not-found' },
    });
    expect(trackingView(unknown.state)).toMatchObject({ entry: { error: TXID_NOT_KNOWN } });
    expect(unknown.effects).toEqual([]);

    const other = run(asked.state, {
      type: 'txid-checked',
      request,
      check: { kind: 'different', message: 'It withdraws a different amount.' },
    });
    expect(trackingView(other.state)).toMatchObject({
      entry: {
        error:
          'That transaction is not this withdrawal. It withdraws a different amount. Check the ID in your wallet’s activity.',
      },
    });

    const failed = run(asked.state, { type: 'txid-check-failed', request, message: 'offline' });
    expect(trackingView(failed.state)).toMatchObject({
      entry: { error: 'Could not check that transaction: offline. Try again.' },
    });

    const matched = run(asked.state, {
      type: 'txid-checked',
      request,
      check: { kind: 'matches', stacksTxid: OTHER_TXID },
    });
    const receipt = { ...DRAFT, stacksTxid: OTHER_TXID };
    expect(matched.effects).toEqual([
      { type: 'adopt', receipt },
      expect.objectContaining({ type: 'check', stacksTxid: OTHER_TXID }),
    ]);
    expect(following(matched.state).receipt).toEqual(receipt);
  });

  it('editing the ID drops the check in flight', () => {
    const asked = run(
      unconfirmed(),
      { type: 'txid-typed', text: OTHER_TXID },
      { type: 'txid-submitted' }
    );
    const request = txidRequest(asked.state);
    const edited = run(
      asked.state,
      { type: 'txid-typed', text: `${OTHER_TXID}0` },
      { type: 'txid-checked', request, check: { kind: 'matches', stacksTxid: OTHER_TXID } }
    );
    expect(edited.state.kind).toBe('unconfirmed');
    expect(edited.effects).toEqual([]);
    expect(trackingView(edited.state)).toMatchObject({ entry: { checking: false, error: null } });
  });

  it('“Change transaction” opens an entry, Cancel closes it, a match replaces the followed txid', () => {
    const unknownTx = snapshotOf(observationOf({ stacks: STACKS.unknown }));
    const watching = polledWith(started().state, unknownTx);
    expect(trackingView(watching.state)).toMatchObject({ changeable: true, change: null });
    const closed = run(watching.state, { type: 'change-opened' }, { type: 'change-closed' });
    expect(trackingView(closed.state)).toMatchObject({ change: null });
    const opened = run(
      watching.state,
      { type: 'change-opened' },
      { type: 'txid-typed', text: OTHER_TXID },
      { type: 'txid-submitted' }
    );
    const matched = run(opened.state, {
      type: 'txid-checked',
      request: txidRequest(opened.state),
      check: { kind: 'matches', stacksTxid: OTHER_TXID },
    });
    expect(following(matched.state)).toMatchObject({ stacksTxid: OTHER_TXID, change: null });
    expect(matched.effects[0]).toEqual({
      type: 'adopt',
      receipt: { ...SENT, stacksTxid: OTHER_TXID },
    });
  });

  it('a poll arriving while the change entry is checking keeps the entry', () => {
    const unknownTx = snapshotOf(observationOf({ stacks: STACKS.unknown }));
    const watching = polledWith(started().state, unknownTx);
    const opened = run(
      watching.state,
      { type: 'change-opened' },
      { type: 'txid-typed', text: OTHER_TXID },
      { type: 'txid-submitted' }
    );
    const polled = polledWith(due(opened.state).state, unknownTx);
    expect(trackingView(polled.state)).toMatchObject({ change: { checking: true } });
  });
});

describe('discarding an unconfirmed withdrawal', () => {
  it('discard never drops a sent withdrawal: one saved with a txid is followed instead', () => {
    const result = run(initialTracking(DRAFT, false), { type: 'discard-requested', stored: SENT });
    expect(result.effects).toEqual([
      { type: 'resume', receipt: SENT },
      expect.objectContaining({ type: 'check', stacksTxid: STACKS_TXID }),
    ]);
    expect(following(result.state).receipt).toBe(SENT);
  });

  it('forgets a draft that the browser holds without a txid, or not at all', () => {
    for (const stored of [DRAFT, null, receiptFixture({ depositAddress: 'other' })]) {
      const result = run(initialTracking(DRAFT, false), { type: 'discard-requested', stored });
      expect(result.effects).toEqual([{ type: 'forget', receipt: DRAFT }]);
      expect(result.state.kind).toBe('unconfirmed');
    }
  });

  it('is ignored outside the unconfirmed screen', () => {
    const state = initialTracking(DRAFT, true);
    const result = run(state, { type: 'discard-requested', stored: null });
    expect(result.state).toBe(state);
    expect(result.effects).toEqual([]);
  });
});

describe('events that do not apply leave the state alone', () => {
  const events: TrackingEvent[] = [
    { type: 'poll-due', request: 1 },
    { type: 'polled', request: 1, snapshot: PENDING },
    { type: 'poll-failed', request: 1, message: 'x' },
    { type: 'txid-typed', text: 'x' },
    { type: 'txid-submitted' },
    { type: 'txid-checked', request: 1, check: { kind: 'not-found' } },
    { type: 'txid-check-failed', request: 1, message: 'x' },
    { type: 'change-opened' },
    { type: 'change-closed' },
    { type: 'discard-requested', stored: null },
  ];
  for (const event of events) {
    it(`${event.type} while the wallet prompt is open`, () => {
      const state = initialTracking(DRAFT, true);
      const result = reduceTracking(state, event);
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    });
  }
});

describe('trackingView', () => {
  it('hides a swap read error once the stage is terminal', () => {
    const failing = polledWith(started().state, { ...FAILED, swapError: 'down' });
    expect(trackingView(failing.state)).toMatchObject({ swapError: null });
    const pending = polledWith(started().state, { ...PENDING, swapError: 'down' });
    expect(trackingView(pending.state)).toMatchObject({ swapError: 'down' });
  });

  it('starts as “in progress” with no snapshot', () => {
    expect(trackingView(started().state)).toMatchObject({
      heading: 'Withdrawal in progress',
      progress: null,
      advice: null,
      milestones: null,
      changeable: false,
    });
  });
});
