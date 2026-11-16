import { renderToStaticMarkup } from 'react-dom/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type EvmTransactionState,
  type KeyValueStore,
  LANDED_FAILED_MESSAGE,
  type SendLock,
  type SendRecord,
  type SourceWallet,
  attemptingRecord,
  createSendRecords,
  sendRecordKey,
  sentRecord,
} from '@satway/chains';
import { type OneClickSwapStatus, type PayoutObservation, deriveProgress } from '@satway/core';

import {
  CLOSE_PAGE_NOTE,
  registeredSwapsInMemory,
} from '../../../src/features/deposit/background-registration.js';
import {
  NO_WALLET_TO_CHECK,
  createTrackingRunner,
} from '../../../src/features/deposit/tracking-effects.js';
import {
  POLL_INTERVAL_MS,
  QUOTE_EXPIRED_NOT_SENT,
  type TrackingEffect,
  type TrackingState,
  WALLET_REJECTED,
  durableTrackingEffect,
  initialTracking,
  pendingTracking,
  reduceTracking,
  trackingMachine,
  trackingTarget,
} from '../../../src/features/deposit/tracking-state.js';
import { trackingView } from '../../../src/features/deposit/tracking-view.js';
import { createFlowStore } from '../../../src/shared/flow-store.js';
import {
  type Backend,
  type BackgroundRegistration,
  ProgressReadError,
  type Snapshot,
  createBackend,
} from '../../../src/shared/index.js';
import { PayoutNotices } from '../../../src/ui/index.js';
import { RECEIPT, TOKEN } from './deposit-fixtures.js';

const SWAP = RECEIPT.quoteResponse.quote.depositAddress ?? '';
const TARGET = trackingTarget(RECEIPT);
const USDC = { ...TOKEN, contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
const WALLET: SourceWallet = {
  name: 'Test wallet',
  address: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
  provider: { request: () => Promise.reject(new Error('not used')) },
};
const TX = `0x${'ab'.repeat(32)}`;
const BEFORE_DEADLINE = new Date('2026-11-14T13:00:00.000Z');
const NEAR_DEADLINE = new Date('2026-11-14T13:56:00.000Z');

const REGISTERED: BackgroundRegistration = { kind: 'registered', address: 'bc1pwatched' };
const LIMITED: BackgroundRegistration = {
  kind: 'unavailable',
  status: 429,
  message: 'Too many requests. Try again later.',
  retryAfterSeconds: 60,
};
const UNKNOWN: BackgroundRegistration = {
  kind: 'rejected',
  status: 400,
  message: '"swapDepositAddress" is not a known 1Click swap',
  code: 'unknown-swap',
};
const SWAP_FULL: BackgroundRegistration = {
  kind: 'rejected',
  status: 409,
  message: 'This deposit address already has as many swaps as background tracking follows',
};

const PAYOUT: PayoutObservation = {
  payout: { txid: 'aa'.repeat(32), vout: 0, amountSats: 35_300, confirmed: true, blockHeight: 10 },
  mint: 'pending',
};

function snapshot(
  swap: OneClickSwapStatus | null,
  payouts: readonly PayoutObservation[] = [],
  extra: Partial<Snapshot> = {}
): Snapshot {
  const progress = deriveProgress({ swap, payouts, tipHeight: 12, reclaimLockBlocks: 950 });
  return {
    progress,
    swap,
    payouts: payouts.map(p => ({ ...p.payout, blockTime: null, spent: false })),
    belowMinimum: [],
    foreignTxids: [],
    outputs: [],
    mints: new Map(),
    mintUnknown: false,
    tipHeight: 12,
    truncated: false,
    registrationError: null,
    registrationErrors: [],
    remaining: null,
    refund: null,
    ...extra,
  };
}

function memoryStorage(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function fakeLock(): SendLock & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    claim(name) {
      if (held.has(name)) return Promise.resolve(false);
      held.add(name);
      return Promise.resolve(true);
    },
    release(name) {
      held.delete(name);
    },
  };
}

interface Script {
  polls?: (Snapshot | Error)[];
  registrations?: (BackgroundRegistration | Error)[];
  chain?: EvmTransactionState[];
  send?(): Promise<string>;
  first?: BackgroundRegistration | null;
  record?: SendRecord;
  wallet?: SourceWallet | null;
  backend?: Backend;
}

