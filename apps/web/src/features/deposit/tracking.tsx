import { useEffect, useRef } from 'react';

import { css, cx } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { actions, button, details, notice, sheet } from 'satway-styles/recipes';

import type { SourceWallet } from '@satway/chains';
import type { OneClickToken } from '@satway/core';

import {
  type Backend,
  type BackgroundRegistration,
  type Receipt,
  downloadReceipt,
} from '../../shared/index.js';
import {
  PayoutDetails,
  PayoutNotices,
  QuotedOutput,
  RefundNote,
  type RouteUpdate,
} from '../../ui/index.js';
import { SendPanel } from './send-panel.js';
import { trackingView } from './tracking-view.js';
import { useTracking } from './use-tracking.js';

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));
const afterActionsWarn = cx(notice({ tone: 'warn' }), css({ marginTop: 'space.08' }));

export function Tracking(props: {
  backend: Backend;
  receipt: Receipt;
  receiptUnsaved: boolean;
  firstRegistration: BackgroundRegistration | null | undefined;
  source: SourceWallet | null;
  token: OneClickToken | undefined;
  onRoute(route: RouteUpdate | null): void;
  onHide(): void;
  onDone(): void;
}) {
  const { receipt, source, token, onRoute } = props;
  const tracking = useTracking({
    backend: props.backend,
    receipt,
    firstRegistration: props.firstRegistration,
    source,
    token,
  });
  const { state, dispatch } = tracking;
  const now = new Date();
  const view = trackingView(state, { now, token, source });
  const { snapshot } = view;
  const quote = receipt.quoteResponse.quote;
  const stage = snapshot?.progress.stage ?? null;

  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const sendResultRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLParagraphElement>(null);
  const focus = state.send.focus;
  useEffect(() => {
    if (focus === 0) return;
    const sendButton = sendButtonRef.current;
    if (sendButton !== null && document.activeElement === sendButton) return;
    (sendResultRef.current ?? progressRef.current)?.focus();
  }, [focus]);

  useEffect(() => {
    onRoute({ origin: `${receipt.origin.symbol} on ${receipt.origin.chain}`, deposit: { stage } });
  }, [onRoute, receipt, stage]);

  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        {view.done ? 'Deposit complete' : 'Deposit in progress'}
      </styled.h2>

      {props.receiptUnsaved && (
        <p className={notice({ tone: 'warn' })} role="alert">
          This browser could not keep a copy of the receipt, so the file that was just downloaded is
          the only copy. Keep it: it is what lets you recover your BTC if anything goes wrong.
        </p>
      )}

      <SendPanel
        receipt={receipt}
        view={view}
        now={now}
        walletName={source?.name}
        sendButtonRef={sendButtonRef}
        resultRef={sendResultRef}
        onSend={() =>
          dispatch({
            type: 'send-requested',
            now: new Date(),
            ready: view.walletReady,
            keepFocus:
              sendButtonRef.current !== null && document.activeElement === sendButtonRef.current,
          })
        }
        onConfirmNothingSent={record => dispatch({ type: 'nothing-sent-confirmed', record })}
      />

      <p ref={progressRef} tabIndex={-1} className={notice({ tone: 'status' })} role="status">
        {view.message}
      </p>
      {view.problem && <p className={notice()}>{view.problem}</p>}
      {snapshot?.swap === 'REFUNDED' && (
        <RefundNote
          refund={snapshot.refund}
          refundTo={receipt.refundTo}
          symbol={receipt.origin.symbol}
          chain={receipt.origin.chain}
        />
      )}
      {snapshot && <PayoutNotices snapshot={snapshot} />}

      <dl className={details()}>
        <dt>sBTC recipient</dt>
        <dd>
          <code>{receipt.stacksAddress}</code>
        </dd>
        <dt>Bitcoin deposit address</dt>
        <dd>
          <code>{receipt.depositAddress}</code>
        </dd>
        <QuotedOutput quote={quote} />
        {snapshot && <PayoutDetails snapshot={snapshot} />}
        {view.reclaim !== null && (
          <>
            <dt>Reclaim available</dt>
            <dd>{view.reclaim}</dd>
          </>
        )}
      </dl>

      <div className={actions()}>
        <button className={button()} onClick={() => downloadReceipt(receipt)}>
          Download receipt again
        </button>
        <button className={button()} onClick={view.terminal ? props.onDone : props.onHide}>
          {view.terminal ? 'Start another' : 'Hide'}
        </button>
      </div>
      <p className={view.closable ? afterActions : afterActionsWarn} role="status">
        {view.closingNote}
      </p>
    </section>
  );
}
