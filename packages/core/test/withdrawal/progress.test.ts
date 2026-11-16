import { describe, expect, it } from 'vitest';

import {
  type OnChainWithdrawalRequest,
  type OneClickSwapStatus,
  type PayoutVerification,
  SOFT_MISMATCH_CONFIRMATIONS,
  type WithdrawalObservations,
  type WithdrawalStage,
  type WithdrawalStatus,
  deriveWithdrawalProgress,
} from '../../src/index.js';

const request: OnChainWithdrawalRequest = {
  requestId: 5131,
  amountSats: 1_854_385,
  maxFeeSats: 4_115,
  sender: 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6',
  recipient: { version: '01', hashbytes: 'eb1bd00d971f2500dc2c1653ffd794825675fa24' },
  burnHeight: 975_450,
  status: 'accepted',
};

const accepted: WithdrawalStatus = {
  kind: 'accepted',
  request,
  sweep: null,
  payout: null,
  payoutError: null,
};

const verified: PayoutVerification = {
  ok: true,
  txid: 'db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
  vout: 2,
  valueSats: 1_854_385,
  problems: [],
  confirmed: true,
  blockHeight: 975_459,
  confirmations: 488,
};

function o(patch: Partial<WithdrawalObservations>): WithdrawalObservations {
  return {
    stacks: null,
    payout: null,
    swap: null,
    swapEcho: null,
    mismatches: [],
    deadlinePassed: false,
    rejectionBlocks: 27,
    ...patch,
  };
}

const failure = {
  code: 'insufficient-balance' as const,
  clarityError: '(err u1)',
  message:
    'Your sBTC balance was too low to lock the amount plus the fee cap, so nothing was withdrawn.',
};

