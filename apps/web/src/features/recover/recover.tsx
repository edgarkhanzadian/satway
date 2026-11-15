import { useEffect, useState } from 'react';

import { css, cx } from 'portage-styles/css';
import { styled } from 'portage-styles/jsx';
import { actions, button, details, field, notice, sheet } from 'portage-styles/recipes';

import {
  type ReclaimOption,
  type ReclaimPlan,
  buildReclaimPsbt,
  MAINNET_CONFIG as config,
  errorMessage,
  finalizeSignedReclaim,
  findReclaimOption,
  isOutputSpent,
  outpointOf,
  parseWith,
  planReclaim,
  reclaimAmountProblem,
  z,
} from '@portage/core';

import {
  type Backend,
  type Receipt,
  type Snapshot,
  type WalletAccount,
  checkProgress,
  latestRequests,
  loadReceipts,
  receiptId,
  verifyReceipt,
} from '../../shared/index.js';
import { PayoutDetails, PayoutNotices, type RouteUpdate } from '../../ui/index.js';

const feesSchema = z.looseObject({ halfHourFee: z.number() });

const fields = field();

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));

function chooseOption(plan: ReclaimPlan, chosen: string | null): ReclaimOption | null {
  if (chosen !== null) return findReclaimOption(plan, chosen);
  return plan.target?.ready ? plan.target : null;
}

function optionLabel(o: ReclaimOption): string {
  const amount = `${o.output.amountSats.toLocaleString('en-US')} sats, ${outpointOf(o.output)}`;
  if (o.ready) return `${amount}: reclaimable now`;
  if (o.blocksUntilReclaim === null) return `${amount}: waiting for its first confirmation`;
  return `${amount}: reclaimable in about ${o.blocksUntilReclaim} blocks`;
}

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
  const [to, setTo] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requests] = useState(latestRequests);
  const saved = loadReceipts();

  function clearSelection() {
    setError(null);
    setMessage(null);
    setReceipt(null);
    setSnapshot(null);
    setChosen(null);
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

  const plan = snapshot
    ? planReclaim({
        outputs: snapshot.outputs,
        selected: snapshot.payout,
        tipHeight: snapshot.tipHeight,
        reclaimLockBlocks: receipt?.reclaimLockBlocks ?? config.reclaimLockBlocks,
      })
    : null;
  const choice = plan ? chooseOption(plan, chosen) : null;

  async function reclaim() {
    if (!receipt || !choice || !props.account) return;
    const output = choice.output;
    const isCurrent = requests.current();
    setBusy(true);
    setError(null);
    try {
      if (props.account.reclaimPublicKey !== receipt.reclaimPublicKey) {
        throw new Error(
          `Connect the wallet that owns ${receipt.reclaimKeyAddress}; this deposit can only be reclaimed with its key.`
        );
      }
      if (!choice.ready) {
        throw new Error('The timelock on that output has not passed yet.');
      }
      if (await isOutputSpent(config.btcApiUrl, output.txid, output.vout)) {
        throw new Error(
          'That output has already been spent. Choose another one, if any is listed.'
        );
      }
      const feesUrl = `${config.btcApiUrl}/v1/fees/recommended`;
      const fees = parseWith(feesSchema, await (await fetch(feesUrl)).json(), feesUrl);
      const feeRate = Math.max(1, fees.halfHourFee);
      const tooSmall = reclaimAmountProblem(output.amountSats, feeRate);
      if (tooSmall) throw new Error(tooSmall);
      const { psbtHex } = buildReclaimPsbt({
        payout: output,
        bitcoinAddress: to.trim(),
        stacksAddress: receipt.stacksAddress,
        reclaimPublicKey: receipt.reclaimPublicKey,
        signersPublicKey: receipt.signersPublicKey,
        maxSignerFeeSats: receipt.maxSignerFeeSats,
        reclaimLockBlocks: receipt.reclaimLockBlocks,
        feeRate,
      });
      const signed = await props.signReclaim(psbtHex, props.account);
      const { txHex, txid } = finalizeSignedReclaim(signed);
      const res = await fetch(`${config.btcApiUrl}/tx`, { method: 'POST', body: txHex });
      if (!res.ok)
        throw new Error(`The Bitcoin network rejected the transaction: ${await res.text()}`);
      setMessage(`Reclaim sent for ${outpointOf(output)}. Transaction ${txid}.`);
      if (!isCurrent()) return;
      setChosen(null);
      const next = await checkProgress(config, props.backend, receipt);
      if (isCurrent()) setSnapshot(next);
    } catch (err) {
      setError(errorMessage(err) ?? null);
    } finally {
      setBusy(false);
    }
  }

  const progress = snapshot?.progress;
  const reclaimable =
    plan !== null && (progress?.stage === 'reclaimable' || plan.options.some(o => o.ready));
  const nothingLeft = plan !== null && plan.nothingLeft && (snapshot?.outputs.length ?? 0) > 0;

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
            {snapshot && <PayoutDetails snapshot={snapshot} />}
          </dl>
          {snapshot && <PayoutNotices snapshot={snapshot} />}

          {progress && !progress.terminal && (
            <div className={actions()}>
              <button className={button()} onClick={() => props.onTrack(receipt)}>
                Follow this deposit
              </button>
            </div>
          )}

          {nothingLeft && (
            <p className={notice()}>
              No unspent BTC is left at this deposit address. There is nothing left to reclaim.
            </p>
          )}

          {reclaimable && plan && (
            <>
              <label className={fields.label}>
                Output to reclaim
                <select
                  className={fields.control}
                  value={choice ? outpointOf(choice.output) : ''}
                  onChange={e => setChosen(e.target.value)}
                >
                  <option value="" disabled>
                    Choose an output
                  </option>
                  {plan.options.map(o => (
                    <option
                      key={outpointOf(o.output)}
                      value={outpointOf(o.output)}
                      disabled={!o.ready}
                    >
                      {optionLabel(o)}
                    </option>
                  ))}
                </select>
                <small className={fields.hint}>
                  Each output is reclaimed in its own transaction. Outputs too small to cover the
                  network fee are refused.
                </small>
              </label>
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
                  disabled={busy || !to || !props.account || !choice?.ready}
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