function harness(script: Script = {}) {
  const storage = memoryStorage();
  const lock = fakeLock();
  const records = createSendRecords(() => storage, lock);
  if (script.record) records.write(script.record);
  const polls = [...(script.polls ?? [snapshot('PENDING_DEPOSIT')])];
  const registrations = [...(script.registrations ?? [REGISTERED])];
  const chain = [...(script.chain ?? ['pending'])];
  const calls: { polls: number; registrations: number[]; sends: number; known: unknown[] } = {
    polls: 0,
    registrations: [],
    sends: 0,
    known: [],
  };
  const effects: TrackingEffect[] = [];
  const registered = registeredSwapsInMemory();
  function next<T>(list: T[]): T | undefined {
    return list.length > 1 ? list.shift() : list[0];
  }
  const backend: Backend = script.backend ?? {
    tokens: () => Promise.reject(new Error('not used')),
    quote: () => Promise.reject(new Error('not used')),
    status: () => Promise.reject(new Error('not used')),
    register() {
      calls.registrations.push(Date.now());
      const answer = next(registrations);
      if (answer === undefined) return Promise.reject(new Error('no answer'));
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  const target = trackingTarget(RECEIPT);
  const store = createFlowStore(
    trackingMachine,
    initialTracking({
      receipt: RECEIPT,
      record: target === null ? null : records.read(target),
      storage: { durable: true, lockable: true },
      first: script.first,
    }),
    effect => {
      effects.push(effect);
      runner.run(effect);
    }
  );
  const runner = createTrackingRunner({
    backend,
    records,
    registered,
    checkProgress(_receipt, known) {
      calls.polls += 1;
      calls.known.push(known);
      const answer = next(polls);
      if (answer === undefined) return Promise.reject(new Error('no poll'));
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
    wallet: () => (script.wallet === undefined ? WALLET : script.wallet),
    token: () => USDC,
    evmState: () => Promise.resolve(next(chain) ?? 'unknown'),
    sendTransfer() {
      calls.sends += 1;
      return script.send ? script.send() : Promise.resolve(TX);
    },
    dispatch: event => store.dispatch(event),
  });
  function view(now = BEFORE_DEADLINE) {
    return trackingView(store.get(), { now, token: USDC, source: WALLET });
  }
  return { store, records, storage, lock, calls, effects, registered, view, runner };
}

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers({ now: BEFORE_DEADLINE });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tracking: polling', () => {
  it('shows "Checking…" before the first reply and then the progress from core', async () => {
    const h = harness();
    expect(h.view().message).toBe('Checking…');
    expect(h.view().payment).toBe('checking');
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.view().message).toBe(snapshot('PENDING_DEPOSIT').progress.message);
    expect(h.view().payment).toBe('pay');
  });

  it('polls every 20 seconds and passes the previous mint results back in', async () => {
    const mints: Snapshot['mints'] = new Map([['aa:0', 'pending']]);
    const h = harness({ polls: [snapshot('PROCESSING', [], { mints }), snapshot('PROCESSING')] });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.calls.polls).toBe(1);
    await settle(POLL_INTERVAL_MS - 1);
    expect(h.calls.polls).toBe(1);
    await settle(1);
    expect(h.calls.polls).toBe(2);
    expect(h.calls.known).toEqual([undefined, mints]);
  });

  it('is done only when core says so, and stops polling then', async () => {
    const minting = snapshot('SUCCESS', [PAYOUT]);
    const done = snapshot('SUCCESS', [{ ...PAYOUT, mint: 'confirmed' }]);
    expect(minting.progress.terminal).toBe(false);
    const h = harness({ polls: [minting, done] });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.view()).toMatchObject({ done: false, terminal: false });
    await settle(POLL_INTERVAL_MS);
    expect(h.view()).toMatchObject({ done: true, terminal: true });
    await settle(POLL_INTERVAL_MS * 5);
    expect(h.calls.polls).toBe(2);
    expect(h.store.get().poll).toEqual({ kind: 'stopped' });
  });

  it('a first poll failure keeps the 1Click reading and shows no instructions for a funded swap', async () => {
    const h = harness({
      polls: [
        new ProgressReadError({ swap: 'PROCESSING', remaining: null }, new Error('HTTP 503')),
      ],
    });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.store.get().reading).toEqual({ swap: 'PROCESSING', remaining: null });
    expect(h.view()).toMatchObject({
      payment: 'none',
      problem: 'Could not refresh: HTTP 503. Retrying.',
      message: 'Checking…',
    });
  });

  it('a first poll failure while 1Click awaits payment keeps the instructions and pauses the wallet send', async () => {
    const h = harness({
      polls: [
        new ProgressReadError({ swap: 'PENDING_DEPOSIT', remaining: null }, new Error('HTTP 503')),
      ],
    });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.view()).toMatchObject({ payment: 'pay', sendButton: null });
    expect(h.view().panel).toEqual({ kind: 'unknown' });
  });

  it('a poll failure with no reading at all leaves the payment unknown, not offered', async () => {
    const h = harness({ polls: [new Error('offline')] });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.view().payment).toBe('unknown');
  });

  it('an early payment to the deposit address keeps the send instructions', async () => {
    const early = snapshot('PENDING_DEPOSIT', [PAYOUT]);
    expect(early.progress.stage).toBe('awaiting-funds');
    const h = harness({ polls: [early] });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.view()).toMatchObject({ payment: 'pay', sendButton: 'offer' });
  });

  it('a short deposit shows what is still owed', async () => {
    const h = harness({ polls: [snapshot('INCOMPLETE_DEPOSIT', [], { remaining: 5_000_000n })] });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.view()).toMatchObject({
      shortDeposit: true,
      owedKnown: true,
      sendAmount: { kind: 'verified', text: '5.0' },
    });
  });

  it('showing twice, as a StrictMode remount does, starts one poll and one registration', async () => {
    const h = harness();
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.calls.polls).toBe(1);
    expect(h.calls.registrations).toHaveLength(1);
  });

  it('the mint-unknown and foreign-payout notices come with the snapshot', () => {
    const html = renderToStaticMarkup(
      <PayoutNotices
        snapshot={snapshot('SUCCESS', [PAYOUT], {
          mintUnknown: true,
          foreignTxids: ['cc'.repeat(32)],
        })}
      />
    );
    expect(html).toContain('This does not mean the deposit failed.');
    expect(html).toContain('cc'.repeat(32));
  });
});

