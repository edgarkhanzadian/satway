import { describe, expect, it } from 'vitest';

import type { Progress, ProgressCondition } from '@satway/core';

import {
  entryViews,
  initialList,
  knownStageOf,
} from '../../../src/features/deposit/deposit-list-state.js';
import { conditionNote } from '../../../src/features/deposit/tracking-view.js';
import { type Snapshot, receiptId } from '../../../src/shared/index.js';
import { RECEIPT } from './deposit-fixtures.js';

const SWAP = RECEIPT.quoteResponse.quote.depositAddress ?? '';
const FOREIGN = 'cc'.repeat(32);
const SMALL = {
  txid: 'dd'.repeat(32),
  vout: 0,
  amountSats: 4_000,
  confirmed: true,
  blockHeight: 10,
  blockTime: null,
  spent: false,
};

function progress(
  stage: Progress['stage'],
  terminal: boolean,
  condition?: ProgressCondition
): Progress {
  return {
    stage,
    terminal,
    message: 'core message',
    needsNotification: false,
    blocksUntilReclaim: null,
    ...(condition ? { condition } : {}),
  };
}

function snapshot(p: Progress, extra: Partial<Snapshot> = {}): Snapshot {
  return {
    progress: p,
    swap: 'SUCCESS',
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
    ...extra,
  };
}

describe('the tracking view names a stuck deposit’s condition', () => {
  it('has no note without a condition', () => {
    expect(conditionNote(snapshot(progress('minting', false)), RECEIPT)).toBeNull();
  });

  it('waits for 1Click to name the payout, and keeps checking', () => {
    const note = conditionNote(
      snapshot(progress('awaiting-payout', false, 'awaiting-payout-hash')),
      RECEIPT
    );
    expect(note).toEqual({
      tone: 'status',
      title: 'Waiting for 1Click to name the payout',
      text: 'The swap is complete, but 1Click has not said which Bitcoin transaction paid your deposit address. This page keeps checking.',
    });
  });

  it('says a payout below the minimum cannot be minted, with the amount and the minimum', () => {
    const note = conditionNote(
      snapshot(progress('mint-failed', true, 'payout-below-minimum'), {
        belowMinimum: [SMALL],
        perDepositMinimum: 10_000,
      }),
      RECEIPT
    );
    expect(note).toEqual({
      tone: 'warn',
      title: 'This payout cannot be minted',
      text: '4,000 sats arrived, below the sBTC minimum of 10,000 sats, so the signers will not mint it. You can reclaim it after the timelock, under “Your deposits” on the Deposit tab.',
    });
  });

  it('warns about a payout this page cannot find, with its hash and what to do', () => {
    const note = conditionNote(
      snapshot(progress('awaiting-payout', true, 'payout-not-found'), {
        foreignTxids: [FOREIGN],
      }),
      RECEIPT
    );
    expect(note).toEqual({
      tone: 'warn',
      title: '1Click reports a payout this page cannot find at your address',
      text: `1Click says it paid you in transaction ${FOREIGN}, which does not pay your deposit address or is not on the Bitcoin network. Do not rely on it: check the transaction in a block explorer and contact 1Click with your swap deposit address ${SWAP}.`,
    });
  });
});

describe('Your deposits names a stuck deposit’s condition', () => {
  function summaryFor(p: Progress): string | undefined {
    const known = knownStageOf(snapshot(p), RECEIPT);
    const state = initialList([RECEIPT], { [receiptId(RECEIPT)]: known }, 0);
    return entryViews(state)[0]?.summary;
  }

  it('labels each condition, and never caches a below-minimum payout before the timelock as final', () => {
    expect(summaryFor(progress('awaiting-payout', false, 'awaiting-payout-hash'))).toBe(
      'Checking…'
    );
    const below = knownStageOf(
      snapshot(progress('mint-failed', true, 'payout-below-minimum'), { belowMinimum: [SMALL] }),
      RECEIPT
    );
    expect(below).toMatchObject({ condition: 'payout-below-minimum', final: false });
    const notFound = knownStageOf(
      snapshot(progress('awaiting-payout', true, 'payout-not-found')),
      RECEIPT
    );
    expect(notFound).toMatchObject({ condition: 'payout-not-found', final: false });
    const views = entryViews({
      ...initialList([RECEIPT], {}, 0),
      statuses: { [receiptId(RECEIPT)]: { kind: 'known', known: below } },
    });
    expect(views[0]?.summary).toBe('Too small to mint; reclaim after the timelock');
    const found = entryViews({
      ...initialList([RECEIPT], {}, 0),
      statuses: { [receiptId(RECEIPT)]: { kind: 'known', known: notFound } },
    });
    expect(found[0]?.summary).toBe('1Click names a payout not found at your address');
    const hash = knownStageOf(
      snapshot(progress('awaiting-payout', false, 'awaiting-payout-hash')),
      RECEIPT
    );
    const waiting = entryViews({
      ...initialList([RECEIPT], {}, 0),
      statuses: { [receiptId(RECEIPT)]: { kind: 'known', known: hash } },
    });
    expect(waiting[0]?.summary).toBe('Waiting for 1Click to name the payout');
  });
});
