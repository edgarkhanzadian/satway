import { useEffect, useState } from 'react';

import { styled } from 'satway-styles/jsx';
import { actions, button, details, field, notice, sheet } from 'satway-styles/recipes';

import { type FoundDeposit, MAINNET_CONFIG as config, errorMessage } from '@satway/core';

import {
  type Backend,
  type Receipt,
  type Snapshot,
  type WalletAccount,
  checkProgress,
  latestRequests,
  loadReceipts,
  receiptId,
  sendAmountOf,
  sendAmountText,
  verifyReceipt,
} from '../../shared/index.js';
import {
  PayoutDetails,
  PayoutNotices,
  QuotedOutput,
  RefundNote,
  type RouteUpdate,
} from '../../ui/index.js';
import { FindDeposits, FoundDepositView } from './find-deposits.js';
import { ReclaimForm } from './reclaim-form.js';

const fields = field();

export function Recover(props: {
  backend: Backend;
  account: WalletAccount | null;
  onTrack(r: Receipt): void;
  onRoute(route: RouteUpdate | null): void;
  signReclaim(psbtHex: string, account: WalletAccount): Promise<Uint8Array>;
}) {
  const { onRoute } = props;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [found, setFound] = useState<FoundDeposit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests] = useState(latestRequests);
  const saved = loadReceipts();

  function clearSelection() {
    setError(null);
    setReceipt(null);
    setSnapshot(null);
    setFound(null);
  }

  async function open(value: unknown, isLatest: () => boolean = requests.begin()) {
    clearSelection();
    try {
      const verified = verifyReceipt(value);
      setReceipt(verified);
      const next = await checkProgress(config, props.backend, verified);
      if (isLatest()) setSnapshot(next);
    } catch (err) {
      if (!isLatest()) return;
      setReceipt(null);
      setError(errorMessage(err) ?? null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const isLatest = requests.begin();
    clearSelection();
    let value: unknown;
    try {
      value = JSON.parse(await file.text());
    } catch {
      if (isLatest()) setError('That file is not a deposit receipt.');
      return;
    }
    if (isLatest()) await open(value, isLatest);
  }

  async function refresh(current: Receipt) {
    const isCurrent = requests.current();
    const next = await checkProgress(config, props.backend, current);
    if (isCurrent()) setSnapshot(next);
  }

  function pickFound(deposit: FoundDeposit) {
    requests.begin();
    clearSelection();
    setFound(deposit);
  }

  const progress = snapshot?.progress;
  const stage = progress?.stage ?? null;
  useEffect(() => {
    onRoute(
      receipt
        ? { origin: `${receipt.origin.symbol} on ${receipt.origin.chain}`, deposit: { stage } }
        : null
    );
  }, [onRoute, receipt, stage]);
  useEffect(() => () => onRoute(null), [onRoute]);

  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        Check or recover a deposit
      </styled.h2>
      <p className={notice()}>
        Load the receipt file you downloaded when you started the deposit. Nothing is uploaded; it
        is read in your browser.
      </p>

      <label className={fields.label}>
        Receipt file
        <input
          className={fields.control}
          type="file"
          accept="application/json,.json"
          onChange={e => void onFile(e.target.files?.[0])}
        />
      </label>

      {saved.length > 0 && (
        <label className={fields.label}>
          Or pick one remembered by this browser
          <select
            className={fields.control}
            defaultValue=""
            onChange={e => {
              const r = saved[Number(e.target.value)];
              if (r) void open(r);
            }}
          >
            <option value="" disabled>
              Choose a deposit
            </option>
            {saved.map((r, i) => (
              <option key={receiptId(r)} value={i}>
                {sendAmountText(sendAmountOf(r), r.origin.symbol)}, started{' '}
                {new Date(r.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {error}
        </p>
      )}

      {receipt && (
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
              <button className={button()} onClick={() => props.onTrack(receipt)}>
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
              signReclaim={props.signReclaim}
              onSent={() => refresh(receipt)}
            />
          )}
        </>
      )}

      <FindDeposits account={props.account} selected={found} onSelect={pickFound} />
      {found && (
        <FoundDepositView
          key={found.depositAddress}
          deposit={found}
          account={props.account}
          signReclaim={props.signReclaim}
        />
      )}
    </section>
  );
}