describe('tracking: background registration', () => {
  it('registers once and says the page can be closed', async () => {
    const h = harness();
    expect(h.view().closingNote).toMatch(/^Keep this page open for now/);
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.view()).toMatchObject({ closable: true, closingNote: CLOSE_PAGE_NOTE });
    expect(h.registered.has(SWAP)).toBe(true);
    await settle(600_000);
    expect(h.calls.registrations).toHaveLength(1);
  });

  it('continues from the attempt made at Continue, waiting as long as Retry-After asks', async () => {
    const h = harness({ first: LIMITED });
    h.store.dispatch({ type: 'shown', first: LIMITED, registered: false });
    await settle();
    expect(h.calls.registrations).toEqual([]);
    expect(h.store.get().registration.shown).toEqual({ kind: 'retrying', problem: 'busy' });
    expect(h.view().closingNote).toMatch(/because our server is busy/);
    await settle(59_999);
    expect(h.calls.registrations).toEqual([]);
    await settle(1);
    expect(h.calls.registrations).toHaveLength(1);
    expect(h.view().closingNote).toBe(CLOSE_PAGE_NOTE);
  });

  it('treats a thrown attempt as transient and retries after five seconds', async () => {
    const h = harness({ registrations: [new Error('Unexpected data'), REGISTERED] });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.store.get().registration.shown).toEqual({ kind: 'retrying', problem: 'unreachable' });
    await settle(5_000);
    expect(h.calls.registrations).toHaveLength(2);
    expect(h.store.get().registration.shown).toEqual({ kind: 'registered' });
  });

  it('a 409 for a swap the Worker cannot add (swap-limit) keeps the page open and stops asking', async () => {
    const h = harness({ registrations: [SWAP_FULL] });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle(3_600_000);
    expect(h.calls.registrations).toHaveLength(1);
    expect(h.view()).toMatchObject({ closable: false });
    expect(h.view().closingNote).toMatch(
      /^Keep this page open until the deposit completes: it could not be registered for background tracking \(This deposit address already has/
    );
  });

  it('gives up on a swap 1Click never lists, after its retry schedule', async () => {
    const h = harness({ registrations: [UNKNOWN] });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle(3_600_000);
    expect(h.calls.registrations).toHaveLength(6);
    expect(h.store.get().registration.shown).toEqual({
      kind: 'not-registered',
      problem: 'unknown-swap',
      message: UNKNOWN.message,
    });
  });

  it('does not ask again for a swap this tab already registered', async () => {
    const h = harness();
    h.store.dispatch({ type: 'shown', first: undefined, registered: true });
    await settle(600_000);
    expect(h.calls.registrations).toEqual([]);
    expect(h.view().closingNote).toBe(CLOSE_PAGE_NOTE);
  });

  it('stops retrying once the deposit is terminal, and then says the page can be closed', async () => {
    const h = harness({
      polls: [snapshot('REFUNDED')],
      registrations: [new Error('offline')],
    });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle(3_600_000);
    expect(h.calls.registrations.length).toBeLessThanOrEqual(1);
    expect(h.view()).toMatchObject({ closable: true, closingNote: CLOSE_PAGE_NOTE });
  });
});

