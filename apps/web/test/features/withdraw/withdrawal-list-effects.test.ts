import { describe, expect, it } from 'vitest';

import type { PastedWithdrawalCheck, WithdrawalProgress } from '@satway/core';

import { type ListIo, listRunner } from '../../../src/features/withdraw/withdrawal-list-effects.js';
import {
  MAX_CHECKS,
  initialList,
  listMachine,
} from '../../../src/features/withdraw/withdrawal-list-state.js';
import { createFlowStore } from '../../../src/shared/flow-store.js';
import type { WithdrawalReceiptFile } from '../../../src/shared/index.js';
import { STACKS, observationOf, receiptFixture } from '../../shared/withdrawal-fixtures.js';

const PROGRESS = observationOf({ stacks: STACKS.requested }).progress;

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

function harness(entries: readonly WithdrawalReceiptFile[]) {
  const checks: {
    id: string;
    signal: AbortSignal;
    answer: ReturnType<typeof deferred<WithdrawalProgress>>;
  }[] = [];
  const followed: WithdrawalReceiptFile[] = [];
  const remembered: string[] = [];
  const io: ListIo = {
    check(receipt, _txid, signal) {
      const answer = deferred<WithdrawalProgress>();
      checks.push({ id: receipt.depositAddress, signal, answer });
      return answer.promise;
    },
    checkTxid: () => deferred<PastedWithdrawalCheck>().promise,
    read: file => file.text(),
    stored: () => null,
    rememberStatus: id => remembered.push(id),
    remove: () => undefined,
    follow: receipt => followed.push(receipt),
  };
  let run: ReturnType<typeof listRunner> | null = null;
  const store = createFlowStore(listMachine, initialList(entries), effect => run?.(effect));
  run = listRunner(io, store);
  store.attach();
  return { store, checks, followed, remembered };
}

function many(count: number) {
  return Array.from({ length: count }, (_, i) =>
    receiptFixture({ depositAddress: `addr-${i}`, stacksTxid: String(i).padStart(64, '0') })
  );
}

describe('the list effects, run against the store', () => {
  it('runs at most two checks at a time and starts the next as one finishes', async () => {
    const { store, checks, remembered } = harness(many(5));
    store.dispatch({ type: 'opened' });
    expect(checks.map(c => c.id)).toEqual(['addr-0', 'addr-1']);
    expect(checks).toHaveLength(MAX_CHECKS);
    checks[0]?.answer.resolve(PROGRESS);
    await settled();
    expect(checks.map(c => c.id)).toEqual(['addr-0', 'addr-1', 'addr-2']);
    expect(remembered).toEqual(['addr-0']);
  });

  it('aborts the checks in flight when the list unmounts, but not on a StrictMode remount', async () => {
    const { store, checks } = harness(many(2));
    store.dispatch({ type: 'opened' });
    store.detach();
    store.attach();
    await settled();
    expect(checks.map(c => c.signal.aborted)).toEqual([false, false]);
    store.detach();
    await settled();
    expect(checks.map(c => c.signal.aborted)).toEqual([true, true]);
  });

  it('mounting the list again does not re-check an entry it already checked this time', () => {
    const { store, checks } = harness(many(1));
    store.dispatch({ type: 'opened' });
    store.dispatch({ type: 'opened' });
    expect(checks).toHaveLength(1);
  });

  it('follows a loaded draft receipt file once it is read and resolved', async () => {
    const { store, followed } = harness([]);
    const draft = { ...receiptFixture(), stacksTxid: null };
    store.dispatch({ type: 'file-chosen', file: new Blob([JSON.stringify(draft)]) });
    await settled();
    expect(followed).toEqual([draft]);
  });
});
