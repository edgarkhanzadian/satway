import { type ReactNode, useEffect, useRef } from 'react';

import { css, cx } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { actions, button, details, field, notice, sheet } from 'satway-styles/recipes';

import {
  type ActiveWithdrawal,
  type Backend,
  type WithdrawalReceiptFile,
  downloadWithdrawalReceipt,
} from '../../shared/index.js';
import { RefundNote, type WithdrawalRouteUpdate, WithdrawalSteps } from '../../ui/index.js';
import { formatTokenAmount, sats } from './flow.js';
import type { FollowingView, TrackingEvent, TxidEntryView } from './tracking-state.js';
import { useTracking } from './use-tracking.js';

const fields = field();

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));
const advice = css({ marginTop: 'space.06' });

function destinationOf(receipt: WithdrawalReceiptFile): string {
  return `${receipt.destination.symbol} on ${receipt.destination.chain}`;
}

function ReceiptFacts(props: { receipt: WithdrawalReceiptFile }) {
  const { receipt } = props;
  const quote = receipt.quoteResponse.quote;
  return (
    <>
      <dt>You withdraw</dt>
      <dd>
        {sats(receipt.amountSats)} of sBTC, with a fee cap of {sats(receipt.maxFeeSats)}
      </dd>
      <dt>You receive about</dt>
      <dd>
        {formatTokenAmount(quote.amountOut, receipt.destination)} {destinationOf(receipt)}, at least{' '}
        {formatTokenAmount(quote.minAmountOut, receipt.destination)}
      </dd>
      <dt>Delivered to</dt>
      <dd>
        <code>{receipt.destination.address}</code>
      </dd>
      <dt>Swap address</dt>
      <dd>
        <code>{receipt.depositAddress}</code>
      </dd>
      <dt>Bitcoin refund address</dt>
      <dd>
        <code>{receipt.refundTo}</code>
      </dd>
      <dt>Quote valid until</dt>
      <dd>{new Date(receipt.quoteDeadline).toLocaleString()}</dd>
    </>
  );
}

export function WithdrawalTracking(props: {
  backend: Backend;
  active: ActiveWithdrawal;
  onActive(update: (current: ActiveWithdrawal | null) => ActiveWithdrawal | null): void;
  onRoute(route: WithdrawalRouteUpdate | null): void;
  onDone(): void;
}) {
  const { onRoute } = props;
  const { view, dispatch, discard } = useTracking(props);
  const { receipt } = view;
  const milestones = view.kind === 'following' ? view.milestones : null;

  useEffect(() => {
    onRoute({ destination: destinationOf(receipt), milestones });
  }, [onRoute, receipt, milestones]);

  switch (view.kind) {
    case 'wallet-prompt':
      return <WaitingForWallet receipt={receipt} />;
    case 'unconfirmed':
      return (
        <UnconfirmedSignature
          receipt={receipt}
          entry={view.entry}
          dispatch={dispatch}
          onDiscard={discard}
        />
      );
    case 'following':
      return (
        <Following
          view={view}
          receiptUnsaved={props.active.receiptUnsaved}
          dispatch={dispatch}
          onDone={props.onDone}
        />
      );
    default:
      throw new Error(`Unknown tracking view ${String(view satisfies never)}`);
  }
}

function WaitingForWallet(props: { receipt: WithdrawalReceiptFile }) {
  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        Waiting for your wallet
      </styled.h2>
      <p className={notice({ tone: 'status' })} role="status">
        Your Stacks wallet is asking you to sign this withdrawal. Approve or decline it there; this
        page updates as soon as the wallet answers.
      </p>
      <dl className={details()}>
        <ReceiptFacts receipt={props.receipt} />
      </dl>
    </section>
  );
}

function TxidEntry(props: {
  entry: TxidEntryView;
  dispatch(event: TrackingEvent): void;
  children?: ReactNode;
}) {
  const { entry, dispatch } = props;
  return (
    <>
      <label className={fields.label}>
        Stacks transaction ID
        <input
          className={fields.control}
          value={entry.text}
          spellCheck={false}
          placeholder="0x…"
          onChange={e => dispatch({ type: 'txid-typed', text: e.target.value })}
        />
      </label>
      {entry.error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {entry.error}
        </p>
      )}
      <div className={actions()}>
        <button
          className={button({ variant: 'primary' })}
          disabled={!entry.text}
          aria-disabled={entry.checking}
          onClick={() => {
            if (!entry.checking) dispatch({ type: 'txid-submitted' });
          }}
        >
          {entry.checking ? 'Checking…' : 'Follow this transaction'}
        </button>
        {props.children}
      </div>
    </>
  );
}

