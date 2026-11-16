import { type PastedWithdrawalCheck, errorMessage } from '@satway/core';

import {
  type WithdrawalReceiptFile,
  type WithdrawalSnapshot,
  failureReason,
} from '../../shared/index.js';
import type { TrackingEffect, TrackingEvent } from './tracking-state.js';

export type PollEffect = Extract<TrackingEffect, { type: 'check' }>;
export type TxidEffect = Extract<TrackingEffect, { type: 'check-txid' }>;

export interface TrackingIo {
  check(effect: PollEffect, signal: AbortSignal): Promise<WithdrawalSnapshot>;
  checkTxid(effect: TxidEffect): Promise<PastedWithdrawalCheck>;
  adopt(receipt: WithdrawalReceiptFile): void;
  resume(receipt: WithdrawalReceiptFile): void;
  forget(receipt: WithdrawalReceiptFile): void;
}

export interface TrackingFlow {
  dispatch(event: TrackingEvent): void;
  signal(request: number): AbortSignal;
}

export function trackingRunner(
  io: TrackingIo,
  flow: TrackingFlow
): (effect: TrackingEffect) => void {
  async function poll(effect: PollEffect) {
    const signal = flow.signal(effect.request);
    try {
      const snapshot = await io.check(effect, signal);
      flow.dispatch({ type: 'polled', request: effect.request, snapshot });
    } catch (err) {
      flow.dispatch({
        type: 'poll-failed',
        request: effect.request,
        message: failureReason(err),
      });
    }
  }

  async function checkTxid(effect: TxidEffect) {
    try {
      const check = await io.checkTxid(effect);
      flow.dispatch({ type: 'txid-checked', request: effect.request, check });
    } catch (err) {
      flow.dispatch({
        type: 'txid-check-failed',
        request: effect.request,
        message: errorMessage(err) ?? 'unknown error',
      });
    }
  }

  function wait(request: number, delayMs: number) {
    const signal = flow.signal(request);
    if (signal.aborted) return;
    const timer = setTimeout(() => flow.dispatch({ type: 'poll-due', request }), delayMs);
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  }

  return effect => {
    switch (effect.type) {
      case 'check':
        void poll(effect);
        return;
      case 'wait':
        wait(effect.request, effect.delayMs);
        return;
      case 'check-txid':
        void checkTxid(effect);
        return;
      case 'adopt':
        io.adopt(effect.receipt);
        return;
      case 'resume':
        io.resume(effect.receipt);
        return;
      case 'forget':
        io.forget(effect.receipt);
        return;
      default:
        throw new Error(`Unknown tracking effect ${String(effect satisfies never)}`);
    }
  };
}
