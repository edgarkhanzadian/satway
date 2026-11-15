import { useState } from 'react';

import { styled } from 'satway-styles/jsx';
import { actions, button, details, field, notice, sheet } from 'satway-styles/recipes';

import { MAINNET_WITHDRAWAL_FLOW_CONFIG as config, errorMessage } from '@satway/core';

import {
  type Backend,
  type WithdrawalReceiptFile,
  type WithdrawalSnapshot,
  checkWithdrawal,
  latestRequests,
  loadWithdrawals,
  verifyWithdrawalReceipt,
  withdrawalAdvice,
  withdrawalId,
} from '../../shared/index.js';
import { sats } from './flow.js';

const fields = field();

function optionLabel(r: WithdrawalReceiptFile): string {
  const started = new Date(r.createdAt).toLocaleString();
  const sent = r.stacksTxid === null ? ', not confirmed as sent' : '';
  return `${sats(r.amountSats)} to ${r.destination.symbol} on ${r.destination.chain}, started ${started}${sent}`;
}

export function FollowWithdrawal(props: {
  backend: Backend;
  onTrack(receipt: WithdrawalReceiptFile): void;
}) {
  const [receipt, setReceipt] = useState<WithdrawalReceiptFile | null>(null);
  const [snapshot, setSnapshot] = useState<WithdrawalSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests] = useState(latestRequests);
  const saved = loadWithdrawals(config);

  async function open(value: unknown, isLatest: () => boolean = requests.begin()) {
    setError(null);
    setReceipt(null);
    setSnapshot(null);
    try {
      const verified = verifyWithdrawalReceipt(config, value);
      setReceipt(verified);
      if (verified.stacksTxid === null) return;
      const next = await checkWithdrawal(config, props.backend, verified, verified.stacksTxid);
      if (isLatest()) setSnapshot(next);
    } catch (err) {
      if (!isLatest()) return;
      setReceipt(null);
      setError(errorMessage(err) ?? 'That receipt could not be read.');
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const isLatest = requests.begin();
    setError(null);
    setReceipt(null);
    setSnapshot(null);
    let value: unknown;
    try {
      value = JSON.parse(await file.text());
    } catch {
      if (isLatest()) setError('That file is not a withdrawal receipt.');
      return;
    }
    if (isLatest()) await open(value, isLatest);
  }

  const progress = snapshot?.observation.progress ?? null;

  return (
    <section className={sheet()} aria-labelledby="follow-withdrawal-title">
      <styled.h2 id="follow-withdrawal-title" textStyle="heading" marginBottom="space.06">
        Follow a withdrawal
      </styled.h2>
      <p className={notice()}>
        Load the withdrawal receipt file that was downloaded when you signed. It is read in your
        browser and not uploaded.
      </p>

      <label className={fields.label}>
        Withdrawal receipt (JSON)
        <input
          className={fields.control}
          type="file"
          accept="application/json,.json"
          onChange={e => void onFile(e.target.files?.[0])}
        />
      </label>

      {saved.length > 0 && (
        <label className={fields.label}>
          Or pick a withdrawal remembered by this browser
          <select
            className={fields.control}
            defaultValue=""
            onChange={e => {
              const r = saved[Number(e.target.value)];
              if (r) void open(r);
            }}
          >
            <option value="" disabled>
              Choose a withdrawal
            </option>
            {saved.map((r, i) => (
              <option key={withdrawalId(r)} value={i}>
                {optionLabel(r)}
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
            {receipt.stacksTxid === null
              ? 'This browser never got a transaction ID from the wallet for this withdrawal.'
              : (progress?.message ?? 'Checking…')}
          </p>
          {progress && <p>{withdrawalAdvice(progress.stage, receipt)}</p>}
          <dl className={details()}>
            <dt>You withdraw</dt>
            <dd>{sats(receipt.amountSats)} of sBTC</dd>
            <dt>To</dt>
            <dd>
              {receipt.destination.symbol} on {receipt.destination.chain},{' '}
              <code>{receipt.destination.address}</code>
            </dd>
            <dt>Swap address</dt>
            <dd>
              <code>{receipt.depositAddress}</code>
            </dd>
          </dl>
          <div className={actions()}>
            <button className={button()} onClick={() => props.onTrack(receipt)}>
              Follow this withdrawal
            </button>
          </div>
        </>
      )}
    </section>
  );
}