function UnconfirmedSignature(props: {
  receipt: WithdrawalReceiptFile;
  entry: TxidEntryView;
  dispatch(event: TrackingEvent): void;
  onDiscard(): void;
}) {
  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        Did your wallet send the withdrawal?
      </styled.h2>
      <p className={notice({ tone: 'warn' })} role="alert">
        Your wallet was asked to sign this withdrawal, but this page did not get its answer, so it
        does not know whether anything was sent.
      </p>
      <p className={advice}>
        Open your Stacks wallet’s activity. If it sent a call to initiate-withdrawal-request, paste
        its transaction ID here to follow it. If it sent nothing, discard this withdrawal; your sBTC
        has not moved.
      </p>
      <TxidEntry entry={props.entry} dispatch={props.dispatch}>
        <button className={button()} onClick={props.onDiscard}>
          Nothing was sent. Discard it
        </button>
      </TxidEntry>
      <dl className={details()}>
        <ReceiptFacts receipt={props.receipt} />
      </dl>
    </section>
  );
}

function Following(props: {
  view: FollowingView;
  receiptUnsaved: boolean;
  dispatch(event: TrackingEvent): void;
  onDone(): void;
}) {
  const { view, dispatch } = props;
  const { receipt, progress, facts, milestones } = view;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section className={sheet()}>
      <styled.h2 ref={headingRef} tabIndex={-1} textStyle="heading" marginBottom="space.06">
        {view.heading}
      </styled.h2>

      {props.receiptUnsaved && (
        <p className={notice({ tone: 'warn' })} role="alert">
          This browser could not keep a copy of the receipt, so the file that was just downloaded is
          the only copy. Keep it: it is how you follow this withdrawal later.
        </p>
      )}

      <p className={notice({ tone: progress?.warning ? 'warn' : 'status' })} role="status">
        {progress?.message ?? 'Checking…'}
      </p>
      {view.advice !== null && <p className={advice}>{view.advice}</p>}
      {view.problem && <p className={notice()}>{view.problem}</p>}
      {view.swapError && (
        <p className={notice()}>
          Could not read the swap status right now ({view.swapError}). Checking again shortly.
        </p>
      )}
      {view.mismatches.length > 0 && (
        <ul className={notice({ tone: 'warn' })}>
          {view.mismatches.map(m => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {facts?.swapStatus === 'REFUNDED' && (
        <RefundNote
          refund={facts.refund}
          refundTo={receipt.refundTo}
          symbol="BTC"
          chain="Bitcoin"
        />
      )}

      {milestones && <WithdrawalSteps milestones={milestones} />}

      <dl className={details()}>
        <ReceiptFacts receipt={receipt} />
        <dt>Stacks transaction</dt>
        <dd>
          <code>0x{view.stacksTxid}</code>
        </dd>
        {facts && facts.requestId !== null && (
          <>
            <dt>Withdrawal request</dt>
            <dd>{facts.requestId}</dd>
          </>
        )}
        {facts?.txFailure && (
          <>
            <dt>Why it failed</dt>
            <dd>{facts.txFailure.clarityError ?? facts.txFailure.code}</dd>
          </>
        )}
        {facts?.payoutTxid && (
          <>
            <dt>Bitcoin payout</dt>
            <dd>
              <code>
                {facts.payoutTxid}
                {facts.payoutVout !== null ? `:${facts.payoutVout}` : ''}
              </code>
              {facts.payoutConfirmations !== null
                ? `, ${facts.payoutConfirmations} confirmation${facts.payoutConfirmations === 1 ? '' : 's'}`
                : ''}
            </dd>
          </>
        )}
        {facts && facts.feeSats !== null && (
          <>
            <dt>Signer fee charged</dt>
            <dd>{sats(facts.feeSats)}</dd>
          </>
        )}
        {facts && facts.destinationTxHashes.length > 0 && (
          <>
            <dt>Delivery transaction</dt>
            <dd>
              <code>{facts.destinationTxHashes.join(', ')}</code>
            </dd>
          </>
        )}
      </dl>

      {view.change && view.changeable && (
        <section aria-labelledby="change-transaction">
          <styled.h3 id="change-transaction" textStyle="emphasis" marginTop="space.10">
            Change the transaction
          </styled.h3>
          <p className={advice}>
            Paste the ID of the Stacks transaction your wallet sent for this withdrawal. It is
            checked before it replaces the one above.
          </p>
          <TxidEntry entry={view.change} dispatch={dispatch}>
            <button className={button()} onClick={() => dispatch({ type: 'change-closed' })}>
              Cancel
            </button>
          </TxidEntry>
        </section>
      )}

      <div className={actions()}>
        {view.changeable && !view.change && (
          <button className={button()} onClick={() => dispatch({ type: 'change-opened' })}>
            Change transaction
          </button>
        )}
        <button className={button()} onClick={() => downloadWithdrawalReceipt(receipt)}>
          Download receipt again
        </button>
        <button className={button()} onClick={props.onDone}>
          {progress?.terminal ? 'Start another' : 'Hide'}
        </button>
      </div>
      <p className={afterActions}>
        You can close this page. The withdrawal continues, and you can follow it later from Your
        withdrawals on this tab or by loading the receipt file.
      </p>
    </section>
  );
}
