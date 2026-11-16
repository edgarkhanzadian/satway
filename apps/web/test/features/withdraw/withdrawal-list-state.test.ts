import { describe, expect, it } from 'vitest';

import type { KnownStatus } from '../../../src/features/withdraw/entry-statuses.js';
import {
  AUTO_CHECKED,
  type ListEffect,
  type ListEvent,
  type ListState,
  MAX_CHECKS,
  NEVER_SENT,
  NOT_A_RECEIPT,
  entryLabel,
  entryStatusView,
  fileDecision,
  initialList,
  pendingListRequests,
  reduceList,
} from '../../../src/features/withdraw/withdrawal-list-state.js';
import {
  STACKS,
  STACKS_TXID,
  observationOf,
  receiptFixture,
} from '../../shared/withdrawal-fixtures.js';

const SENT = receiptFixture();
const DRAFT = receiptFixture({
  stacksTxid: null,
  depositAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
});
const OTHER_TXID = 'b'.repeat(64);
const DONE: KnownStatus = { stage: 'done', message: 'Delivered.', warning: false };
const WAITING: KnownStatus = { stage: 'awaiting-signers', message: 'Waiting.', warning: false };

function many(count: number) {
  return Array.from({ length: count }, (_, i) =>
    receiptFixture({ depositAddress: `addr-${i}`, stacksTxid: String(i).padStart(64, '0') })
  );
}

function run(state: ListState, ...events: ListEvent[]) {
  let current = state;
  const effects: ListEffect[] = [];
  for (const event of events) {
    const next = reduceList(current, event);
    current = next.state;
    effects.push(...next.effects);
  }
  return { state: current, effects };
}

function checks(effects: readonly ListEffect[]) {
  return effects.flatMap(e => (e.type === 'check' ? [e] : []));
}

function fileRequest(state: ListState): number {
  const file = state.file;
  if (file.kind === 'idle' || file.kind === 'failed')
    throw new Error(`No file request: ${file.kind}`);
  return file.request;
}

describe('the remembered withdrawals', () => {
  it('checks only the newest few automatically, at most two at a time, once when opened', () => {
    const entries = many(6);
    const opened = run(initialList(entries), { type: 'opened' }, { type: 'opened' });
    const started = checks(opened.effects);
    expect(started.map(e => e.receipt.depositAddress)).toEqual(['addr-0', 'addr-1']);
    expect(started).toHaveLength(MAX_CHECKS);
    expect(pendingListRequests(opened.state)).toEqual(started.map(e => e.request));
    const progress = observationOf({ stacks: STACKS.requested }).progress;
    const first = started[0];
    if (!first) throw new Error('no check');
    const next = run(opened.state, {
      type: 'checked',
      request: first.request,
      id: 'addr-0',
      progress,
    });
    expect(checks(next.effects).map(e => e.receipt.depositAddress)).toEqual([
      `addr-${AUTO_CHECKED - 1}`,
    ]);
    expect(next.effects[0]).toEqual({
      type: 'remember-status',
      receipt: entries[0],
      status: { stage: progress.stage, message: progress.message, warning: progress.warning },
    });
    expect(entryStatusView(next.state.statuses['addr-5'])).toMatchObject({
      message: 'Not checked yet.',
      checkable: true,
    });
  });

  it('never checks a withdrawal whose last known stage is final, nor a draft', () => {
    const opened = run(initialList([SENT, DRAFT], { [SENT.depositAddress]: DONE }), {
      type: 'opened',
    });
    expect(checks(opened.effects)).toEqual([]);
    expect(entryStatusView(opened.state.statuses[SENT.depositAddress])).toMatchObject({
      message: 'Delivered.',
      final: true,
    });
    expect(entryStatusView(opened.state.statuses[DRAFT.depositAddress])).toMatchObject({
      message: NEVER_SENT,
      warning: true,
    });
  });

  it('checks an older one on request, showing what was last seen until then', () => {
    const entries = many(4);
    const state = initialList(entries, { 'addr-3': WAITING });
    expect(entryStatusView(state.statuses['addr-3']).message).toBe('Last seen: Waiting.');
    const asked = run(state, { type: 'opened' }, { type: 'check-requested', id: 'addr-3' });
    expect(checks(asked.effects)).toHaveLength(MAX_CHECKS);
    expect(asked.state.statuses['addr-3']).toMatchObject({ kind: 'queued' });
  });

  it('ignores a check answer for a request it is not waiting on', () => {
    const opened = run(initialList([SENT]), { type: 'opened' });
    const late = run(opened.state, {
      type: 'check-failed',
      request: 99,
      id: SENT.depositAddress,
      message: 'x',
    });
    expect(late.state).toBe(opened.state);
  });

  it('a failed check says why and can be retried', () => {
    const opened = run(initialList([SENT]), { type: 'opened' });
    const request = checks(opened.effects)[0]?.request ?? -1;
    const failed = run(opened.state, {
      type: 'check-failed',
      request,
      id: SENT.depositAddress,
      message: 'offline',
    });
    expect(entryStatusView(failed.state.statuses[SENT.depositAddress])).toMatchObject({
      message: 'Could not check it right now: offline',
      checkable: true,
    });
    const retried = run(failed.state, { type: 'check-requested', id: SENT.depositAddress });
    expect(checks(retried.effects)).toHaveLength(1);
  });

  it('labels an entry by amount, destination and start, and flags a draft', () => {
    expect(entryLabel(SENT)).toMatch(/^10,000 sats to USDC on base, started /);
    expect(entryLabel(DRAFT)).toMatch(/, not confirmed as sent$/);
  });
});

