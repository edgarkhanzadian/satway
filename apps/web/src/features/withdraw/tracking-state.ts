import {
  type PastedWithdrawalCheck,
  type WithdrawalFacts,
  type WithdrawalProgress,
  type WithdrawalStage,
  type WithdrawalStatus,
  normalizeStacksTxid,
} from '@satway/core';

import {
  type FlowMachine,
  type Milestone,
  type Transition,
  type WithdrawalReceiptFile,
  type WithdrawalSnapshot,
  nextRequest,
  transition,
  withStacksTxid,
  withdrawalAdvice,
  withdrawalHeading,
  withdrawalId,
} from '../../shared/index.js';

export const POLL_INTERVAL_MS = 20_000;
export const SETTLED_POLL_INTERVAL_MS = 120_000;

export const NOT_A_TXID =
  'That is not a Stacks transaction ID. It is 64 hex characters, often with 0x.';
export const TXID_NOT_KNOWN =
  'Stacks does not know this transaction yet. If your wallet sent it just now, wait a minute and try again.';

export type TxidCheck =
  | { kind: 'idle' }
  | { kind: 'checking'; request: number }
  | { kind: 'refused'; message: string };

export interface TxidEntry {
  text: string;
  check: TxidCheck;
}

export type Poll =
  | { kind: 'idle' }
  | { kind: 'checking'; request: number }
  | { kind: 'waiting'; request: number }
  | { kind: 'stopped' };

export interface WalletPrompt {
  kind: 'wallet-prompt';
  last: number;
  receipt: WithdrawalReceiptFile;
}

export interface Unconfirmed {
  kind: 'unconfirmed';
  last: number;
  receipt: WithdrawalReceiptFile;
  entry: TxidEntry;
}

export interface Following {
  kind: 'following';
  last: number;
  receipt: WithdrawalReceiptFile;
  stacksTxid: string;
  snapshot: WithdrawalSnapshot | null;
  problem: string | null;
  softMismatches: number;
  delayMs: number;
  poll: Poll;
  change: TxidEntry | null;
}

export type TrackingState = WalletPrompt | Unconfirmed | Following;

export type TrackingEvent =
  | { type: 'shown'; receipt: WithdrawalReceiptFile; walletPrompt: boolean }
  | { type: 'poll-due'; request: number }
  | { type: 'polled'; request: number; snapshot: WithdrawalSnapshot }
  | { type: 'poll-failed'; request: number; message: string }
  | { type: 'txid-typed'; text: string }
  | { type: 'txid-submitted' }
  | { type: 'txid-checked'; request: number; check: PastedWithdrawalCheck }
  | { type: 'txid-check-failed'; request: number; message: string }
  | { type: 'change-opened' }
  | { type: 'change-closed' }
  | { type: 'discard-requested'; stored: WithdrawalReceiptFile | null };

export type TrackingEffect =
  | {
      type: 'check';
      request: number;
      receipt: WithdrawalReceiptFile;
      stacksTxid: string;
      softMismatches: number;
    }
  | { type: 'wait'; request: number; delayMs: number }
  | { type: 'check-txid'; request: number; receipt: WithdrawalReceiptFile; txid: string }
  | { type: 'adopt'; receipt: WithdrawalReceiptFile }
  | { type: 'resume'; receipt: WithdrawalReceiptFile }
  | { type: 'forget'; receipt: WithdrawalReceiptFile };

type Step = Transition<TrackingState, TrackingEffect>;

const EMPTY_ENTRY: TxidEntry = { text: '', check: { kind: 'idle' } };

function followingWithoutPoll(
  last: number,
  receipt: WithdrawalReceiptFile,
  stacksTxid: string
): Following {
  return {
    kind: 'following',
    last,
    receipt,
    stacksTxid,
    snapshot: null,
    problem: null,
    softMismatches: 0,
    delayMs: POLL_INTERVAL_MS,
    poll: { kind: 'idle' },
    change: null,
  };
}

function checkNow(state: Following): Step {
  const request = nextRequest(state.last);
  return transition<TrackingState, TrackingEffect>(
    { ...state, last: request, poll: { kind: 'checking', request } },
    [
      {
        type: 'check',
        request,
        receipt: state.receipt,
        stacksTxid: state.stacksTxid,
        softMismatches: state.softMismatches,
      },
    ]
  );
}

function waitThenCheck(state: Following): Step {
  const request = nextRequest(state.last);
  return transition<TrackingState, TrackingEffect>(
    { ...state, last: request, poll: { kind: 'waiting', request } },
    [{ type: 'wait', request, delayMs: state.delayMs }]
  );
}

function follow(last: number, receipt: WithdrawalReceiptFile, stacksTxid: string): Step {
  return checkNow(followingWithoutPoll(last, receipt, stacksTxid));
}

