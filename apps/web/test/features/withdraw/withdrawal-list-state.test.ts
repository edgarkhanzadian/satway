import { describe, expect, it } from 'vitest';

import {
  type ListEffect,
  type ListEvent,
  type ListState,
  NEVER_SENT,
  NOT_A_RECEIPT,
  entryLabel,
  entryStatusView,
  initialList,
  receiptToFollow,
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

function reading(state: ListState): number {
  if (state.file.kind !== 'reading') throw new Error(`Expected reading, got ${state.file.kind}`);
  return state.file.request;
}

describe('the remembered withdrawals', () => {
  it('checks each sent one once when opened, and says a draft was never confirmed as sent', () => {
    const opened = run(initialList([SENT, DRAFT]), { type: 'opened' }, { type: 'opened' });
    expect(opened.effects).toEqual([{ type: 'check', receipt: SENT, stacksTxid: STACKS_TXID }]);
    expect(entryStatusView(opened.state.statuses[DRAFT.depositAddress])).toEqual({
      message: NEVER_SENT,
      warning: true,
    });
    expect(entryStatusView(opened.state.statuses[SENT.depositAddress]).message).toBe('Checking…');
  });

  it('shows the result of the check, or why it failed', () => {
    const progress = observationOf({ stacks: STACKS.requested }).progress;
    const checked = run(
      initialList([SENT]),
      { type: 'opened' },
      {
        type: 'checked',
        id: SENT.depositAddress,
        progress,
      }
    );
    expect(entryStatusView(checked.state.statuses[SENT.depositAddress])).toEqual({
      message: progress.message,
      warning: progress.warning,
    });
    const late = run(checked.state, {
      type: 'check-failed',
      id: SENT.depositAddress,
      message: 'x',
    });
    expect(late.state).toBe(checked.state);
    const failed = run(initialList([SENT]), {
      type: 'check-failed',
      id: SENT.depositAddress,
      message: 'offline',
    });
    expect(entryStatusView(failed.state.statuses[SENT.depositAddress]).message).toBe(
      'Could not check it right now: offline'
    );
  });

  it('labels an entry by amount, destination and start, and flags a draft', () => {
    expect(entryLabel(SENT)).toMatch(/^10,000 sats to USDC on base, started /);
    expect(entryLabel(DRAFT)).toMatch(/, not confirmed as sent$/);
  });
});

describe('loading a receipt file', () => {
  const FILE = new Blob(['{}']);

  function chosen() {
    return run(initialList([]), { type: 'file-chosen', file: FILE });
  }

  it('reads the chosen file and follows a receipt that checks out', () => {
    const asked = chosen();
    expect(asked.effects).toEqual([{ type: 'read', request: reading(asked.state), file: FILE }]);
    const loaded = run(asked.state, {
      type: 'file-read',
      request: reading(asked.state),
      text: JSON.stringify(SENT),
    });
    expect(loaded.effects).toEqual([{ type: 'follow', receipt: SENT }]);
    expect(loaded.state.file).toEqual({ kind: 'idle' });
  });

  it('refuses a file that is not JSON or not a withdrawal receipt', () => {
    for (const text of [null, 'not json']) {
      const asked = chosen();
      const result = run(asked.state, { type: 'file-read', request: reading(asked.state), text });
      expect(result.state.file).toEqual({ kind: 'failed', message: NOT_A_RECEIPT });
      expect(result.effects).toEqual([]);
    }
    const asked = chosen();
    const deposit = run(asked.state, {
      type: 'file-read',
      request: reading(asked.state),
      text: JSON.stringify({ kind: 'satway-deposit' }),
    });
    expect(deposit.state.file).toEqual({
      kind: 'failed',
      message: 'This is not a withdrawal receipt. Deposit receipts are loaded on the Recover tab.',
    });
  });

  it('ignores a file read that a newer choice superseded', () => {
    const first = chosen();
    const old = reading(first.state);
    const second = run(first.state, { type: 'file-chosen', file: new Blob(['{}']) });
    const late = run(second.state, { type: 'file-read', request: old, text: JSON.stringify(SENT) });
    expect(late.state).toBe(second.state);
    expect(late.effects).toEqual([]);
  });
});

describe('receiptToFollow', () => {
  it('never trades a remembered sent withdrawal for an older draft file', () => {
    const draftFile = { ...SENT, stacksTxid: null };
    expect(receiptToFollow(draftFile, SENT)).toBe(SENT);
  });

  it('follows the loaded file otherwise', () => {
    expect(receiptToFollow(SENT, null)).toBe(SENT);
    expect(receiptToFollow(SENT, DRAFT)).toBe(SENT);
    const other = receiptFixture({ stacksTxid: 'e'.repeat(64) });
    expect(receiptToFollow(other, SENT)).toBe(other);
  });
});
