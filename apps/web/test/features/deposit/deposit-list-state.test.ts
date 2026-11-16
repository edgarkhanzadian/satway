import { describe, expect, it } from 'vitest';

import { type PayoutObservation, deriveProgress } from '@satway/core';

import {
  CHECK_CONCURRENCY,
  type ListEffect,
  type ListState,
  NOT_A_RECEIPT,
  entryViews,
  initialList,
  isFinalSnapshot,
  listMachine,
  pendingList,
  reduceList,
} from '../../../src/features/deposit/deposit-list-state.js';
import {
  DEPOSIT_STAGES_KEY,
  loadStages,
  rememberStage,
} from '../../../src/features/deposit/deposit-stages.js';
import { createFlowStore } from '../../../src/shared/flow-store.js';
import { type Receipt, type Snapshot, receiptId } from '../../../src/shared/index.js';
import { RECEIPT } from './deposit-fixtures.js';

function receiptAt(n: number): Receipt {
  return { ...RECEIPT, createdAt: `2026-11-1${n}T12:00:00.000Z` };
}

const ENTRIES = [receiptAt(1), receiptAt(2), receiptAt(3), receiptAt(4)];
const IDS = ENTRIES.map(receiptId);
const [ID0 = '', ID1 = '', ID2 = '', ID3 = ''] = IDS;

function snapshot(swap: 'PROCESSING' | 'REFUNDED', payouts: PayoutObservation[] = []): Snapshot {
  return {
    progress: deriveProgress({ swap, payouts, tipHeight: 12, reclaimLockBlocks: 950 }),
    swap,
    payouts: [],
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
  };
}

function checks(effects: readonly ListEffect[]): string[] {
  return effects.flatMap(e => (e.type === 'check-entry' ? [e.id] : []));
}

function requestFor(state: ListState, id: string): number {
  const status = state.statuses[id];
  if (status?.kind !== 'checking') throw new Error(`${id} is not being checked`);
  return status.request;
}

