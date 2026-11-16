import {
  type AttemptOutcome,
  type Resolution,
  type SendRecord,
  type SwapTarget,
  isEvmChain,
  needsChainCheck,
  quoteExpired,
  recordTx,
  swapTargetOf,
} from '@satway/chains';

import {
  type BackgroundRegistration,
  type FlowMachine,
  type Receipt,
  type Snapshot,
  type SwapReading,
  type Transition,
  UNKNOWN_SWAP,
  nextRequest,
  transition,
} from '../../shared/index.js';
import {
  type AttemptCounts,
  type RegistrationState,
  registrationStep,
} from './background-registration.js';

export const POLL_INTERVAL_MS = 20_000;
export const CHAIN_CHECK_INTERVAL_MS = 15_000;
export const PROMPT_SLACK_MS = 100;

export const QUOTE_EXPIRED_NOT_SENT =
  'This quote has expired, so the wallet was not asked to send.';
export const WALLET_REJECTED = 'The request was rejected in your wallet, so nothing was sent.';
export const WALLET_DID_NOT_SEND = 'The wallet did not send the transaction';

export type Loop =
  | { kind: 'idle' }
  | { kind: 'running'; request: number }
  | { kind: 'waiting'; request: number }
  | { kind: 'stopped' };

export type CheckLoop =
  | { kind: 'idle' }
  | { kind: 'running'; request: number; key: string }
  | { kind: 'waiting'; request: number; key: string };

export interface Registration {
  shown: RegistrationState;
  counts: AttemptCounts;
  loop: Loop;
}

export interface Sending {
  request: number;
  keepFocus: boolean;
}

export interface SendState {
  record: SendRecord | null;
  sending: Sending | null;
  info: string | null;
  error: string | null;
  checkNote: string | null;
  check: CheckLoop;
  wallet: number;
  prompt: number | null;
  promptTicks: number;
  focus: number;
}

export interface StorageSupport {
  durable: boolean;
  lockable: boolean;
}

export interface TrackingState {
  last: number;
  receipt: Receipt;
  target: SwapTarget | null;
  storage: StorageSupport;
  poll: Loop;
  snapshot: Snapshot | null;
  reading: SwapReading | undefined;
  stale: boolean;
  problem: string | null;
  registration: Registration;
  send: SendState;
}

export type SendResult = AttemptOutcome | { kind: 'threw'; message: string };

export type TrackingEvent =
  | { type: 'shown'; first: BackgroundRegistration | null | undefined; registered: boolean }
  | { type: 'poll-due'; request: number }
  | { type: 'polled'; request: number; snapshot: Snapshot }
  | { type: 'poll-failed'; request: number; reading: SwapReading; message: string }
  | { type: 'register-due'; request: number }
  | { type: 'registration-answered'; request: number; result: BackgroundRegistration | null }
  | { type: 'record-changed'; record: SendRecord | null }
  | { type: 'wallet-changed' }
  | { type: 'chain-check-due'; request: number }
  | { type: 'chain-checked'; request: number; resolution: Resolution; record: SendRecord | null }
  | { type: 'chain-check-failed'; request: number; message: string }
  | { type: 'send-requested'; now: Date; ready: boolean; keepFocus: boolean }
  | { type: 'send-finished'; request: number; result: SendResult; record: SendRecord | null }
  | { type: 'nothing-sent-confirmed'; record: SendRecord }
  | { type: 'prompt-due'; request: number };

export type TrackingEffect =
  | {
      type: 'check-progress';
      request: number;
      receipt: Receipt;
      known: Snapshot['mints'] | undefined;
    }
  | { type: 'wait'; request: number; delayMs: number; due: TrackingEvent }
  | { type: 'register'; request: number; receipt: Receipt; swapAddress: string }
  | { type: 'remember-registered'; swapAddress: string }
  | { type: 'settle-record'; target: SwapTarget; swap: SwapReading['swap'] }
  | { type: 'release-if-cleared'; target: SwapTarget }
  | { type: 'chain-check'; request: number; target: SwapTarget }
  | { type: 'send'; request: number; target: SwapTarget; amount: string }
  | { type: 'confirm-nothing'; record: SendRecord }
  | { type: 'watch-prompt'; request: number; record: SendRecord };

