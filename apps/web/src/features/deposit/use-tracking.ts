import { useEffect, useRef, useState } from 'react';

import {
  type SourceWallet,
  evmTransactionState,
  sendFromEvm,
  watchSendRecords,
} from '@satway/chains';
import { type OneClickToken, MAINNET_CONFIG as config } from '@satway/core';

import {
  type Backend,
  type BackgroundRegistration,
  type Receipt,
  checkProgress,
  sendRecords,
  useFlow,
} from '../../shared/index.js';
import { registeredThisSession } from './background-registration.js';
import { type TrackingRunner, createTrackingRunner } from './tracking-effects.js';
import {
  type TrackingEffect,
  type TrackingEvent,
  type TrackingState,
  initialTracking,
  trackingMachine,
  trackingTarget,
} from './tracking-state.js';

export interface TrackingInput {
  backend: Backend;
  receipt: Receipt;
  firstRegistration: BackgroundRegistration | null | undefined;
  source: SourceWallet | null;
  token: OneClickToken | undefined;
}

export interface Tracking {
  state: TrackingState;
  dispatch(event: TrackingEvent): void;
}

export function useTracking(input: TrackingInput): Tracking {
  const { backend, receipt } = input;
  const sourceRef = useRef(input.source);
  sourceRef.current = input.source;
  const tokenRef = useRef(input.token);
  tokenRef.current = input.token;
  const runner = useRef<TrackingRunner | null>(null);
  const flow = useFlow(
    trackingMachine,
    () => {
      const target = trackingTarget(receipt);
      return initialTracking({
        receipt,
        record: target === null ? null : sendRecords.read(target),
        storage: { durable: sendRecords.durable(), lockable: sendRecords.lockable() },
        first: input.firstRegistration,
      });
    },
    run
  );
  const { dispatch } = flow;
  const [first] = useState(input.firstRegistration);

  function runnerNow(): TrackingRunner {
    runner.current ??= createTrackingRunner({
      backend,
      records: sendRecords,
      registered: registeredThisSession,
      checkProgress: (r, known) => checkProgress(config, backend, r, undefined, known),
      wallet: () => sourceRef.current,
      token: () => tokenRef.current,
      evmState: evmTransactionState,
      sendTransfer: sendFromEvm,
      dispatch,
    });
    return runner.current;
  }

  function run(effect: TrackingEffect) {
    runnerNow().run(effect);
  }

  useEffect(() => {
    const swapAddress = receipt.quoteResponse.quote.depositAddress;
    dispatch({
      type: 'shown',
      first,
      registered: swapAddress !== undefined && registeredThisSession.has(swapAddress),
    });
  }, [dispatch, receipt, first]);

  useEffect(() => {
    const target = trackingTarget(receipt);
    if (target === null) return;
    return watchSendRecords(window, () =>
      dispatch({ type: 'record-changed', record: sendRecords.read(target) })
    );
  }, [dispatch, receipt]);

  const provider = input.source?.provider ?? null;
  const lastProvider = useRef(provider);
  useEffect(() => {
    if (lastProvider.current === provider) return;
    lastProvider.current = provider;
    dispatch({ type: 'wallet-changed' });
  }, [dispatch, provider]);

  useEffect(
    () => () => {
      runner.current?.dispose();
      runner.current = null;
    },
    []
  );

  return { state: flow.state, dispatch };
}
