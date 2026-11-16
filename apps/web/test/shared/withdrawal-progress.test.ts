import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type OneClickStatusResponse,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as W,
  type WithdrawalStage,
} from '@satway/core';

import {
  type MilestoneStatus,
  checkWithdrawal,
  withdrawalAdvice,
  withdrawalHeading,
  withdrawalMilestones,
} from '../../src/shared/withdrawal-progress.js';
import {
  STACKS,
  STACKS_TXID,
  observationOf,
  payoutOf,
  receiptFixture,
} from './withdrawal-fixtures.js';

function statuses(o: ReturnType<typeof observationOf>): MilestoneStatus[] {
  return withdrawalMilestones(o).map(m => m.status);
}

describe('withdrawalMilestones', () => {
  it('walks through the six steps of a withdrawal that works', () => {
    expect(statuses(observationOf({ stacks: STACKS.unknown }))).toEqual([
      'done',
      'current',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(statuses(observationOf({ stacks: STACKS.pending }))).toEqual([
      'done',
      'current',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(statuses(observationOf({ stacks: STACKS.requested }))).toEqual([
      'done',
      'done',
      'current',
      'pending',
      'pending',
      'pending',
    ]);
    expect(
      statuses(observationOf({ stacks: STACKS.accepted, payout: payoutOf({ confirmed: false }) }))
    ).toEqual(['done', 'done', 'done', 'current', 'pending', 'pending']);
    expect(
      statuses(
        observationOf({ stacks: STACKS.accepted, payout: payoutOf(), swap: 'PENDING_DEPOSIT' })
      )
    ).toEqual(['done', 'done', 'done', 'done', 'current', 'pending']);
    expect(
      statuses(observationOf({ stacks: STACKS.accepted, payout: payoutOf(), swap: 'PROCESSING' }))
    ).toEqual(['done', 'done', 'done', 'done', 'current', 'pending']);
    expect(
      statuses(observationOf({ stacks: STACKS.accepted, payout: payoutOf(), swap: 'SUCCESS' }))
    ).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
  });

  it('labels the steps in order', () => {
    expect(
      withdrawalMilestones(observationOf({ stacks: STACKS.unknown })).map(m => m.label)
    ).toEqual([
      'Request submitted',
      'Stacks transaction confirmed',
      'Accepted by the sBTC signers',
      'BTC paid to the swap address',
      'Swapped by NEAR Intents',
      'Delivered to your address',
    ]);
  });

  it('counts the payout as paid when the swap has seen it before Bitcoin confirms it', () => {
    expect(
      statuses(
        observationOf({
          stacks: STACKS.accepted,
          payout: payoutOf({ confirmed: false }),
          swap: 'KNOWN_DEPOSIT_TX',
        })
      )
    ).toEqual(['done', 'done', 'done', 'done', 'current', 'pending']);
  });

  it('marks where each failure stopped the withdrawal', () => {
    expect(statuses(observationOf({ stacks: STACKS.failed }))).toEqual([
      'done',
      'failed',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(statuses(observationOf({ stacks: STACKS.rejected }))).toEqual([
      'done',
      'done',
      'failed',
      'pending',
      'pending',
      'pending',
    ]);
    expect(
      statuses(observationOf({ stacks: STACKS.accepted, payout: payoutOf(), swap: 'REFUNDED' }))
    ).toEqual(['done', 'done', 'done', 'done', 'failed', 'pending']);
    expect(
      statuses(observationOf({ stacks: STACKS.accepted, payout: payoutOf(), swap: 'FAILED' }))
    ).toEqual(['done', 'done', 'done', 'done', 'failed', 'pending']);
    expect(
      statuses(
        observationOf({
          stacks: STACKS.accepted,
          payout: payoutOf({ ok: false, problems: ['wrong-value'] }),
        })
      )
    ).toEqual(['done', 'done', 'done', 'failed', 'pending', 'pending']);
    expect(statuses(observationOf({ stacks: STACKS.mismatch }))).toEqual([
      'done',
      'done',
      'failed',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('never shows delivered unless the core says done, even when the swap reports success', () => {
    const o = observationOf({
      stacks: STACKS.accepted,
      payout: payoutOf(),
      swap: 'SUCCESS',
      mismatches: ['The swap provider reports a different quote.'],
    });
    expect(o.progress.stage).toBe('mismatch');
    expect(statuses(o)).toEqual(['done', 'done', 'done', 'done', 'failed', 'pending']);
  });

  it('marks the first open step failed on a mismatch found before any step failed', () => {
    const o = observationOf({ stacks: STACKS.requested, mismatches: ['Saved data is wrong.'] });
    expect(o.progress.stage).toBe('mismatch');
    expect(statuses(o)).toEqual(['done', 'done', 'failed', 'pending', 'pending', 'pending']);
  });
});

const STAGES: WithdrawalStage[] = [
  'awaiting-stacks-tx',
  'request-failed',
  'awaiting-signers',
  'rejected',
  'payout-broadcast',
  'payout-confirmed',
  'swapping',
  'done',
  'refunded',
  'swap-failed',
  'needs-support',
  'deadline-passed',
  'mismatch',
];

describe('withdrawalHeading and withdrawalAdvice', () => {
  it('says complete only when done', () => {
    expect(withdrawalHeading('done')).toBe('Withdrawal complete');
    for (const stage of STAGES.filter(s => s !== 'done')) {
      expect(withdrawalHeading(stage)).not.toMatch(/complete/);
    }
    expect(withdrawalHeading(null)).toBe('Withdrawal in progress');
  });

  it.each(STAGES)('tells the user what they can do at %s', stage => {
    const advice = withdrawalAdvice(stage, receiptFixture());
    expect(advice.length).toBeGreaterThan(20);
  });

  it('names the refund address, the swap address and the chain where they matter', () => {
    const r = receiptFixture();
    expect(withdrawalAdvice('refunded', r)).toContain(r.refundTo);
    expect(withdrawalAdvice('deadline-passed', r)).toContain(r.refundTo);
    expect(withdrawalAdvice('swap-failed', r)).toContain(r.depositAddress);
    expect(withdrawalAdvice('mismatch', r)).toContain(r.depositAddress);
    expect(withdrawalAdvice('done', r)).toContain('base');
    expect(withdrawalAdvice('rejected', r)).toMatch(/back in your Stacks wallet/);
  });
});

describe('checkWithdrawal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('observes the Stacks transaction and notes a swap status it could not read', async () => {
    const urls: string[] = [];
    function fetchFn(url: string): Promise<Response> {
      urls.push(url);
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    const backend = {
      status(): Promise<OneClickStatusResponse> {
        return Promise.reject(new Error('backend down'));
      },
    };
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T17:00:00.000Z') });
    const snapshot = await checkWithdrawal(W, backend, receiptFixture(), STACKS_TXID, fetchFn);
    expect(snapshot.swapError).toBe('backend down');
    expect(snapshot.observation.stacks).toEqual({ kind: 'unknown-tx' });
    expect(snapshot.observation.progress.stage).toBe('awaiting-stacks-tx');
    expect(snapshot.milestones[1]?.status).toBe('current');
    expect(urls).toEqual([`${W.stxApiUrl}/extended/v1/tx/0x${STACKS_TXID}?event_limit=50`]);
  });
});
