import { useEffect, useRef, useState } from 'react';

import { css, cx } from 'satway-styles/css';
import { actions, button, details, field, notice } from 'satway-styles/recipes';

import {
  type AddressOutput,
  type ReclaimFeeQuote,
  type ReclaimOption,
  type ReclaimPlan,
  type Stage,
  broadcastTransaction,
  buildReclaimPsbt,
  MAINNET_CONFIG as config,
  errorMessage,
  fetchReclaimFeeRate,
  finalizeSignedReclaim,
  findReclaimOption,
  isOutputSpent,
  outpointOf,
  planReclaim,
  toXOnly,
} from '@satway/core';

import {
  type Snapshot,
  StacksWalletDeclinedError,
  type WalletAccount,
  latestRequests,
} from '../../shared/index.js';

const fields = field();

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));

export interface ReclaimParams {
  stacksAddress: string;
  reclaimPublicKey: string;
  reclaimKeyAddress: string | null;
  signersPublicKey: string;
  maxSignerFeeSats: number;
  reclaimLockBlocks: number;
}

interface ReclaimReview {
  output: AddressOutput;
  to: string;
  psbtHex: string;
  fee: ReclaimFeeQuote;
}

function sats(n: number): string {
  return `${n.toLocaleString('en-US')} sats`;
}

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

export function reclaimPlanOf(snapshot: Snapshot, reclaimLockBlocks: number): ReclaimPlan {
  return planReclaim({
    outputs: snapshot.outputs,
    selected: snapshot.payouts.find(o => !o.spent) ?? null,
    tipHeight: snapshot.tipHeight,
    reclaimLockBlocks,
  });
}

export function ReclaimForm(props: {
  deposit: ReclaimParams;
  snapshot: Snapshot;
  stage: Stage | null;
  account: WalletAccount | null;
  signReclaim(psbtHex: string, account: WalletAccount): Promise<Uint8Array>;
  onSent(): Promise<void>;
}) {
  const { deposit, snapshot } = props;
  const [to, setTo] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<ReclaimReview | null>(null);
  const [requests] = useState(latestRequests);
  const reviewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (review !== null) reviewRef.current?.focus();
  }, [review]);

  const plan = reclaimPlanOf(snapshot, deposit.reclaimLockBlocks);
  const choice = chooseOption(plan, chosen);

  async function prepareReclaim() {
    if (!choice || !props.account) return;
    const output = choice.output;
    const isCurrent = requests.current();
    const destination = to.trim();
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      if (toXOnly(props.account.reclaimPublicKey) !== toXOnly(deposit.reclaimPublicKey)) {
        throw new Error(
          deposit.reclaimKeyAddress === null
            ? 'Connect the wallet that made this deposit; it can only be reclaimed with its key.'
            : `Connect the wallet that owns ${deposit.reclaimKeyAddress}; this deposit can only be reclaimed with its key.`
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
      const feeRate = await fetchReclaimFeeRate(config.btcApiUrl);
      const { psbtHex, fee } = buildReclaimPsbt({
        payout: output,
        bitcoinAddress: destination,
        stacksAddress: deposit.stacksAddress,
        reclaimPublicKey: deposit.reclaimPublicKey,
        signersPublicKey: deposit.signersPublicKey,
        maxSignerFeeSats: deposit.maxSignerFeeSats,
        reclaimLockBlocks: deposit.reclaimLockBlocks,
        feeRate,
      });
      if (!isCurrent()) return;
      setReview({ output, to: destination, psbtHex, fee });
    } catch (err) {
      setError(errorMessage(err) ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function signAndSend(current: ReclaimReview) {
    if (!props.account) return;
    const isCurrent = requests.current();
    setBusy(true);
    setError(null);
    try {
      const signed = await props.signReclaim(current.psbtHex, props.account);
      const { txHex, txid } = finalizeSignedReclaim(signed);
      await broadcastTransaction(config.btcApiUrl, txHex);
      setReview(null);
      setMessage(`Reclaim sent for ${outpointOf(current.output)}. Transaction ${txid}.`);
      if (!isCurrent()) return;
      setChosen(null);
      await props.onSent();
    } catch (err) {
      setError(
        err instanceof StacksWalletDeclinedError
          ? 'You declined the request in your wallet, so nothing was signed or broadcast.'
          : (errorMessage(err) ?? null)
      );
    } finally {
      setBusy(false);
    }
  }

  const reclaimable = props.stage === 'reclaimable' || plan.options.some(o => o.ready);
  const nothingLeft = plan.nothingLeft && snapshot.outputs.length > 0;

  return (
    <>
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

      {nothingLeft && (
        <p className={notice()}>
          No unspent BTC is left at this deposit address. There is nothing left to reclaim.
        </p>
      )}

      {reclaimable && (
        <>
          <label className={fields.label}>
            Output to reclaim
            <select
              className={fields.control}
              value={choice ? outpointOf(choice.output) : ''}
              onChange={e => {
                setChosen(e.target.value);
                setReview(null);
              }}
            >
              <option value="" disabled>
                Choose an output
              </option>
              {plan.options.map(o => (
                <option key={outpointOf(o.output)} value={outpointOf(o.output)} disabled={!o.ready}>
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
              onChange={e => {
                setTo(e.target.value);
                setReview(null);
              }}
            />
          </label>
          {review === null ? (
            <div className={actions()}>
              <button
                className={button({ variant: 'primary' })}
                disabled={busy || !to || !props.account || !choice?.ready}
                onClick={() => void prepareReclaim()}
              >
                {busy ? 'Working…' : 'Reclaim BTC'}
              </button>
            </div>
          ) : (
            <div ref={reviewRef} tabIndex={-1}>
              <dl className={details()} aria-label="Reclaim to sign">
                <dt>Output</dt>
                <dd>
                  {sats(review.output.amountSats)}, <code>{outpointOf(review.output)}</code>
                </dd>
                <dt>Network fee rate</dt>
                <dd>{review.fee.feeRate.toLocaleString('en-US')} sat/vB</dd>
                <dt>Network fee</dt>
                <dd>{sats(review.fee.feeSats)}</dd>
                <dt>You receive</dt>
                <dd>
                  {sats(review.fee.netSats)} at <code>{review.to}</code>
                </dd>
              </dl>
              <p className={notice()}>
                Your wallet asks you to sign this transaction next. Nothing is sent until you
                approve it there.
              </p>
              <div className={actions()}>
                <button
                  className={button({ variant: 'primary' })}
                  aria-disabled={busy}
                  onClick={() => {
                    if (!busy) void signAndSend(review);
                  }}
                >
                  {busy ? 'Confirm in your wallet…' : 'Sign and send'}
                </button>
                <button
                  className={button()}
                  disabled={busy}
                  onClick={() => {
                    setReview(null);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {!props.account && (
            <p className={afterActions}>Connect the wallet that made the deposit to reclaim.</p>
          )}
        </>
      )}
    </>
  );
}
