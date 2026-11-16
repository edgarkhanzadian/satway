import type { Ref } from 'react';

import { css, cx } from 'satway-styles/css';
import { actions, button, notice } from 'satway-styles/recipes';

import type { SendRecord } from '@satway/chains';

import { type Receipt, sendAmountText } from '../../shared/index.js';
import { SendRecordView } from '../../ui/index.js';
import type { TrackingView } from './tracking-view.js';

const send = css({
  borderLeftWidth: 'accent',
  borderLeftStyle: 'solid',
  borderLeftColor: 'route.origin',
  borderRadius: 'sm',
  backgroundColor: 'stage',
  paddingBlock: { base: 'space.08', md: 'space.10' },
  paddingInline: { base: 'space.08', md: 'space.10' },
  marginBlock: 'space.10',
});
const sendLine = css({ marginBlock: 'space.02' });
const sendFigure = css({
  marginBlock: 'space.02',
  textStyle: 'emphasis',
  '& code': { fontSize: 'md' },
});
const sendNote = cx(notice(), sendLine);
const sendStatus = cx(notice({ tone: 'status' }), css({ marginBlock: 'space.06' }));
const sendFailure = cx(notice({ tone: 'error' }), sendLine);
const sendActions = cx(actions(), css({ marginBlock: 'space.08' }));
const refundNote = cx(
  notice(),
  css({ marginBlock: 'space.02', '.satway-actions + &': { marginTop: 'space.08' } })
);

function ExpiredQuote(props: { deadline: string | undefined; now: Date }) {
  const { deadline, now } = props;
  return (
    <>
      <p className={sendLine}>
        {deadline && Date.parse(deadline) > now.getTime()
          ? `This quote expires at ${new Date(deadline).toLocaleString()}, too soon to send safely.`
          : `This quote expired${deadline ? ` at ${new Date(deadline).toLocaleString()}` : ''}.`}
      </p>
      <p className={sendNote}>
        Do not send anything to this swap now: the swap provider says funds that arrive after the
        deadline may be lost. Start a new deposit to get a fresh quote. If you already sent the
        payment, this page keeps tracking it.
      </p>
    </>
  );
}

function PaymentDetails(props: { receipt: Receipt; view: TrackingView }) {
  const { receipt, view } = props;
  const quote = receipt.quoteResponse.quote;
  const { sendAmount } = view;
  return (
    <>
      {view.shortDeposit ? (
        <p className={sendLine}>
          {view.owedKnown
            ? 'Part of the amount arrived. Send exactly the rest, from your own wallet:'
            : 'Part of the amount arrived, but the swap provider did not say how much. From your own wallet, send only what is missing from the quoted total:'}
        </p>
      ) : (
        <p className={sendLine}>
          {view.walletReady ? 'Send exactly this:' : 'Send exactly this, from your own wallet:'}
        </p>
      )}
      <p className={sendFigure}>
        {sendAmountText(sendAmount, receipt.origin.symbol)} on {receipt.origin.chain}
      </p>
      {sendAmount.kind === 'base-units' && (
        <p className={sendNote}>
          This page does not know how many decimal places {receipt.origin.symbol} has, so the amount
          is shown in its smallest unit, exactly as the swap was quoted. Check that your wallet
          shows the same amount before you send.
        </p>
      )}
      <p className={sendLine}>to</p>
      <p className={sendFigure}>
        <code>{quote.depositAddress}</code>
      </p>
      {quote.depositMemo && (
        <p className={sendLine}>
          with memo <code>{quote.depositMemo}</code>
        </p>
      )}
      {quote.deadline && (
        <p className={sendNote}>before {new Date(quote.deadline).toLocaleString()}</p>
      )}
    </>
  );
}

export function SendPanel(props: {
  receipt: Receipt;
  view: TrackingView;
  now: Date;
  walletName: string | undefined;
  sendButtonRef: Ref<HTMLButtonElement>;
  resultRef: Ref<HTMLDivElement>;
  onSend(): void;
  onConfirmNothingSent(record: SendRecord): void;
}) {
  const { receipt, view, now } = props;
  const quote = receipt.quoteResponse.quote;
  const { payment, panel } = view;
  if (payment === 'none' || !quote.depositAddress) return null;
  return (
    <div className={send}>
      {payment !== 'pay' && !view.expired && (
        <p className={sendLine}>
          {payment === 'checking'
            ? 'Checking whether a payment has already arrived…'
            : 'Can’t confirm the swap status right now, so the payment details are not shown. If you have already paid, there is nothing more to do here. This page keeps checking.'}
        </p>
      )}
      {view.expired ? (
        <ExpiredQuote deadline={quote.deadline} now={now} />
      ) : (
        payment === 'pay' && <PaymentDetails receipt={receipt} view={view} />
      )}
      {view.sendButton !== null && (
        <div className={sendActions}>
          <button
            ref={props.sendButtonRef}
            className={button({ variant: 'primary' })}
            aria-disabled={view.sendButton === 'sending'}
            onClick={props.onSend}
          >
            {view.sendButton === 'sending'
              ? 'Confirm in your wallet…'
              : `Send from ${props.walletName ?? 'wallet'}`}
          </button>
        </div>
      )}
      {payment === 'pay' && panel.kind === 'unknown' && (
        <p className={sendNote}>
          This page could not refresh, so sending from your wallet is paused until it can. You can
          still send manually using the details above.
        </p>
      )}
      {payment === 'pay' && panel.kind === 'no-storage' && (
        <p className={sendNote}>
          Sending from your wallet is turned off because this browser cannot save a record of the
          payment, which is what stops it being sent twice. Send it manually using the details
          above.
        </p>
      )}
      {payment === 'pay' && panel.kind === 'no-lock' && (
        <p className={sendNote}>
          Sending from your wallet is turned off because this browser cannot stop two open tabs from
          sending the same payment. Send it manually using the details above, or use an up-to-date
          browser.
        </p>
      )}
      {view.showResult && (
        <div ref={props.resultRef} tabIndex={-1}>
          {view.record !== null && (
            <SendRecordView
              record={view.record}
              note={view.checkNote}
              now={now}
              onConfirmNothingSent={() => {
                if (view.record !== null) props.onConfirmNothingSent(view.record);
              }}
            />
          )}
          {view.info && (
            <p className={sendStatus} role="status">
              {view.info}
            </p>
          )}
          {view.error && (
            <p className={sendFailure} role="alert">
              {view.error}
            </p>
          )}
        </div>
      )}
      {payment === 'pay' && (
        <p className={refundNote}>
          A different asset, chain or amount will be refunded to {receipt.refundTo}, minus the
          provider’s refund fee.
        </p>
      )}
    </div>
  );
}