describe('Your deposits: checking remembered entries', () => {
  it(`checks at most ${CHECK_CONCURRENCY} entries at a time, and the next one as each settles`, () => {
    const shown = reduceList(initialList(ENTRIES, {}), { type: 'shown' });
    expect(checks(shown.effects)).toEqual(IDS.slice(0, CHECK_CONCURRENCY));
    const first = reduceList(shown.state, {
      type: 'entry-checked',
      request: requestFor(shown.state, ID0),
      id: ID0,
      snapshot: snapshot('PROCESSING'),
    });
    expect(checks(first.effects)).toEqual([ID2]);
    expect(first.effects).toContainEqual({
      type: 'remember-stage',
      id: ID0,
      known: { stage: 'swapping', terminal: false, final: false, reclaimable: false },
    });
    const failed = reduceList(first.state, {
      type: 'entry-check-failed',
      request: requestFor(first.state, ID1),
      id: ID1,
      message: 'HTTP 503',
    });
    expect(checks(failed.effects)).toEqual([ID3]);
    expect(entryViews(failed.state).map(v => v.summary)).toEqual([
      'Swapping to BTC',
      'Could not check it right now: HTTP 503',
      'Checking…',
      'Checking…',
    ]);
  });

  it('starts once, even when shown twice', () => {
    const shown = reduceList(initialList(ENTRIES, {}), { type: 'shown' });
    const again = reduceList(shown.state, { type: 'shown' });
    expect(again.state).toBe(shown.state);
    expect(again.effects).toEqual([]);
  });

  it('does not check again an entry whose remembered stage is final, and offers no Follow for it', () => {
    const remembered = {
      [ID0]: { stage: 'done' as const, terminal: true, final: true, reclaimable: false },
      [ID1]: { stage: 'minting' as const, terminal: false, final: false, reclaimable: false },
    };
    const shown = reduceList(initialList(ENTRIES.slice(0, 2), remembered), { type: 'shown' });
    expect(checks(shown.effects)).toEqual([ID1]);
    const [done] = entryViews(shown.state);
    expect(done).toMatchObject({ summary: 'sBTC minted', follow: false, reclaim: false });
  });

  it('offers Reclaim for an entry whose last check found it reclaimable', () => {
    const remembered = {
      [ID0]: { stage: 'reclaimable' as const, terminal: true, final: true, reclaimable: true },
    };
    const [view] = entryViews(initialList(ENTRIES.slice(0, 1), remembered));
    expect(view).toMatchObject({ summary: 'Reclaimable now', reclaim: true, follow: false });
  });

  it('checks again a remembered rejected or reclaimable entry, as either can still change', () => {
    const remembered = {
      [ID0]: { stage: 'mint-failed' as const, terminal: true, final: false, reclaimable: false },
      [ID1]: { stage: 'reclaimable' as const, terminal: true, final: false, reclaimable: true },
    };
    const shown = reduceList(initialList(ENTRIES.slice(0, 2), remembered), { type: 'shown' });
    expect(checks(shown.effects)).toEqual([ID0, ID1]);
  });

  it('drops a remembered stage written before finality was recorded, so it is checked', () => {
    const legacy = { [ID0]: { stage: 'mint-failed', terminal: true, reclaimable: false } };
    const store = {
      getItem: () => JSON.stringify(legacy),
      setItem: () => undefined,
    };
    expect(loadStages(store)).toEqual({});
  });

  it('treats only minted, reclaimed, and refunded or failed with nothing at the address as final', () => {
    const paid = { txid: 'ab'.repeat(32), vout: 0, amountSats: 50_000, confirmed: true };
    const payout = { ...paid, blockHeight: 2 };
    const outputs = [{ ...payout, blockTime: null, spent: false }];
    function at(swap: 'SUCCESS' | 'REFUNDED', observed: PayoutObservation[]): Snapshot {
      return {
        ...snapshot('REFUNDED'),
        swap,
        progress: deriveProgress({
          swap,
          payouts: observed,
          tipHeight: 12,
          reclaimLockBlocks: 950,
        }),
        payouts: observed.length === 0 ? [] : outputs,
        outputs: observed.length === 0 ? [] : outputs,
      };
    }
    const rejected = at('SUCCESS', [{ payout, mint: 'failed' }]);
    expect(rejected.progress).toMatchObject({ stage: 'mint-failed', terminal: true });
    expect(isFinalSnapshot(rejected)).toBe(false);
    expect(isFinalSnapshot(at('SUCCESS', [{ payout, mint: 'confirmed' }]))).toBe(true);
    expect(
      isFinalSnapshot(at('SUCCESS', [{ payout, spent: true, spender: 'reclaim', mint: null }]))
    ).toBe(true);
    expect(isFinalSnapshot(at('REFUNDED', []))).toBe(true);
    expect(isFinalSnapshot(at('REFUNDED', [{ payout, mint: 'failed' }]))).toBe(false);
    expect(isFinalSnapshot(snapshot('PROCESSING'))).toBe(false);
  });

  it('Check again re-checks a settled entry, final or not', () => {
    const remembered = {
      [ID0]: { stage: 'done' as const, terminal: true, final: true, reclaimable: false },
    };
    const state = initialList(ENTRIES.slice(0, 1), remembered);
    expect(entryViews(state)[0]?.check).toBe(true);
    const again = reduceList(state, { type: 'check-requested', id: ID0 });
    expect(checks(again.effects)).toEqual([ID0]);
    expect(entryViews(again.state)[0]?.check).toBe(false);
    expect(reduceList(again.state, { type: 'check-requested', id: ID0 }).effects).toEqual([]);
  });

  it('ignores a reply for a check it no longer waits on', () => {
    const shown = reduceList(initialList(ENTRIES, {}), { type: 'shown' });
    const stale = reduceList(shown.state, {
      type: 'entry-checked',
      request: 999,
      id: ID0,
      snapshot: snapshot('REFUNDED'),
    });
    expect(stale.state).toBe(shown.state);
  });

  it('aborts every check in flight when the page leaves', async () => {
    const store = createFlowStore(listMachine, initialList(ENTRIES, {}), () => undefined);
    store.dispatch({ type: 'shown' });
    const signals = pendingList(store.get()).map(request => store.signal(request));
    expect(signals).toHaveLength(CHECK_CONCURRENCY);
    store.detach();
    await Promise.resolve();
    expect(signals.every(s => s.aborted)).toBe(true);
  });

  it('keeps writing a remembered stage after the page left', () => {
    expect(
      listMachine.durable?.({
        type: 'remember-stage',
        id: 'x',
        known: { stage: 'done', terminal: true, final: true, reclaimable: false },
      })
    ).toBe(true);
  });
});

