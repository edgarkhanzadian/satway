import { css, cx } from 'satway-styles/css';
import { actions, button, notice } from 'satway-styles/recipes';

import {
  type SendRecord,
  WALLET_PROMPT_WINDOW_MS,
  canResendSigned,
  needsConfirmation,
  promptWaitMs,
  recordTx,
} from '@satway/chains';

const sendStatus = cx(notice({ tone: 'status' }), css({ marginBlock: 'space.06' }));
const uncertainBox = cx(notice({ tone: 'warn' }), css({ marginBlock: 'space.06' }));
const uncertainLine = css({ marginBlock: 'space.02' });
const uncertainActions = cx(actions(), css({ marginTop: 'space.06' }));

function headline(record: SendRecord): string {
  if (record.state === 'attempting')
    return 'A payment from your wallet was started for this swap, in this tab or another one, and this page has not heard back from the wallet.';
  return 'Your wallet may have sent this payment, but this page could not confirm it.';
}

export function SendRecordView(props: {
  record: SendRecord;
  note: string | null;
  resending: boolean;
  now: Date;
  onResend(): void;
  onConfirmNothingSent(): void;
}) {
  const { record } = props;
  const tx = recordTx(record);
  const promptOpen = promptWaitMs(record, props.now) > 0;
  const confirmable = needsConfirmation(record) && !promptOpen;
  if (record.state === 'sent') {
    return (
      <p className={sendStatus} role="status">
        {tx ? (
          <>
            Sent from your wallet. Transaction <code>{tx}</code>. Do not send again.
          </>
        ) : (
          'A payment has been recorded for this swap. Do not send again.'
        )}
      </p>
    );
  }
  return (
    <div className={uncertainBox} role="status">
      <p className={uncertainLine}>{headline(record)}</p>
      {record.state === 'uncertain' && (
        <p className={uncertainLine}>What happened: {record.message}</p>
      )}
      {tx && (
        <p className={uncertainLine}>
          {record.family === 'solana' ? 'Signature' : 'Transaction'} <code>{tx}</code>
        </p>
      )}
      <p className={uncertainLine}>
        Check your wallet’s activity before doing anything else. Do not send again, from this wallet
        or any other, unless you are sure nothing left your wallet.
      </p>
      {props.note && <p className={uncertainLine}>{props.note}</p>}
      {promptOpen && needsConfirmation(record) && (
        <p className={uncertainLine}>
          The request may still be open in your wallet, in this browser or on your phone. Approve or
          reject it there. If your wallet shows no request, this page lets you start again{' '}
          {WALLET_PROMPT_WINDOW_MS / 60_000} minutes after the payment was started.
        </p>
      )}
      {(canResendSigned(record) || confirmable) && (
        <div className={uncertainActions}>
          {canResendSigned(record) && (
            <button className={button()} disabled={props.resending} onClick={props.onResend}>
              {props.resending ? 'Sending…' : 'Send the same signed transaction again'}
            </button>
          )}
          {confirmable && (
            <button className={button()} onClick={props.onConfirmNothingSent}>
              I checked my wallet and nothing was sent. Let me try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