describe('deriveWithdrawalProgress', () => {
  it.each<[string, WithdrawalObservations, WithdrawalStage, boolean, boolean]>([
    ['the Stacks API is unreachable', o({}), 'awaiting-stacks-tx', false, false],
    [
      'the tx is not found yet',
      o({ stacks: { kind: 'unknown-tx' } }),
      'awaiting-stacks-tx',
      false,
      false,
    ],
    [
      'the tx is pending',
      o({ stacks: { kind: 'tx-pending' } }),
      'awaiting-stacks-tx',
      false,
      false,
    ],
    ['the tx failed', o({ stacks: { kind: 'tx-failed', failure } }), 'request-failed', true, false],
    [
      'the signers have not decided',
      o({
        stacks: {
          kind: 'requested',
          request: { ...request, status: 'pending' },
          stacksBlockHeight: 1,
        },
      }),
      'awaiting-signers',
      false,
      false,
    ],
    [
      'the signers rejected',
      o({ stacks: { kind: 'rejected', request: { ...request, status: 'rejected' } } }),
      'rejected',
      true,
      false,
    ],
    [
      'accepted, payout not yet verified',
      o({ stacks: accepted }),
      'payout-broadcast',
      false,
      false,
    ],
    [
      'accepted, payout unconfirmed',
      o({ stacks: accepted, payout: { ...verified, confirmed: false, confirmations: null } }),
      'payout-broadcast',
      false,
      false,
    ],
    [
      'accepted, payout tx not found',
      o({ stacks: accepted, payout: { ...verified, ok: false, problems: ['tx-not-found'] } }),
      'payout-broadcast',
      false,
      false,
    ],
    [
      'payout confirmed, swap not seen',
      o({ stacks: accepted, payout: verified, swap: 'PENDING_DEPOSIT' }),
      'payout-confirmed',
      false,
      false,
    ],
    [
      'the swap is processing',
      o({ stacks: accepted, payout: verified, swap: 'PROCESSING' }),
      'swapping',
      false,
      false,
    ],
    [
      'the swap saw the deposit',
      o({ stacks: accepted, payout: verified, swap: 'KNOWN_DEPOSIT_TX' }),
      'swapping',
      false,
      false,
    ],
    [
      'the swap succeeded',
      o({ stacks: accepted, payout: verified, swap: 'SUCCESS' }),
      'done',
      true,
      false,
    ],
    [
      'the swap refunded',
      o({ stacks: accepted, payout: verified, swap: 'REFUNDED' }),
      'refunded',
      true,
      false,
    ],
    [
      'the swap failed',
      o({ stacks: accepted, payout: verified, swap: 'FAILED' }),
      'swap-failed',
      true,
      false,
    ],
    [
      'the swap saw too little',
      o({ stacks: accepted, payout: verified, swap: 'INCOMPLETE_DEPOSIT' }),
      'needs-support',
      false,
      true,
    ],
    [
      'the deadline passed while waiting for the signers',
      o({
        stacks: {
          kind: 'requested',
          request: { ...request, status: 'pending' },
          stacksBlockHeight: 1,
        },
        deadlinePassed: true,
      }),
      'deadline-passed',
      false,
      true,
    ],
    [
      'the deadline passed with a confirmed payout the swap has not reported',
      o({ stacks: accepted, payout: verified, swap: 'PENDING_DEPOSIT', deadlinePassed: true }),
      'deadline-passed',
      false,
      true,
    ],
    [
      'the deadline passed while the tx is pending',
      o({ stacks: { kind: 'tx-pending' }, deadlinePassed: true }),
      'deadline-passed',
      false,
      true,
    ],
    [
      'the deadline passed and nothing could be read',
      o({ deadlinePassed: true }),
      'deadline-passed',
      false,
      true,
    ],
    [
      'the swap succeeded after the deadline',
      o({ stacks: accepted, payout: verified, swap: 'SUCCESS', deadlinePassed: true }),
      'done',
      true,
      false,
    ],
    [
      'the rejected request is final even past the deadline',
      o({
        stacks: { kind: 'rejected', request: { ...request, status: 'rejected' } },
        deadlinePassed: true,
      }),
      'rejected',
      true,
      false,
    ],
    [
      'the chain differs from the receipt',
      o({
        stacks: {
          kind: 'mismatch',
          requestId: 5131,
          problems: ['sBTC registry: amount is 1 sats, expected 2'],
          soft: false,
        },
      }),
      'mismatch',
      true,
      true,
    ],
    [
      'the registry has not shown the request yet, on a first sighting',
      o({
        stacks: {
          kind: 'mismatch',
          requestId: 5131,
          problems: ['The sBTC registry has no withdrawal request 5131'],
          soft: true,
        },
        softMismatches: 1,
      }),
      'rechecking',
      false,
      true,
    ],
    [
      'the registry has not shown the request yet, even if the swap reports success',
      o({
        stacks: {
          kind: 'mismatch',
          requestId: 5131,
          problems: ['The sBTC registry has no withdrawal request 5131'],
          soft: true,
        },
        softMismatches: 2,
        swap: 'SUCCESS',
      }),
      'rechecking',
      false,
      true,
    ],
    [
      'the registry still has not shown the request after several polls',
      o({
        stacks: {
          kind: 'mismatch',
          requestId: 5131,
          problems: ['The sBTC registry has no withdrawal request 5131'],
          soft: true,
        },
        softMismatches: SOFT_MISMATCH_CONFIRMATIONS,
      }),
      'mismatch',
      true,
      true,
    ],
    [
      'the Stacks transaction was replaced or dropped',
      o({
        stacks: { kind: 'tx-dropped', txStatus: 'dropped_replace_by_fee', lookupError: null },
      }),
      'tx-replaced',
      false,
      true,
    ],
    [
      'the Stacks transaction was dropped, past the deadline',
      o({
        stacks: { kind: 'tx-dropped', txStatus: 'dropped_stale_garbage', lookupError: null },
        deadlinePassed: true,
      }),
      'deadline-passed',
      false,
      true,
    ],
    [
      'another transaction was confirmed at the withdrawal’s nonce',
      o({ stacks: { kind: 'tx-cancelled', replacedBy: 'ef'.repeat(32) } }),
      'request-failed',
      true,
      false,
    ],
    [
      'the tx is not a withdrawal',
      o({ stacks: { kind: 'not-a-withdrawal', message: 'Not a withdrawal call.' } }),
      'mismatch',
      true,
      true,
    ],
    [
      'the payout pays the wrong amount',
      o({ stacks: accepted, payout: { ...verified, ok: false, problems: ['wrong-value'] } }),
      'mismatch',
      true,
      true,
    ],
    [
      'the swap echoes another quote',
      o({ stacks: accepted, payout: verified, swap: 'SUCCESS', swapEcho: 'mismatch' }),
      'mismatch',
      true,
      true,
    ],
    [
      'the receipt is inconsistent',
      o({
        stacks: accepted,
        payout: verified,
        swap: 'SUCCESS',
        mismatches: ['Saved data differs.'],
      }),
      'mismatch',
      true,
      true,
    ],
    [
      'the swap reports activity for a request that failed',
      o({ stacks: { kind: 'tx-failed', failure }, swap: 'SUCCESS' }),
      'mismatch',
      true,
      true,
    ],
    [
      'the swap reports activity for a rejected request',
      o({
        stacks: { kind: 'rejected', request: { ...request, status: 'rejected' } },
        swap: 'PROCESSING',
      }),
      'mismatch',
      true,
      true,
    ],
  ])('when %s', (_name, observations, stage, terminal, warning) => {
    const progress = deriveWithdrawalProgress(observations);
    expect(progress.stage).toBe(stage);
    expect(progress.terminal).toBe(terminal);
    expect(progress.warning).toBe(warning);
    expect(progress.message.length).toBeGreaterThan(20);
  });

  it('never reports done without the swap provider saying SUCCESS', () => {
    const statuses: (OneClickSwapStatus | null)[] = [
      null,
      'PENDING_DEPOSIT',
      'KNOWN_DEPOSIT_TX',
      'PROCESSING',
      'INCOMPLETE_DEPOSIT',
      'REFUNDED',
      'FAILED',
    ];
    for (const swap of statuses) {
      for (const deadlinePassed of [false, true]) {
        const stage = deriveWithdrawalProgress(
          o({ stacks: accepted, payout: verified, swap, deadlinePassed })
        ).stage;
        expect(stage).not.toBe('done');
      }
    }
  });

  it('explains the failure reason and the rejection timing', () => {
    expect(deriveWithdrawalProgress(o({ stacks: { kind: 'tx-failed', failure } })).message).toBe(
      failure.message
    );
    const waiting = deriveWithdrawalProgress(
      o({
        stacks: {
          kind: 'requested',
          request: { ...request, status: 'pending' },
          stacksBlockHeight: 1,
        },
      })
    );
    expect(waiting.message).toMatch(/about 27 Bitcoin blocks/);
    expect(deriveWithdrawalProgress(o({ stacks: { kind: 'rejected', request } })).message).toMatch(
      /returned to your wallet as sBTC/
    );
  });

  it('does not say nothing moved, nor invite a new withdrawal, for a dropped transaction', () => {
    const message = deriveWithdrawalProgress(
      o({ stacks: { kind: 'tx-dropped', txStatus: 'dropped_replace_by_fee', lookupError: null } })
    ).message;
    expect(message).toMatch(/replaced or dropped/);
    expect(message).not.toMatch(/nothing|no sBTC|new withdrawal|start/i);
  });
});