describe('Your deposits: opening a receipt', () => {
  it('opens a remembered entry, checks it and remembers what it found', () => {
    const opened = reduceList(initialList(ENTRIES, {}), {
      type: 'details-opened',
      id: ID3,
      reclaim: true,
    });
    const effect = opened.effects[0];
    if (effect?.type !== 'check-receipt') throw new Error('expected a receipt check');
    const checked = reduceList(opened.state, {
      type: 'receipt-checked',
      request: effect.request,
      snapshot: snapshot('REFUNDED'),
    });
    expect(checked.state.opened).toMatchObject({ kind: 'receipt', source: 'saved', reclaim: true });
    expect(checked.effects).toEqual([
      {
        type: 'remember-stage',
        id: ID3,
        known: { stage: 'refunded', terminal: true, final: true, reclaimable: false },
      },
    ]);
  });

  it('refuses a file that is not JSON, and a receipt that does not add up', () => {
    const chosen = reduceList(initialList([], {}), { type: 'file-chosen', file: new Blob([]) });
    const read = chosen.effects[0];
    if (read?.type !== 'read-file') throw new Error('expected a file read');
    expect(
      reduceList(chosen.state, { type: 'file-read', request: read.request, text: '{"version"' })
        .state.error
    ).toBe(NOT_A_RECEIPT);
    const moved = JSON.stringify({ ...RECEIPT, depositAddress: 'bc1pother' });
    const refused = reduceList(chosen.state, {
      type: 'file-read',
      request: read.request,
      text: moved,
    });
    expect(refused.state.error).toBe(
      'Receipt does not add up: its address does not match its parameters'
    );
    expect(refused.effects).toEqual([]);
  });

  it('points a withdrawal receipt to the Withdraw tab', () => {
    const chosen = reduceList(initialList([], {}), { type: 'file-chosen', file: new Blob([]) });
    const read = chosen.effects[0];
    if (read?.type !== 'read-file') throw new Error('expected a file read');
    const withdrawal = JSON.stringify({ kind: 'satway-withdrawal', version: 1 });
    expect(
      reduceList(chosen.state, { type: 'file-read', request: read.request, text: withdrawal }).state
        .error
    ).toMatch(/Load it on the Withdraw tab/);
  });

  it('a check that fails closes the receipt and says why', () => {
    const opened = reduceList(initialList(ENTRIES, {}), {
      type: 'details-opened',
      id: ID0,
      reclaim: false,
    });
    const effect = opened.effects[0];
    if (effect?.type !== 'check-receipt') throw new Error('expected a receipt check');
    const failed = reduceList(opened.state, {
      type: 'receipt-check-failed',
      request: effect.request,
      message: 'offline',
    });
    expect(failed.state).toMatchObject({ opened: { kind: 'none' }, error: 'offline' });
  });
});

describe('remembered stages', () => {
  function memory() {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      setItem(key: string, value: string) {
        map.set(key, value);
      },
    };
  }

  it('round-trips and skips anything unreadable', () => {
    const store = memory();
    rememberStage('a', { stage: 'done', terminal: true, final: true, reclaimable: false }, store);
    store.map.set(
      DEPOSIT_STAGES_KEY,
      JSON.stringify({ ...JSON.parse(store.map.get(DEPOSIT_STAGES_KEY) ?? '{}'), b: { x: 1 } })
    );
    expect(loadStages(store)).toEqual({
      a: { stage: 'done', terminal: true, final: true, reclaimable: false },
    });
    store.map.set(DEPOSIT_STAGES_KEY, 'not json');
    expect(loadStages(store)).toEqual({});
  });
});