describe('removing a withdrawal from the list', () => {
  it('removes a finished one after one confirmation', () => {
    const state = initialList([SENT], { [SENT.depositAddress]: DONE });
    const asked = run(state, { type: 'remove-requested', id: SENT.depositAddress });
    expect(asked.state.removal).toEqual({ id: SENT.depositAddress, stage: 'confirm' });
    const removed = run(asked.state, { type: 'remove-confirmed', id: SENT.depositAddress });
    expect(removed.state.entries).toEqual([]);
    expect(removed.effects).toEqual([
      { type: 'remove', receipt: SENT },
      { type: 'remember-status', receipt: SENT, status: null },
    ]);
  });

  it('asks twice before removing one that may not be finished', () => {
    for (const state of [initialList([SENT]), initialList([DRAFT])]) {
      const id = state.entries[0]?.depositAddress ?? '';
      const once = run(state, { type: 'remove-requested', id }, { type: 'remove-confirmed', id });
      expect(once.state.removal).toEqual({ id, stage: 'confirm-again' });
      expect(once.effects.filter(e => e.type === 'remove')).toEqual([]);
      const twice = run(once.state, { type: 'remove-confirmed', id });
      expect(twice.state.entries).toEqual([]);
    }
  });

  it('keeps it when the user changes their mind', () => {
    const state = initialList([SENT]);
    const kept = run(
      state,
      { type: 'remove-requested', id: SENT.depositAddress },
      { type: 'remove-cancelled' },
      { type: 'remove-confirmed', id: SENT.depositAddress }
    );
    expect(kept.state.entries).toEqual([SENT]);
    expect(kept.effects).toEqual([]);
  });
});