export function initialTracking(
  receipt: WithdrawalReceiptFile,
  walletPrompt: boolean,
  last = 0
): TrackingState {
  if (receipt.stacksTxid === null) {
    return walletPrompt
      ? { kind: 'wallet-prompt', last, receipt }
      : { kind: 'unconfirmed', last, receipt, entry: EMPTY_ENTRY };
  }
  return followingWithoutPoll(last, receipt, receipt.stacksTxid);
}

function sameShown(state: TrackingState, next: TrackingState): boolean {
  return (
    state.kind === next.kind &&
    withdrawalId(state.receipt) === withdrawalId(next.receipt) &&
    state.receipt.stacksTxid === next.receipt.stacksTxid
  );
}

function shown(state: TrackingState, receipt: WithdrawalReceiptFile, walletPrompt: boolean): Step {
  const target = initialTracking(receipt, walletPrompt, state.last);
  if (sameShown(state, target)) {
    return state.kind === 'following' && state.poll.kind === 'idle'
      ? checkNow(state)
      : transition(state);
  }
  return target.kind === 'following' ? checkNow(target) : transition(target);
}

function polled(state: TrackingState, request: number, snapshot: WithdrawalSnapshot): Step {
  if (state.kind !== 'following' || state.poll.kind !== 'checking') return transition(state);
  if (state.poll.request !== request) return transition(state);
  const facts = snapshot.observation.facts;
  if (facts.stacksTxid !== state.stacksTxid) {
    const receipt = withStacksTxid(state.receipt, facts.stacksTxid);
    const next = follow(state.last, receipt, facts.stacksTxid);
    return transition(next.state, [{ type: 'adopt', receipt }, ...next.effects]);
  }
  const progress = snapshot.observation.progress;
  const updated: Following = {
    ...state,
    snapshot,
    problem: null,
    softMismatches: facts.softMismatches,
  };
  if (progress.stage === 'done' || progress.stage === 'mismatch') {
    return transition({ ...updated, poll: { kind: 'stopped' } });
  }
  return waitThenCheck({
    ...updated,
    delayMs: progress.terminal ? SETTLED_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
  });
}

function pollFailed(state: TrackingState, request: number, message: string): Step {
  if (state.kind !== 'following' || state.poll.kind !== 'checking') return transition(state);
  if (state.poll.request !== request) return transition(state);
  return waitThenCheck({ ...state, problem: `Could not refresh: ${message}. Retrying.` });
}

function pollDue(state: TrackingState, request: number): Step {
  if (state.kind !== 'following' || state.poll.kind !== 'waiting') return transition(state);
  if (state.poll.request !== request) return transition(state);
  return checkNow(state);
}

function entryOf(state: TrackingState): TxidEntry | null {
  if (state.kind === 'unconfirmed') return state.entry;
  if (state.kind === 'following') return state.change;
  return null;
}

function withEntry(state: TrackingState, entry: TxidEntry, last = state.last): TrackingState {
  if (state.kind === 'unconfirmed') return { ...state, last, entry };
  if (state.kind === 'following') return { ...state, last, change: entry };
  return state;
}

function normalizedOrNull(text: string): string | null {
  try {
    return normalizeStacksTxid(text);
  } catch {
    return null;
  }
}

function txidSubmitted(state: TrackingState): Step {
  const entry = entryOf(state);
  if (!entry || entry.check.kind === 'checking') return transition(state);
  const txid = normalizedOrNull(entry.text);
  if (txid === null) {
    return transition(
      withEntry(state, { ...entry, check: { kind: 'refused', message: NOT_A_TXID } })
    );
  }
  const request = nextRequest(state.last);
  return transition(withEntry(state, { ...entry, check: { kind: 'checking', request } }, request), [
    { type: 'check-txid', request, receipt: state.receipt, txid },
  ]);
}

function refusalOf(check: Exclude<PastedWithdrawalCheck, { kind: 'matches' }>): string {
  return check.kind === 'not-found'
    ? TXID_NOT_KNOWN
    : `That transaction is not this withdrawal. ${check.message} Check the ID in your wallet’s activity.`;
}

function txidChecked(state: TrackingState, request: number, check: PastedWithdrawalCheck): Step {
  const entry = entryOf(state);
  if (!entry || entry.check.kind !== 'checking' || entry.check.request !== request) {
    return transition(state);
  }
  if (check.kind !== 'matches') {
    return transition(
      withEntry(state, { ...entry, check: { kind: 'refused', message: refusalOf(check) } })
    );
  }
  const receipt = withStacksTxid(state.receipt, check.stacksTxid);
  const next = follow(state.last, receipt, check.stacksTxid);
  return transition(next.state, [{ type: 'adopt', receipt }, ...next.effects]);
}

function txidCheckFailed(state: TrackingState, request: number, message: string): Step {
  const entry = entryOf(state);
  if (!entry || entry.check.kind !== 'checking' || entry.check.request !== request) {
    return transition(state);
  }
  return transition(
    withEntry(state, {
      ...entry,
      check: {
        kind: 'refused',
        message: `Could not check that transaction: ${message}. Try again.`,
      },
    })
  );
}

