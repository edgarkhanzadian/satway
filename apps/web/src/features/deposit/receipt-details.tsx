import { actions, button, details, notice } from 'satway-styles/recipes';

import { type Receipt, type Snapshot, type WalletAccount, receiptId } from '../../shared/index.js';
import { PayoutDetails, PayoutNotices, QuotedOutput, RefundNote } from '../../ui/index.js';
import { ReclaimForm } from './reclaim-form.js';

export function ReceiptDetails(props: {
  receipt: Receipt;
  snapshot: Snapshot | null;
  reclaim: boolean;
  account: WalletAccount | null;
  signReclaim(psbtHex: string, account: WalletAccount): Promise<Uint8Array>;
  onFollow(receipt: Receipt): void;
  onRefresh(): Promise<void>;
}) {
  const { receipt, snapshot } = props;
  const progress = snapshot?.progress;
  return (
    <>
      <p className={notice({ tone: 'status' })} role="status">
        {progress?.message ?? 'Checking…'}
      </p>
      <dl className={details()}>
        <dt>sBTC recipient</dt>
        <dd>
          <code>{receipt.stacksAddress}</code>
        </dd>
        <dt>Bitcoin deposit address</dt>
        <dd>
          <code>{receipt.depositAddress}</code>
        </dd>
        <QuotedOutput quote={receipt.quoteResponse.quote} />
        <dt>Reclaim key belongs to</dt>
        <dd>
          <code>{receipt.reclaimKeyAddress}</code>
        </dd>
        {snapshot && <PayoutDetails snapshot={snapshot} />}
      </dl>
      {snapshot?.swap === 'REFUNDED' && (
        <RefundNote
          refund={snapshot.refund}
          refundTo={receipt.refundTo}
          symbol={receipt.origin.symbol}
          chain={receipt.origin.chain}
        />
      )}
      {snapshot && <PayoutNotices snapshot={snapshot} />}

      {progress && !progress.terminal && (
        <div className={actions()}>
          <button className={button()} onClick={() => props.onFollow(receipt)}>
            Follow this deposit
          </button>
        </div>
      )}

      {snapshot && (
        <ReclaimForm
          key={receiptId(receipt)}
          deposit={receipt}
          snapshot={snapshot}
          stage={progress?.stage ?? null}
          account={props.account}
          focus={props.reclaim}
          signReclaim={props.signReclaim}
          onSent={props.onRefresh}
        />
      )}
    </>
  );
}
