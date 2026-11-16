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