function discardRequested(state: TrackingState, stored: WithdrawalReceiptFile | null): Step {
  if (state.kind !== 'unconfirmed' || state.entry.check.kind === 'checking') {
    return transition(state);
  }
  const sent =
    stored !== null && withdrawalId(stored) === withdrawalId(state.receipt)
      ? stored.stacksTxid
      : null;
  if (stored !== null && sent !== null) {
    const next = follow(state.last, stored, sent);
    return transition(next.state, [{ type: 'resume', receipt: stored }, ...next.effects]);
  }
  return transition(state, [{ type: 'forget', receipt: state.receipt }]);
}

export function reduceTracking(state: TrackingState, event: TrackingEvent): Step {
  switch (event.type) {
    case 'shown':
      return shown(state, event.receipt, event.walletPrompt);
    case 'poll-due':
      return pollDue(state, event.request);
    case 'polled':
      return polled(state, event.request, event.snapshot);
    case 'poll-failed':
      return pollFailed(state, event.request, event.message);
    case 'txid-typed': {
      const entry = entryOf(state);
      if (!entry) return transition(state);
      return transition(withEntry(state, { text: event.text, check: { kind: 'idle' } }));
    }
    case 'txid-submitted':
      return txidSubmitted(state);
    case 'txid-checked':
      return txidChecked(state, event.request, event.check);
    case 'txid-check-failed':
      return txidCheckFailed(state, event.request, event.message);
    case 'change-opened':
      if (state.kind !== 'following' || state.change !== null) return transition(state);
      return transition({ ...state, change: EMPTY_ENTRY });
    case 'change-closed':
      if (state.kind !== 'following' || state.change === null) return transition(state);
      return transition({ ...state, change: null });
    case 'discard-requested':
      return discardRequested(state, event.stored);
    default:
      throw new Error(`Unknown tracking event ${String(event satisfies never)}`);
  }
}

export function pendingPoll(state: TrackingState): readonly number[] {
  if (state.kind !== 'following') return [];
  return state.poll.kind === 'checking' || state.poll.kind === 'waiting'
    ? [state.poll.request]
    : [];
}

export function durableTrackingEffect(effect: TrackingEffect): boolean {
  return effect.type === 'adopt' || effect.type === 'resume' || effect.type === 'forget';
}

export const trackingMachine: FlowMachine<TrackingState, TrackingEvent, TrackingEffect> = {
  reduce: reduceTracking,
  pending: pendingPoll,
  durable: durableTrackingEffect,
};

export interface TxidEntryView {
  text: string;
  checking: boolean;
  error: string | null;
}

function entryView(entry: TxidEntry): TxidEntryView {
  return {
    text: entry.text,
    checking: entry.check.kind === 'checking',
    error: entry.check.kind === 'refused' ? entry.check.message : null,
  };
}

function mayBeTheWrongTransaction(status: WithdrawalStatus | null): boolean {
  if (status === null) return false;
  if (status.kind === 'mismatch') return status.requestId === null;
  return status.kind === 'unknown-tx' || status.kind === 'not-a-withdrawal';
}

export interface FollowingView {
  kind: 'following';
  receipt: WithdrawalReceiptFile;
  stacksTxid: string;
  heading: string;
  progress: WithdrawalProgress | null;
  stage: WithdrawalStage | null;
  advice: string | null;
  problem: string | null;
  swapError: string | null;
  mismatches: readonly string[];
  facts: WithdrawalFacts | null;
  milestones: Milestone[] | null;
  changeable: boolean;
  change: TxidEntryView | null;
}

export type TrackingView =
  | { kind: 'wallet-prompt'; receipt: WithdrawalReceiptFile }
  | { kind: 'unconfirmed'; receipt: WithdrawalReceiptFile; entry: TxidEntryView }
  | FollowingView;

export function trackingView(state: TrackingState): TrackingView {
  switch (state.kind) {
    case 'wallet-prompt':
      return { kind: 'wallet-prompt', receipt: state.receipt };
    case 'unconfirmed':
      return { kind: 'unconfirmed', receipt: state.receipt, entry: entryView(state.entry) };
    case 'following': {
      const observation = state.snapshot?.observation ?? null;
      const progress = observation?.progress ?? null;
      const facts = observation?.facts ?? null;
      const stage = progress?.stage ?? null;
      return {
        kind: 'following',
        receipt: state.receipt,
        stacksTxid: state.stacksTxid,
        heading: withdrawalHeading(stage),
        progress,
        stage,
        advice: stage === null ? null : withdrawalAdvice(stage, state.receipt),
        problem: state.problem,
        swapError:
          state.snapshot?.swapError && !progress?.terminal ? state.snapshot.swapError : null,
        mismatches: stage === 'mismatch' && facts ? facts.mismatches : [],
        facts,
        milestones: state.snapshot?.milestones ?? null,
        changeable: mayBeTheWrongTransaction(observation?.stacks ?? null),
        change: state.change ? entryView(state.change) : null,
      };
    }
    default:
      throw new Error(`Unknown tracking state ${String(state satisfies never)}`);
  }
}
