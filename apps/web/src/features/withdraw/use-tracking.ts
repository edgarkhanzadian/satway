import { useEffect, useRef } from 'react';

import {
  checkPastedWithdrawalTransaction,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
  errorMessage,
} from '@satway/core';

import {
  type ActiveWithdrawal,
  type Backend,
  checkWithdrawal,
  downloadWithdrawalReceipt,
  forgetWithdrawalDraft,
  rememberWithdrawal,
  setActiveWithdrawal,
  useFlow,
} from '../../shared/index.js';
import { storedWithdrawal } from './stored-withdrawal.js';
import {
  type TrackingEffect,
  type TrackingEvent,
  type TrackingView,
  initialTracking,
  trackingMachine,
  trackingView,
} from './tracking-state.js';

export interface TrackingDeps {
  backend: Backend;
  active: ActiveWithdrawal;
  onActive(update: (current: ActiveWithdrawal | null) => ActiveWithdrawal | null): void;
}

export interface Tracking {
  view: TrackingView;
  dispatch(event: TrackingEvent): void;
  discard(): void;
}

export function useTracking(deps: TrackingDeps): Tracking {
  const { backend, active, onActive } = deps;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flow = useFlow(
    trackingMachine,
    () => initialTracking(active.receipt, active.walletPrompt),
    run
  );
  const { dispatch } = flow;

  async function poll(effect: Extract<TrackingEffect, { type: 'check' }>) {
    try {
      const snapshot = await checkWithdrawal(
        config,
        backend,
        effect.receipt,
        effect.stacksTxid,
        undefined,
        effect.softMismatches
      );
      dispatch({ type: 'polled', request: effect.request, snapshot });
    } catch (err) {
      dispatch({
        type: 'poll-failed',
        request: effect.request,
        message: errorMessage(err) ?? 'unknown error',
      });
    }
  }

  async function checkTxid(effect: Extract<TrackingEffect, { type: 'check-txid' }>) {
    try {
      const check = await checkPastedWithdrawalTransaction(config, effect.txid, {
        sender: effect.receipt.sender,
        amountSats: effect.receipt.amountSats,
        maxFeeSats: effect.receipt.maxFeeSats,
        recipient: effect.receipt.recipient,
      });
      dispatch({ type: 'txid-checked', request: effect.request, check });
    } catch (err) {
      dispatch({
        type: 'txid-check-failed',
        request: effect.request,
        message: errorMessage(err) ?? 'unknown error',
      });
    }
  }

  function run(effect: TrackingEffect) {
    switch (effect.type) {
      case 'check':
        void poll(effect);
        return;
      case 'wait':
        clearTimeout(timer.current);
        timer.current = setTimeout(
          () => dispatch({ type: 'poll-due', request: effect.request }),
          effect.delayMs
        );
        return;
      case 'check-txid':
        void checkTxid(effect);
        return;
      case 'adopt': {
        const remembered = rememberWithdrawal(config, effect.receipt);
        setActiveWithdrawal(effect.receipt);
        downloadWithdrawalReceipt(effect.receipt);
        onActive(() => ({
          receipt: effect.receipt,
          receiptUnsaved: !remembered,
          walletPrompt: false,
        }));
        return;
      }
      case 'resume':
        setActiveWithdrawal(effect.receipt);
        onActive(() => ({ receipt: effect.receipt, receiptUnsaved: false, walletPrompt: false }));
        return;
      case 'forget':
        forgetWithdrawalDraft(config, effect.receipt);
        setActiveWithdrawal(null);
        onActive(() => null);
        return;
      default:
        throw new Error(`Unknown tracking effect ${String(effect satisfies never)}`);
    }
  }

  useEffect(() => {
    dispatch({ type: 'shown', receipt: active.receipt, walletPrompt: active.walletPrompt });
  }, [dispatch, active.receipt, active.walletPrompt]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    view: trackingView(flow.state),
    dispatch,
    discard() {
      dispatch({ type: 'discard-requested', stored: storedWithdrawal(flow.current().receipt) });
    },
  };
}
