import {
  type SendPanel,
  type SendRecord,
  type SourceWallet,
  quoteExpired,
  sendPanel,
  walletCovers,
} from '@satway/chains';
import type { OneClickToken } from '@satway/core';

import {
  type PaymentView,
  type Receipt,
  type SendAmount,
  type Snapshot,
  paymentView,
  sendAmountOf,
} from '../../shared/index.js';
import { closingNote } from './background-registration.js';
import type { TrackingState } from './tracking-state.js';

export const RECLAIM_NOW = 'now, under “Your deposits” on the Deposit tab';

export interface TrackingContext {
  now: Date;
  token: OneClickToken | undefined;
  source: SourceWallet | null;
}

export interface TrackingView {
  done: boolean;
  terminal: boolean;
  message: string;
  problem: string | null;
  condition: ConditionNote | null;
  snapshot: Snapshot | null;
  payment: PaymentView;
  expired: boolean;
  shortDeposit: boolean;
  owedKnown: boolean;
  sendAmount: SendAmount;
  walletReady: boolean;
  panel: SendPanel;
  record: SendRecord | null;
  sendButton: 'offer' | 'sending' | null;
  info: string | null;
  error: string | null;
  checkNote: string | null;
  showResult: boolean;
  reclaim: string | null;
  closable: boolean;
  closingNote: string;
}

export interface ConditionNote {
  tone: 'status' | 'warn';
  title: string;
  text: string;
}

function satsText(amount: number): string {
  return `${amount.toLocaleString('en-US')} sats`;
}

function belowMinimumText(snapshot: Snapshot): string {
  const largest = Math.max(0, ...snapshot.belowMinimum.map(o => o.amountSats));
  const arrived = largest > 0 ? `${satsText(largest)} arrived` : 'The payout arrived';
  const minimum = snapshot.perDepositMinimum;
  const below =
    minimum === undefined || minimum === null
      ? 'below the sBTC minimum'
      : `below the sBTC minimum of ${satsText(minimum)}`;
  return `${arrived}, ${below}, so the signers will not mint it. You can reclaim it after the timelock, under “Your deposits” on the Deposit tab.`;
}

function notFoundText(snapshot: Snapshot, receipt: Receipt): string {
  const named =
    snapshot.foreignTxids.length === 0
      ? 'a Bitcoin transaction'
      : snapshot.foreignTxids.map(txid => `transaction ${txid}`).join(' and ');
  const swap = receipt.quoteResponse.quote.depositAddress ?? receipt.depositAddress;
  return `1Click says it paid you in ${named}, which does not pay your deposit address or is not on the Bitcoin network. Do not rely on it: check the transaction in a block explorer and contact 1Click with your swap deposit address ${swap}.`;
}

export function conditionNote(snapshot: Snapshot | null, receipt: Receipt): ConditionNote | null {
  if (snapshot === null) return null;
  switch (snapshot.progress.condition) {
    case undefined:
      return null;
    case 'awaiting-payout-hash':
      return {
        tone: 'status',
        title: 'Waiting for 1Click to name the payout',
        text: 'The swap is complete, but 1Click has not said which Bitcoin transaction paid your deposit address. This page keeps checking.',
      };
    case 'payout-below-minimum':
      return {
        tone: 'warn',
        title: 'This payout cannot be minted',
        text: belowMinimumText(snapshot),
      };
    case 'payout-not-found':
      return {
        tone: 'warn',
        title: '1Click reports a payout this page cannot find at your address',
        text: notFoundText(snapshot, receipt),
      };
    default:
      throw new Error(`Unknown condition ${String(snapshot.progress.condition satisfies never)}`);
  }
}

function reclaimText(snapshot: Snapshot | null): string | null {
  const progress = snapshot?.progress;
  const blocks = progress?.blocksUntilReclaim;
  if (blocks === undefined || blocks === null || progress?.stage === 'done') return null;
  if (blocks === 0) return RECLAIM_NOW;
  return `in about ${blocks} Bitcoin blocks, if the deposit is never minted`;
}

export function trackingView(state: TrackingState, ctx: TrackingContext): TrackingView {
  const { receipt, snapshot, reading, stale, send } = state;
  const quote = receipt.quoteResponse.quote;
  const progress = snapshot?.progress;
  const terminal = progress?.terminal ?? false;
  const payment = paymentView(
    reading,
    snapshot !== null && !stale ? snapshot.progress.stage : null
  );
  const shortDeposit = reading?.swap === 'INCOMPLETE_DEPOSIT';
  const owed =
    shortDeposit && reading.remaining !== null ? sendAmountOf(receipt, reading.remaining) : null;
  const { token } = ctx;
  const walletReady =
    state.target !== null &&
    token !== undefined &&
    token.blockchain === receipt.origin.chain &&
    walletCovers(ctx.source, token);
  const expired = quoteExpired(quote.deadline, ctx.now);
  const panel = sendPanel({
    swap: stale ? null : reading?.swap,
    record: send.record,
    walletCanSend: walletReady,
    sending: send.sending !== null,
    durable: state.storage.durable || !walletReady,
    lockable: state.storage.lockable || !walletReady,
    expired,
  });
  const offered = payment === 'pay' && walletReady;
  const registration = state.registration.shown;
  return {
    done: progress?.stage === 'done',
    terminal,
    message: progress?.message ?? 'Checking…',
    problem: state.problem,
    condition: conditionNote(snapshot, receipt),
    snapshot,
    payment,
    expired,
    shortDeposit,
    owedKnown: owed !== null,
    sendAmount: owed ?? sendAmountOf(receipt),
    walletReady,
    panel,
    record: panel.kind === 'record' ? panel.record : null,
    sendButton: offered && (panel.kind === 'offer' || panel.kind === 'sending') ? panel.kind : null,
    info: send.info,
    error: send.error,
    checkNote: send.checkNote,
    showResult: panel.kind === 'record' || send.info !== null || send.error !== null,
    reclaim: reclaimText(snapshot),
    closable: terminal || registration.kind === 'registered',
    closingNote: closingNote(registration, terminal),
  };
}