type Step = Transition<TrackingState, TrackingEffect>;

function step(state: TrackingState, effects: readonly TrackingEffect[] = []): Step {
  return transition(state, effects);
}

function swapAddressOf(receipt: Receipt): string | null {
  return receipt.quoteResponse.quote.depositAddress ?? null;
}

export function trackingTarget(receipt: Receipt): SwapTarget | null {
  if (!isEvmChain(receipt.origin.chain)) return null;
  const quote = receipt.quoteResponse.quote;
  return swapTargetOf(quote.depositAddress, quote.depositMemo);
}

export function initialTracking(input: {
  receipt: Receipt;
  record: SendRecord | null;
  storage: StorageSupport;
  first: BackgroundRegistration | null | undefined;
}): TrackingState {
  return {
    last: 0,
    receipt: input.receipt,
    target: trackingTarget(input.receipt),
    storage: input.storage,
    poll: { kind: 'idle' },
    snapshot: null,
    reading: undefined,
    stale: false,
    problem: null,
    registration: {
      shown: input.first?.kind === 'registered' ? { kind: 'registered' } : { kind: 'registering' },
      counts: { transient: 0, unknownSwap: 0 },
      loop: { kind: 'idle' },
    },
    send: {
      record: input.record,
      sending: null,
      info: null,
      error: null,
      checkNote: null,
      check: { kind: 'idle' },
      wallet: 0,
      prompt: null,
      promptTicks: 0,
      focus: 0,
    },
  };
}

function allocate(state: TrackingState): [TrackingState, number] {
  const request = nextRequest(state.last);
  return [{ ...state, last: request }, request];
}

function recordStamp(record: SendRecord): string {
  return `${record.state}|${record.startedAt}|${recordTx(record) ?? ''}`;
}

function checkKey(send: SendState): string | null {
  if (send.record === null || send.sending !== null || !needsChainCheck(send.record)) return null;
  return `${recordStamp(send.record)}|${send.wallet}`;
}

function startCheck(state: TrackingState, key: string): Step {
  const target = state.target;
  if (target === null) return step(state);
  const [next, request] = allocate(state);
  return step({ ...next, send: { ...next.send, check: { kind: 'running', request, key } } }, [
    { type: 'chain-check', request, target },
  ]);
}

function reconcileCheck(state: TrackingState): Step {
  const key = checkKey(state.send);
  const check = state.send.check;
  if (key === null) {
    return check.kind === 'idle'
      ? step(state)
      : step({ ...state, send: { ...state.send, check: { kind: 'idle' } } });
  }
  if (check.kind !== 'idle' && check.key === key) return step(state);
  return startCheck(state, key);
}

function watchPrompt(state: TrackingState, previous: SendRecord | null): Step {
  const record = state.send.record;
  if (record === null || record.state !== 'attempting') {
    return state.send.prompt === null
      ? step(state)
      : step({ ...state, send: { ...state.send, prompt: null } });
  }
  if (previous !== null && recordStamp(previous) === recordStamp(record)) return step(state);
  const [next, request] = allocate(state);
  return step({ ...next, send: { ...next.send, prompt: request } }, [
    { type: 'watch-prompt', request, record },
  ]);
}

function releaseIfCleared(state: TrackingState): TrackingEffect[] {
  if (state.target === null || state.send.record !== null || state.send.sending !== null) {
    return [];
  }
  return [{ type: 'release-if-cleared', target: state.target }];
}

function afterSendChange(state: TrackingState, previous: SendRecord | null): Step {
  const prompted = watchPrompt(state, previous);
  const checked = reconcileCheck(prompted.state);
  return step(checked.state, [
    ...prompted.effects,
    ...checked.effects,
    ...releaseIfCleared(checked.state),
  ]);
}

