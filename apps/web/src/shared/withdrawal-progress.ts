import {
  type FetchLike,
  type OneClickStatusResponse,
  type WithdrawalFlowConfig,
  type WithdrawalObservation,
  type WithdrawalStage,
  errorMessage,
  observeWithdrawal,
} from '@satway/core';

import type { Backend } from './backend.js';
import { type WithdrawalReceiptFile, watchedWithdrawalOf } from './withdrawal-receipt.js';

export type MilestoneKey =
  | 'submitted'
  | 'confirmed'
  | 'accepted'
  | 'paid'
  | 'swapping'
  | 'delivered';

export type MilestoneStatus = 'done' | 'current' | 'pending' | 'failed';

export interface Milestone {
  key: MilestoneKey;
  label: string;
  status: MilestoneStatus;
}

export interface WithdrawalSnapshot {
  observation: WithdrawalObservation;
  milestones: Milestone[];
  swapError: string | null;
}

export const MILESTONE_LABELS: Readonly<Record<MilestoneKey, string>> = Object.freeze({
  submitted: 'Request submitted',
  confirmed: 'Stacks transaction confirmed',
  accepted: 'Accepted by the sBTC signers',
  paid: 'BTC paid to the swap address',
  swapping: 'Swapped by NEAR Intents',
  delivered: 'Delivered to your address',
});

const MILESTONE_ORDER: readonly MilestoneKey[] = [
  'submitted',
  'confirmed',
  'accepted',
  'paid',
  'swapping',
  'delivered',
];

type Statuses = Record<MilestoneKey, MilestoneStatus>;

function stacksStatuses(o: WithdrawalObservation): Pick<Statuses, 'confirmed' | 'accepted'> {
  const stacks = o.stacks;
  switch (stacks?.kind) {
    case undefined:
    case 'unknown-tx':
    case 'tx-pending':
      return { confirmed: 'current', accepted: 'pending' };
    case 'tx-failed':
    case 'not-a-withdrawal':
      return { confirmed: 'failed', accepted: 'pending' };
    case 'mismatch':
      return stacks.requestId === null
        ? { confirmed: 'failed', accepted: 'pending' }
        : { confirmed: 'done', accepted: 'failed' };
    case 'requested':
      return { confirmed: 'done', accepted: 'current' };
    case 'rejected':
      return { confirmed: 'done', accepted: 'failed' };
    case 'accepted':
      return { confirmed: 'done', accepted: 'done' };
    default:
      throw new Error(`Unknown withdrawal status ${String(stacks satisfies never)}`);
  }
}

function paidStatus(o: WithdrawalObservation): MilestoneStatus {
  if (o.stacks?.kind !== 'accepted') return 'pending';
  const payout = o.payout;
  if (payout && !payout.ok && !payout.problems.includes('tx-not-found')) return 'failed';
  if (payout?.ok && payout.confirmed) return 'done';
  const swap = o.facts.swapStatus;
  if (swap !== null && swap !== 'PENDING_DEPOSIT') return 'done';
  return 'current';
}

function swapStatus(o: WithdrawalObservation, paid: MilestoneStatus): MilestoneStatus {
  switch (o.facts.swapStatus) {
    case 'SUCCESS':
      return 'done';
    case 'REFUNDED':
    case 'FAILED':
    case 'INCOMPLETE_DEPOSIT':
      return 'failed';
    case 'KNOWN_DEPOSIT_TX':
    case 'PROCESSING':
      return 'current';
    case 'PENDING_DEPOSIT':
    case null:
      return paid === 'done' ? 'current' : 'pending';
    default:
      throw new Error(`Unknown swap status ${String(o.facts.swapStatus satisfies never)}`);
  }
}

export function withdrawalMilestones(o: WithdrawalObservation): Milestone[] {
  const stacks = stacksStatuses(o);
  const paid = paidStatus(o);
  const statuses: Statuses = {
    submitted: 'done',
    ...stacks,
    paid,
    swapping: swapStatus(o, paid),
    delivered: o.progress.stage === 'done' ? 'done' : 'pending',
  };
  if (o.progress.stage !== 'done' && statuses.swapping === 'done') statuses.swapping = 'current';
  if (o.progress.stage === 'mismatch' && !MILESTONE_ORDER.some(k => statuses[k] === 'failed')) {
    const first = MILESTONE_ORDER.find(k => statuses[k] !== 'done');
    if (first !== undefined) statuses[first] = 'failed';
  }
  return MILESTONE_ORDER.map(key => ({ key, label: MILESTONE_LABELS[key], status: statuses[key] }));
}

export async function checkWithdrawal(
  config: WithdrawalFlowConfig,
  backend: Pick<Backend, 'status'>,
  receipt: WithdrawalReceiptFile,
  stacksTxid: string,
  fetchFn?: FetchLike
): Promise<WithdrawalSnapshot> {
  let status: OneClickStatusResponse | null = null;
  let swapError: string | null = null;
  try {
    status = await backend.status(receipt.depositAddress);
  } catch (err) {
    swapError = errorMessage(err) ?? 'unknown error';
  }
  const observation = await observeWithdrawal(
    config,
    watchedWithdrawalOf(receipt, stacksTxid),
    status,
    { fetchFn }
  );
  return { observation, milestones: withdrawalMilestones(observation), swapError };
}

const HEADINGS: Readonly<Partial<Record<WithdrawalStage, string>>> = Object.freeze({
  done: 'Withdrawal complete',
  'request-failed': 'Withdrawal request failed',
  rejected: 'Withdrawal rejected by the signers',
  refunded: 'Swap refunded',
  'swap-failed': 'Swap failed',
  mismatch: 'Withdrawal needs attention',
  'needs-support': 'Withdrawal needs attention',
});

export function withdrawalHeading(stage: WithdrawalStage | null): string {
  return (stage === null ? undefined : HEADINGS[stage]) ?? 'Withdrawal in progress';
}

export function withdrawalAdvice(
  stage: WithdrawalStage,
  receipt: Pick<WithdrawalReceiptFile, 'refundTo' | 'depositAddress' | 'destination'>
): string {
  const chain = receipt.destination.chain;
  switch (stage) {
    case 'awaiting-stacks-tx':
      return 'Nothing to do yet. If this takes more than an hour, look the transaction up in your wallet’s activity.';
    case 'request-failed':
      return 'Your sBTC did not leave your wallet. You can start a new withdrawal.';
    case 'awaiting-signers':
    case 'payout-broadcast':
    case 'payout-confirmed':
    case 'swapping':
      return 'Nothing to do. You can close this page and come back later; keep the receipt file.';
    case 'rejected':
      return 'Your sBTC is back in your Stacks wallet. You can start a new withdrawal.';
    case 'done':
      return `Check your wallet on ${chain}. Nothing more happens here.`;
    case 'refunded':
      return `The BTC is yours at ${receipt.refundTo} on Bitcoin. Nothing more happens here.`;
    case 'swap-failed':
    case 'needs-support':
      return `Contact NEAR Intents support and give them the swap address ${receipt.depositAddress}.`;
    case 'deadline-passed':
      return `Keep this page or the receipt file. If the swap refunds the BTC, it goes to ${receipt.refundTo}.`;
    case 'mismatch':
      return `Keep the receipt file. Give support the swap address ${receipt.depositAddress} and the Stacks transaction.`;
    default:
      throw new Error(`Unknown withdrawal stage ${String(stage satisfies never)}`);
  }
}