describe('tracking: registration through the real backend client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries an unknown swap and a rate limit, reading Retry-After, until registered', async () => {
    const statuses: number[] = [];
    const replies: { status: number; body: unknown; headers: Record<string, string> }[] = [
      { status: 400, body: { message: 'not known', code: 'unknown-swap' }, headers: {} },
      {
        status: 429,
        body: { message: 'Too many requests. Try again later.' },
        headers: { 'retry-after': '60' },
      },
      { status: 409, body: { address: 'bc1pwatched' }, headers: {} },
    ];
    vi.stubGlobal('fetch', () => {
      const reply = replies[Math.min(statuses.length, replies.length - 1)];
      if (!reply) return Promise.reject(new Error('no reply scripted'));
      statuses.push(reply.status);
      return Promise.resolve(
        new Response(JSON.stringify(reply.body), { status: reply.status, headers: reply.headers })
      );
    });
    const h = harness({ backend: createBackend('https://api.example') });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle(5_000);
    expect(statuses).toEqual([400, 429]);
    await settle(59_000);
    expect(statuses).toEqual([400, 429]);
    await settle(1_000);
    expect(statuses).toEqual([400, 429, 409]);
    expect(h.store.get().registration.shown).toEqual({ kind: 'registered' });
  });

  it('a 409 with the swap-limit code is not a registration', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'Too many swaps', code: 'swap-limit' }), {
          status: 409,
        })
      )
    );
    const h = harness({ backend: createBackend('https://api.example') });
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    expect(h.store.get().registration.shown).toEqual({
      kind: 'not-registered',
      problem: 'refused',
      message: 'Too many swaps',
    });
    expect(h.view().closable).toBe(false);
  });
});

describe('tracking: sending from the wallet', () => {
  async function awaitingPayment(script: Script = {}) {
    const h = harness(script);
    h.store.dispatch({ type: 'shown', first: undefined, registered: false });
    await settle();
    return h;
  }

  it('offers the wallet only while 1Click says the swap awaits payment', async () => {
    const h = await awaitingPayment({ polls: [snapshot('PROCESSING')] });
    expect(h.view()).toMatchObject({ payment: 'none', sendButton: null });
  });

  it('sends once, records it and moves focus to the result when the button kept it', async () => {
    const h = await awaitingPayment();
    h.store.dispatch({ type: 'send-requested', now: new Date(), ready: true, keepFocus: true });
    h.store.dispatch({ type: 'send-requested', now: new Date(), ready: true, keepFocus: true });
    expect(h.view().sendButton).toBe('sending');
    await settle();
    expect(h.calls.sends).toBe(1);
    expect(h.store.get().send.record).toMatchObject({ state: 'sent', tx: TX });
    expect(h.store.get().send.focus).toBe(1);
    expect(h.view().sendButton).toBeNull();
  });

  it('refuses to ask the wallet inside the five minutes before the quote deadline', async () => {
    const h = await awaitingPayment();
    expect(h.view(NEAR_DEADLINE)).toMatchObject({ expired: true, sendButton: null });
    h.store.dispatch({ type: 'send-requested', now: NEAR_DEADLINE, ready: true, keepFocus: false });
    await settle();
    expect(h.calls.sends).toBe(0);
    expect(h.store.get().send.error).toBe(QUOTE_EXPIRED_NOT_SENT);
  });

  it('says a rejection in the wallet sent nothing and clears the record', async () => {
    const h = await awaitingPayment({
      send: () => Promise.reject(Object.assign(new Error('User rejected'), { code: 4001 })),
    });
    h.store.dispatch({ type: 'send-requested', now: new Date(), ready: true, keepFocus: false });
    await settle();
    expect(h.store.get().send).toMatchObject({
      record: null,
      error: WALLET_REJECTED,
    });
  });

  it('releases the send lock once another tab has cleared the record', async () => {
    if (TARGET === null) throw new Error('expected an EVM target');
    const record = attemptingRecord({ target: TARGET, account: WALLET.address, now: new Date(0) });
    const h = await awaitingPayment({ record });
    await h.records.claim(TARGET);
    expect(h.lock.held.size).toBe(1);
    h.storage.map.delete(sendRecordKey(TARGET));
    h.store.dispatch({ type: 'record-changed', record: h.records.read(TARGET) });
    expect(h.lock.held.size).toBe(0);
  });

  it('a sent record is cleared only when the chain proves it reverted', async () => {
    if (TARGET === null) throw new Error('expected an EVM target');
    const attempt = attemptingRecord({ target: TARGET, account: WALLET.address, now: new Date(0) });
    const record = sentRecord(attempt, TX, 'wallet');
    const h = await awaitingPayment({
      polls: [snapshot('PENDING_DEPOSIT')],
      record,
      chain: ['pending', 'unknown', 'reverted'],
    });
    expect(h.store.get().send.record).toMatchObject({ state: 'sent' });
    await settle(15_000);
    expect(h.store.get().send.record).toMatchObject({ state: 'sent' });
    await settle(15_000);
    expect(h.store.get().send).toMatchObject({ record: null, info: LANDED_FAILED_MESSAGE });
    expect(h.records.read(TARGET)).toBeNull();
  });

  it('a chain check that fails says so and keeps the record', async () => {
    if (TARGET === null) throw new Error('expected an EVM target');
    const attempt = attemptingRecord({ target: TARGET, account: WALLET.address, now: new Date(0) });
    const h = await awaitingPayment({ record: sentRecord(attempt, TX, 'wallet'), wallet: null });
    expect(h.store.get().send.checkNote).toBe(
      `Could not check the transaction: ${NO_WALLET_TO_CHECK}. Retrying.`
    );
    expect(h.store.get().send.record).toMatchObject({ state: 'sent' });
  });

  it('"I checked my wallet" clears an attempting record once its prompt window has passed', async () => {
    if (TARGET === null) throw new Error('expected an EVM target');
    const record = attemptingRecord({ target: TARGET, account: WALLET.address, now: new Date() });
    const h = await awaitingPayment({ record });
    expect(h.store.get().send.prompt).not.toBeNull();
    const ticks = h.store.get().send.promptTicks;
    await settle(15 * 60_000 + 100);
    expect(h.store.get().send.promptTicks).toBe(ticks + 1);
    h.store.dispatch({ type: 'nothing-sent-confirmed', record });
    expect(h.store.get().send.record).toBeNull();
    expect(h.view().sendButton).toBe('offer');
  });

  it('a 1Click status past payment marks an attempting record as sent', async () => {
    if (TARGET === null) throw new Error('expected an EVM target');
    const record = attemptingRecord({ target: TARGET, account: WALLET.address, now: new Date(0) });
    const h = await awaitingPayment({ record, polls: [snapshot('PROCESSING')] });
    expect(h.store.get().send.record).toMatchObject({ state: 'sent', via: 'provider' });
  });
});