function withRecord(state: TrackingState, record: SendRecord | null): Step {
  const previous = state.send.record;
  return afterSendChange({ ...state, send: { ...state.send, record } }, previous);
}

function checkProgressNow(state: TrackingState): Step {
  const [next, request] = allocate(state);
  return step({ ...next, poll: { kind: 'running', request } }, [
    { type: 'check-progress', request, receipt: next.receipt, known: next.snapshot?.mints },
  ]);
}

function waitThen(
  state: TrackingState,
  delayMs: number,
  due: (request: number) => TrackingEvent
): [TrackingState, number, TrackingEffect] {
  const [next, request] = allocate(state);
  return [next, request, { type: 'wait', request, delayMs, due: due(request) }];
}

function pollAgainLater(state: TrackingState): Step {
  const [next, request, wait] = waitThen(state, POLL_INTERVAL_MS, r => ({
    type: 'poll-due',
    request: r,
  }));
  return step({ ...next, poll: { kind: 'waiting', request } }, [wait]);
}

function settleRecord(state: TrackingState): TrackingEffect[] {
  if (state.target === null || state.send.sending !== null || state.reading === undefined) {
    return [];
  }
  return [{ type: 'settle-record', target: state.target, swap: state.reading.swap }];
}

function attemptRegistration(state: TrackingState): Step {
  const swapAddress = swapAddressOf(state.receipt);
  if (swapAddress === null) return step(state);
  const [next, request] = allocate(state);
  return step(
    { ...next, registration: { ...next.registration, loop: { kind: 'running', request } } },
    [{ type: 'register', request, receipt: next.receipt, swapAddress }]
  );
}

function settleRegistration(state: TrackingState, result: BackgroundRegistration | null): Step {
  const swapAddress = swapAddressOf(state.receipt);
  const { counts } = state.registration;
  const outcome = registrationStep(result, counts);
  const nextCounts: AttemptCounts = {
    transient:
      result === null || result.kind === 'unavailable' ? counts.transient + 1 : counts.transient,
    unknownSwap:
      result?.kind === 'rejected' && result.code === UNKNOWN_SWAP
        ? counts.unknownSwap + 1
        : counts.unknownSwap,
  };
  const settled: TrackingState = {
    ...state,
    registration: { shown: outcome.state, counts: nextCounts, loop: { kind: 'stopped' } },
  };
  const remember: TrackingEffect[] =
    outcome.state.kind === 'registered' && swapAddress !== null
      ? [{ type: 'remember-registered', swapAddress }]
      : [];
  if (outcome.delayMs === null) return step(settled, remember);
  const [next, request, wait] = waitThen(settled, outcome.delayMs, r => ({
    type: 'register-due',
    request: r,
  }));
  return step(
    { ...next, registration: { ...next.registration, loop: { kind: 'waiting', request } } },
    [...remember, wait]
  );
}

function shown(
  state: TrackingState,
  first: BackgroundRegistration | null | undefined,
  registered: boolean
): Step {
  if (state.poll.kind !== 'idle') return step(state);
  const polling = checkProgressNow(state);
  const effects = [...polling.effects];
  let next = polling.state;
  if (swapAddressOf(next.receipt) === null) {
    next = { ...next, registration: { ...next.registration, loop: { kind: 'stopped' } } };
  } else if (registered) {
    next = {
      ...next,
      registration: {
        ...next.registration,
        shown: { kind: 'registered' },
        loop: { kind: 'stopped' },
      },
    };
  } else if (first === undefined) {
    const attempt = attemptRegistration({
      ...next,
      registration: { ...next.registration, shown: { kind: 'registering' } },
    });
    next = attempt.state;
    effects.push(...attempt.effects);
  } else {
    const settled = settleRegistration(next, first);
    next = settled.state;
    effects.push(...settled.effects);
  }
  const send = afterSendChange(next, null);
  return step(send.state, [...effects, ...send.effects]);
}