describe('loading a receipt file', () => {
  const FILE = new Blob(['{}']);

  function chosen() {
    return run(initialList([]), { type: 'file-chosen', file: FILE });
  }

  function read(text: string | null) {
    const asked = chosen();
    return run(asked.state, { type: 'file-read', request: fileRequest(asked.state), text });
  }

  it('reads the file, looks up the stored copy, and follows a draft receipt directly', () => {
    const asked = chosen();
    expect(asked.effects).toEqual([
      { type: 'read', request: fileRequest(asked.state), file: FILE },
    ]);
    const draftFile = { ...SENT, stacksTxid: null };
    const loaded = read(JSON.stringify(draftFile));
    expect(loaded.effects).toEqual([
      { type: 'resolve', request: fileRequest(loaded.state), receipt: draftFile },
    ]);
    const resolved = run(loaded.state, {
      type: 'file-resolved',
      request: fileRequest(loaded.state),
      stored: null,
    });
    expect(resolved.effects).toEqual([{ type: 'follow', receipt: draftFile }]);
  });

  it('verifies a file’s txid like a pasted one before it is saved', () => {
    const loaded = read(JSON.stringify(SENT));
    const request = fileRequest(loaded.state);
    const verifying = run(loaded.state, { type: 'file-resolved', request, stored: null });
    expect(verifying.effects).toEqual([
      { type: 'check-txid', request, receipt: SENT, txid: STACKS_TXID },
    ]);
    expect(pendingListRequests(verifying.state)).toEqual([request]);

    const matched = run(verifying.state, {
      type: 'file-txid-checked',
      request,
      check: { kind: 'matches', stacksTxid: STACKS_TXID },
    });
    expect(matched.effects).toEqual([{ type: 'follow', receipt: SENT }]);

    const unknown = run(verifying.state, {
      type: 'file-txid-checked',
      request,
      check: { kind: 'not-found' },
    });
    expect(unknown.effects).toEqual([]);
    expect(unknown.state.file).toEqual({
      kind: 'failed',
      message: `Stacks does not know this receipt’s transaction 0x${STACKS_TXID} yet, so it was not saved. If it was sent just now, load the file again in a minute.`,
    });

    const other = run(verifying.state, {
      type: 'file-txid-checked',
      request,
      check: { kind: 'different', message: 'It is another call.' },
    });
    expect(other.effects).toEqual([]);
    expect(other.state.file).toMatchObject({
      message:
        'The receipt’s Stacks transaction is not this withdrawal. It is another call. The file was not saved.',
    });

    const failed = run(verifying.state, {
      type: 'file-txid-check-failed',
      request,
      message: 'offline',
    });
    expect(failed.state.file).toMatchObject({
      message: 'Could not check the receipt’s Stacks transaction: offline. Try again.',
    });
  });

  it('refuses a file that is not JSON, not a withdrawal receipt, or whose decimals disagree', () => {
    for (const text of [null, 'not json']) {
      expect(read(text).state.file).toEqual({ kind: 'failed', message: NOT_A_RECEIPT });
    }
    expect(read(JSON.stringify({ kind: 'satway-deposit' })).state.file).toEqual({
      kind: 'failed',
      message: 'This is not a withdrawal receipt. Deposit receipts are loaded on the Deposit tab.',
    });
    const wrongDecimals = { ...SENT, destination: { ...SENT.destination, decimals: 18 } };
    expect(read(JSON.stringify(wrongDecimals)).state.file).toEqual({
      kind: 'failed',
      message: 'Receipt does not add up: its destination decimals do not match the quote',
    });
  });

  it('ignores a file read that a newer choice superseded', () => {
    const first = chosen();
    const old = fileRequest(first.state);
    const second = run(first.state, { type: 'file-chosen', file: FILE });
    const late = run(second.state, { type: 'file-read', request: old, text: JSON.stringify(SENT) });
    expect(late.state).toBe(second.state);
    expect(late.effects).toEqual([]);
  });
});

describe('fileDecision', () => {
  it('never trades a stored sent withdrawal for a draft file or a file naming another txid', () => {
    const draftFile = { ...SENT, stacksTxid: null };
    expect(fileDecision(draftFile, SENT)).toEqual({ kind: 'follow', receipt: SENT });
    expect(fileDecision(SENT, SENT)).toEqual({ kind: 'follow', receipt: SENT });
    const replaced = receiptFixture({ stacksTxid: OTHER_TXID });
    expect(fileDecision(SENT, replaced)).toEqual({
      kind: 'kept',
      message: `This browser already has this withdrawal with Stacks transaction 0x${OTHER_TXID}. The file names 0x${STACKS_TXID}, so the browser’s copy was kept. Follow it from the list above.`,
    });
  });

  it('verifies a file txid when the browser holds only a draft or nothing', () => {
    expect(fileDecision(SENT, null)).toEqual({ kind: 'verify', txid: STACKS_TXID });
    expect(fileDecision(SENT, { ...SENT, stacksTxid: null })).toEqual({
      kind: 'verify',
      txid: STACKS_TXID,
    });
    expect(fileDecision(DRAFT, null)).toEqual({ kind: 'follow', receipt: DRAFT });
  });
});
