import { useEffect, useState } from 'react';

import { css, cx } from 'stxonector-styles/css';
import { styled } from 'stxonector-styles/jsx';
import { actions, button, details, field, notice, sheet } from 'stxonector-styles/recipes';

import {
  buildReclaimPsbt,
  MAINNET_CONFIG as config,
  errorMessage,
  finalizeSignedReclaim,
  isOutputSpent,
  parseWith,
  z,
} from '@stxonector/core';

import { type Backend, type Snapshot, checkProgress } from './flow.js';
import { type Receipt, loadReceipts, verifyReceipt } from './receipt.js';
import type { RouteUpdate } from './route.js';
import { type WalletAccount, signReclaimWithWallet } from './wallet.js';

const feesSchema = z.looseObject({ halfHourFee: z.number() });

const fields = field();

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));

export function Recover(props: {
  backend: Backend;
  account: WalletAccount | null;
  onTrack(r: Receipt): void;
  onRoute(route: RouteUpdate | null): void;
}) {
  const { onRoute } = props;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [to, setTo] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = loadReceipts();

  async function open(value: unknown) {
    setError(null);
    setMessage(null);
    setSnapshot(null);
    try {
      const verified = verifyReceipt(value);
      setReceipt(verified);
      setSnapshot(await checkProgress(config, props.backend, verified));
    } catch (err) {
      setReceipt(null);
      setError(errorMessage(err) ?? null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      await open(JSON.parse(await file.text()));
    } catch {
      setError('That file is not a deposit receipt.');
    }
  }

  async function reclaim() {
    if (!receipt || !snapshot?.payout || !props.account) return;
    setBusy(true);
    setError(null);
    try {
      if (props.account.reclaimPublicKey !== receipt.reclaimPublicKey) {
        throw new Error(
          `Connect the wallet that owns ${receipt.reclaimKeyAddress}; this deposit can only be reclaimed with its key.`
        );
      }
      if (await isOutputSpent(config.btcApiUrl, snapshot.payout.txid, snapshot.payout.vout)) {
        throw new Error('That Bitcoin has already moved. There is nothing left to reclaim.');
      }
      const feesUrl = `${config.btcApiUrl}/v1/fees/recommended`;
      const fees = parseWith(feesSchema, await (await fetch(feesUrl)).json(), feesUrl);
      const { psbtHex } = buildReclaimPsbt({
        payout: snapshot.payout,
        bitcoinAddress: to.trim(),
        stacksAddress: receipt.stacksAddress,
        reclaimPublicKey: receipt.reclaimPublicKey,
        signersPublicKey: receipt.signersPublicKey,
        maxSignerFeeSats: receipt.maxSignerFeeSats,
        reclaimLockBlocks: receipt.reclaimLockBlocks,
        feeRate: Math.max(1, fees.halfHourFee),
      });
      const signed = await signReclaimWithWallet(psbtHex, props.account);
      const { txHex, txid } = finalizeSignedReclaim(signed);
      const res = await fetch(`${config.btcApiUrl}/tx`, { method: 'POST', body: txHex });
      if (!res.ok)
        throw new Error(`The Bitcoin network rejected the transaction: ${await res.text()}`);
      setMessage(`Reclaim sent. Transaction ${txid}.`);
    } catch (err) {
      setError(errorMessage(err) ?? null);
    } finally {
      setBusy(false);
    }
  }

  const progress = snapshot?.progress;
  const reclaimable = progress?.stage === 'reclaimable';

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
              <option key={r.depositAddress} value={i}>
                {r.quoteResponse.quote.amountInFormatted} {r.origin.symbol}, started{' '}
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
      {message && (
        <p className={notice({ tone: 'status' })} role="status">
          {message}
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
            <dt>Reclaim key belongs to</dt>
            <dd>
              <code>{receipt.reclaimKeyAddress}</code>
            </dd>
            {snapshot?.payout && (
              <>
                <dt>Bitcoin payout</dt>
                <dd>
                  {snapshot.payout.amountSats.toLocaleString('en-US')} sats in{' '}
                  <code>{snapshot.payout.txid}</code>
                </dd>
              </>
            )}
          </dl>

          {progress && !progress.terminal && (
            <div className={actions()}>
              <button className={button()} onClick={() => props.onTrack(receipt)}>
                Follow this deposit
              </button>
            </div>
          )}

          {reclaimable && (
            <>
              <label className={fields.label}>
                Send the reclaimed BTC to
                <input
                  className={fields.control}
                  value={to}
                  spellCheck={false}
                  placeholder="A Bitcoin address you control"
                  onChange={e => setTo(e.target.value)}
                />
              </label>
              <div className={actions()}>
                <button
                  className={button({ variant: 'primary' })}
                  disabled={busy || !to || !props.account}
                  onClick={() => void reclaim()}
                >
                  {busy ? 'Working…' : 'Reclaim BTC'}
                </button>
              </div>
              {!props.account && (
                <p className={afterActions}>Connect the wallet that made the deposit to reclaim.</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
