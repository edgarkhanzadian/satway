import {
  type EvmTransactionState,
  type EvmTransfer,
  type SendRecords,
  type SourceWallet,
  type SwapTarget,
  attemptSend,
  buildEvmTransfer,
  confirmNothingSent,
  needsChainCheck,
  promptWaitMs,
  releaseIfCleared,
  resolveRecord,
  settleFromProvider,
} from '@satway/chains';
import { type OneClickToken, errorMessage } from '@satway/core';

import {
  type Backend,
  type BackgroundRegistration,
  ProgressReadError,
  type Receipt,
  type Snapshot,
} from '../../shared/index.js';
import type { RegisteredSwaps } from './background-registration.js';
import {
  PROMPT_SLACK_MS,
  type TrackingEffect,
  type TrackingEvent,
  WALLET_DID_NOT_SEND,
} from './tracking-state.js';

export interface TrackingDeps {
  backend: Backend;
  records: SendRecords;
  registered: RegisteredSwaps;
  checkProgress(receipt: Receipt, known: Snapshot['mints'] | undefined): Promise<Snapshot>;
  wallet(): SourceWallet | null;
  token(): OneClickToken | undefined;
  evmState(provider: SourceWallet['provider'], hash: string): Promise<EvmTransactionState>;
  sendTransfer(provider: SourceWallet['provider'], transfer: EvmTransfer): Promise<string>;
  dispatch(event: TrackingEvent): void;
}

export interface TrackingRunner {
  run(effect: TrackingEffect): void;
  dispose(): void;
}

export const NO_WALLET_TO_CHECK = 'connect the wallet you sent from to check it';

export function createTrackingRunner(deps: TrackingDeps): TrackingRunner {
  const { records, dispatch } = deps;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function later(delayMs: number, event: TrackingEvent) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      dispatch(event);
    }, delayMs);
    timers.add(timer);
  }

  async function checkProgress(effect: Extract<TrackingEffect, { type: 'check-progress' }>) {
    try {
      const snapshot = await deps.checkProgress(effect.receipt, effect.known);
      dispatch({ type: 'polled', request: effect.request, snapshot });
    } catch (err) {
      dispatch({
        type: 'poll-failed',
        request: effect.request,
        reading: err instanceof ProgressReadError ? err.reading : { swap: null, remaining: null },
        message: String(errorMessage(err)),
      });
    }
  }

  async function register(effect: Extract<TrackingEffect, { type: 'register' }>) {
    let result: BackgroundRegistration | null;
    try {
      result = await deps.backend.register(
        effect.receipt.depositScript,
        effect.receipt.reclaimScript,
        effect.swapAddress
      );
    } catch {
      result = null;
    }
    dispatch({ type: 'registration-answered', request: effect.request, result });
  }

  function evmState(hash: string): Promise<EvmTransactionState> {
    const provider = deps.wallet()?.provider;
    if (!provider) return Promise.reject(new Error(NO_WALLET_TO_CHECK));
    return deps.evmState(provider, hash);
  }

  async function chainCheck(request: number, target: SwapTarget) {
    const current = records.read(target);
    if (current === null || !needsChainCheck(current)) {
      dispatch({ type: 'record-changed', record: current });
      return;
    }
    try {
      const resolution = await resolveRecord(records, current, evmState);
      dispatch({ type: 'chain-checked', request, resolution, record: records.read(target) });
    } catch (err) {
      dispatch({
        type: 'chain-check-failed',
        request,
        message: errorMessage(err) ?? 'unknown error',
      });
    }
  }

  async function send(effect: Extract<TrackingEffect, { type: 'send' }>) {
    const { request, target } = effect;
    const wallet = deps.wallet();
    const token = deps.token();
    try {
      if (!wallet || !token) throw new Error(WALLET_DID_NOT_SEND);
      const transfer = buildEvmTransfer({
        token,
        from: wallet.address,
        to: target.address,
        amount: effect.amount,
      });
      const result = await attemptSend(
        records,
        { target, account: wallet.address, now: new Date() },
        () => deps.sendTransfer(wallet.provider, transfer)
      );
      dispatch({ type: 'send-finished', request, result, record: records.read(target) });
    } catch (err) {
      dispatch({
        type: 'send-finished',
        request,
        result: { kind: 'threw', message: errorMessage(err) ?? '' },
        record: records.read(target),
      });
    }
  }

  function watchPrompt(effect: Extract<TrackingEffect, { type: 'watch-prompt' }>) {
    const wait = promptWaitMs(effect.record, new Date());
    if (wait > 0) later(wait + PROMPT_SLACK_MS, { type: 'prompt-due', request: effect.request });
  }

  function run(effect: TrackingEffect) {
    switch (effect.type) {
      case 'check-progress':
        void checkProgress(effect);
        return;
      case 'wait':
        later(effect.delayMs, effect.due);
        return;
      case 'register':
        void register(effect);
        return;
      case 'remember-registered':
        deps.registered.add(effect.swapAddress);
        return;
      case 'settle-record':
        dispatch({
          type: 'record-changed',
          record: settleFromProvider(records, records.read(effect.target), effect.swap),
        });
        return;
      case 'release-if-cleared':
        releaseIfCleared(records, effect.target);
        return;
      case 'chain-check':
        void chainCheck(effect.request, effect.target);
        return;
      case 'send':
        void send(effect);
        return;
      case 'confirm-nothing':
        confirmNothingSent(records, effect.record);
        dispatch({ type: 'record-changed', record: records.read(effect.record.swap) });
        return;
      case 'watch-prompt':
        watchPrompt(effect);
        return;
      default:
        throw new Error(`Unknown tracking effect ${String(effect satisfies never)}`);
    }
  }

  return {
    run,
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