describe('tracking machine', () => {
  it('runs record writes, the send and registration bookkeeping even after the page left', () => {
    if (TARGET === null) throw new Error('expected an EVM target');
    const record = attemptingRecord({ target: TARGET, account: WALLET.address, now: new Date(0) });
    const durable: TrackingEffect[] = [
      { type: 'remember-registered', swapAddress: SWAP },
      { type: 'settle-record', target: TARGET, swap: 'PROCESSING' },
      { type: 'release-if-cleared', target: TARGET },
      { type: 'send', request: 1, target: TARGET, amount: '1' },
      { type: 'confirm-nothing', record },
    ];
    for (const effect of durable) expect(durableTrackingEffect(effect)).toBe(true);
    const dropped: TrackingEffect[] = [
      { type: 'check-progress', request: 1, receipt: RECEIPT, known: undefined },
      { type: 'wait', request: 1, delayMs: 1, due: { type: 'poll-due', request: 1 } },
      { type: 'register', request: 1, receipt: RECEIPT, swapAddress: SWAP },
      { type: 'chain-check', request: 1, target: TARGET },
      { type: 'watch-prompt', request: 1, record },
    ];
    for (const effect of dropped) expect(durableTrackingEffect(effect)).toBe(false);
  });

  it('waits on the running poll, registration and chain check only', () => {
    const state: TrackingState = {
      ...initialTracking({
        receipt: RECEIPT,
        record: null,
        storage: { durable: true, lockable: true },
        first: undefined,
      }),
      poll: { kind: 'running', request: 1 },
      registration: {
        shown: { kind: 'registering' },
        counts: { transient: 0, unknownSwap: 0 },
        loop: { kind: 'waiting', request: 2 },
      },
    };
    expect(pendingTracking(state)).toEqual([1]);
  });

  it('ignores a reply for a poll it no longer waits on', () => {
    const state = initialTracking({
      receipt: RECEIPT,
      record: null,
      storage: { durable: true, lockable: true },
      first: undefined,
    });
    const next = reduceTracking(state, {
      type: 'polled',
      request: 9,
      snapshot: snapshot('SUCCESS'),
    });
    expect(next.state).toBe(state);
  });
});
