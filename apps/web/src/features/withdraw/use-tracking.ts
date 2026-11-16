import { useEffect } from 'react';

import {
  checkPastedWithdrawalTransaction,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
} from '@satway/core';

import {
  type ActiveWithdrawal,
  type Backend,
  type WithdrawalReceiptFile,
  abortableFetch,
  checkWithdrawal,
  downloadWithdrawalReceipt,
  forgetWithdrawalDraft,
  rememberWithdrawal,
  setActiveWithdrawal,
  useFlow,
  withdrawalId,
} from '../../shared/index.js';
import { abortableStatus } from './abortable.js';
import { storedWithdrawal } from './stored-withdrawal.js';
import { type TrackingIo, trackingRunner } from './tracking-effects.js';
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

export function trackingIo(deps: Omit<TrackingDeps, 'active'>): TrackingIo {
  const { backend, onActive } = deps;
  function show(receipt: WithdrawalReceiptFile, receiptUnsaved: boolean) {
    const id = withdrawalId(receipt);
    onActive(current =>
      current === null || withdrawalId(current.receipt) === id
        ? { receipt, receiptUnsaved, walletPrompt: false }
        : current
    );
  }
  return {
    check(effect, signal) {
      return checkWithdrawal(
        config,
        abortableStatus(backend, signal),
        effect.receipt,
        effect.stacksTxid,
        abortableFetch(signal),
        effect.softMismatches
      );
    },
    checkTxid(effect) {
      return checkPastedWithdrawalTransaction(config, effect.txid, {
        sender: effect.receipt.sender,
        amountSats: effect.receipt.amountSats,
        maxFeeSats: effect.receipt.maxFeeSats,
        recipient: effect.receipt.recipient,
      });
    },
    adopt(receipt) {
      const remembered = rememberWithdrawal(config, receipt);
      setActiveWithdrawal(receipt);
      downloadWithdrawalReceipt(receipt);
      show(receipt, !remembered);
    },
    resume(receipt) {
      setActiveWithdrawal(receipt);
      show(receipt, false);
    },
    forget(receipt) {
      forgetWithdrawalDraft(config, receipt);
      setActiveWithdrawal(null);
      onActive(current =>
        current === null || withdrawalId(current.receipt) === withdrawalId(receipt) ? null : current
      );
    },
  };
}

export function useTracking(deps: TrackingDeps): Tracking {
  const { active } = deps;
  const flow = useFlow(
    trackingMachine,
    () => initialTracking(active.receipt, active.walletPrompt),
    run
  );
  const { dispatch } = flow;

  function run(effect: TrackingEffect) {
    trackingRunner(trackingIo(deps), flow)(effect);
  }

  useEffect(() => {
    dispatch({ type: 'shown', receipt: active.receipt, walletPrompt: active.walletPrompt });
  }, [dispatch, active.receipt, active.walletPrompt]);

  return {
    view: trackingView(flow.state),
    dispatch,
    discard() {
      dispatch({ type: 'discard-requested', stored: storedWithdrawal(flow.current().receipt) });
    },
  };
}