function polled(state: TrackingState, request: number, snapshot: Snapshot): Step {
  if (state.poll.kind !== 'running' || state.poll.request !== request) return step(state);
  const updated: TrackingState = {
    ...state,
    snapshot,
    reading: { swap: snapshot.swap, remaining: snapshot.remaining },
    stale: false,
    problem: null,
  };
  if (snapshot.progress.terminal) {
    const stopped: TrackingState = {
      ...updated,
      poll: { kind: 'stopped' },
      registration: { ...updated.registration, loop: { kind: 'stopped' } },
    };
    return step(stopped, settleRecord(stopped));
  }
  const later = pollAgainLater(updated);
  return step(later.state, [...later.effects, ...settleRecord(later.state)]);
}

function pollFailed(
  state: TrackingState,
  request: number,
  reading: SwapReading,
  message: string
): Step {
  if (state.poll.kind !== 'running' || state.poll.request !== request) return step(state);
  const later = pollAgainLater({
    ...state,
    reading,
    stale: true,
    problem: `Could not refresh: ${message}. Retrying.`,
  });
  return step(later.state, [...later.effects, ...settleRecord(later.state)]);
}

function checkFinished(
  state: TrackingState,
  request: number,
  update: Partial<Pick<SendState, 'info' | 'checkNote'>>,
  record: SendRecord | null
): Step {
  const check = state.send.check;
  if (check.kind !== 'running' || check.request !== request) return step(state);
  const previous = state.send.record;
  const base: TrackingState = { ...state, send: { ...state.send, ...update, record } };
  const key = checkKey(base.send);
  if (key !== check.key) return afterSendChange(base, previous);
  const [next, waitRequest, wait] = waitThen(base, CHAIN_CHECK_INTERVAL_MS, r => ({
    type: 'chain-check-due',
    request: r,
  }));
  const waiting: TrackingState = {
    ...next,
    send: { ...next.send, check: { kind: 'waiting', request: waitRequest, key } },
  };
  const prompted = watchPrompt(waiting, previous);
  return step(prompted.state, [wait, ...prompted.effects]);
}

function chainChecked(
  state: TrackingState,
  request: number,
  resolution: Resolution,
  record: SendRecord | null
): Step {
  return checkFinished(
    state,
    request,
    {
      ...(resolution.kind === 'cleared' ? { info: resolution.message } : {}),
      checkNote: resolution.kind === 'unchanged' ? resolution.note : null,
    },
    record
  );
}

function chainCheckDue(state: TrackingState, request: number): Step {
  const check = state.send.check;
  if (check.kind !== 'waiting' || check.request !== request) return step(state);
  return startCheck(state, check.key);
}

function sendRequested(state: TrackingState, now: Date, ready: boolean, keepFocus: boolean): Step {
  const target = state.target;
  if (state.send.sending !== null || !ready || target === null) return step(state);
  if (quoteExpired(state.receipt.quoteResponse.quote.deadline, now)) {
    return step({ ...state, send: { ...state.send, error: QUOTE_EXPIRED_NOT_SENT } });
  }
  const [next, request] = allocate(state);
  const sending: TrackingState = {
    ...next,
    send: {
      ...next.send,
      sending: { request, keepFocus },
      error: null,
      info: null,
      checkNote: null,
    },
  };
  const checked = reconcileCheck(sending);
  const amount = state.receipt.quoteResponse.quote.amountIn;
  return step(checked.state, [{ type: 'send', request, target, amount }, ...checked.effects]);
}

function sendError(result: SendResult): string | null {
  switch (result.kind) {
    case 'refused':
      return result.message;
    case 'cleared':
      return result.rejected ? WALLET_REJECTED : result.message;
    case 'threw':
      return result.message || WALLET_DID_NOT_SEND;
    case 'sent':
    case 'uncertain':
      return null;
    default:
      throw new Error(`Unknown send result ${String(result satisfies never)}`);
  }
}

function sendFinished(
  state: TrackingState,
  request: number,
  result: SendResult,
  record: SendRecord | null
): Step {
  const sending = state.send.sending;
  if (sending === null || sending.request !== request) return step(state);
  const previous = state.send.record;
  return afterSendChange(
    {
      ...state,
      send: {
        ...state.send,
        sending: null,
        error: sendError(result),
        record,
        focus: sending.keepFocus ? state.send.focus + 1 : state.send.focus,
      },
    },
    previous
  );
}

function nothingSent(state: TrackingState, record: SendRecord): Step {
  return step({ ...state, send: { ...state.send, checkNote: null, info: null } }, [
    { type: 'confirm-nothing', record },
  ]);
}

function promptDue(state: TrackingState, request: number): Step {
  const record = state.send.record;
  if (state.send.prompt !== request || record === null) return step(state);
  const [next, again] = allocate(state);
  return step(
    { ...next, send: { ...next.send, prompt: again, promptTicks: next.send.promptTicks + 1 } },
    [{ type: 'watch-prompt', request: again, record }]
  );
}

export function reduceTracking(state: TrackingState, event: TrackingEvent): Step {
  switch (event.type) {
    case 'shown':
      return shown(state, event.first, event.registered);
    case 'poll-due':
      if (state.poll.kind !== 'waiting' || state.poll.request !== event.request) {
        return step(state);
      }
      return checkProgressNow(state);
    case 'polled':
      return polled(state, event.request, event.snapshot);
    case 'poll-failed':
      return pollFailed(state, event.request, event.reading, event.message);
    case 'register-due': {
      const loop = state.registration.loop;
      if (loop.kind !== 'waiting' || loop.request !== event.request) return step(state);
      return attemptRegistration(state);
    }
    case 'registration-answered': {
      const loop = state.registration.loop;
      if (loop.kind !== 'running' || loop.request !== event.request) return step(state);
      return settleRegistration(state, event.result);
    }
    case 'record-changed':
      return withRecord(state, event.record);
    case 'wallet-changed':
      return reconcileCheck({ ...state, send: { ...state.send, wallet: state.send.wallet + 1 } });
    case 'chain-check-due':
      return chainCheckDue(state, event.request);
    case 'chain-checked':
      return chainChecked(state, event.request, event.resolution, event.record);
    case 'chain-check-failed':
      return checkFinished(
        state,
        event.request,
        { checkNote: `Could not check the transaction: ${event.message}. Retrying.` },
        state.send.record
      );
    case 'send-requested':
      return sendRequested(state, event.now, event.ready, event.keepFocus);
    case 'send-finished':
      return sendFinished(state, event.request, event.result, event.record);
    case 'nothing-sent-confirmed':
      return nothingSent(state, event.record);
    case 'prompt-due':
      return promptDue(state, event.request);
    default:
      throw new Error(`Unknown tracking event ${String(event satisfies never)}`);
  }
}

export function pendingTracking(state: TrackingState): readonly number[] {
  const running: number[] = [];
  if (state.poll.kind === 'running') running.push(state.poll.request);
  if (state.registration.loop.kind === 'running') running.push(state.registration.loop.request);
  if (state.send.check.kind === 'running') running.push(state.send.check.request);
  return running;
}

const DURABLE: ReadonlySet<TrackingEffect['type']> = new Set([
  'remember-registered',
  'settle-record',
  'release-if-cleared',
  'send',
  'confirm-nothing',
]);

export function durableTrackingEffect(effect: TrackingEffect): boolean {
  return DURABLE.has(effect.type);
}

export const trackingMachine: FlowMachine<TrackingState, TrackingEvent, TrackingEffect> = {
  reduce: reduceTracking,
  pending: pendingTracking,
  durable: durableTrackingEffect,
};
