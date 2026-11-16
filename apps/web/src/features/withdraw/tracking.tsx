import { type ReactNode, useEffect, useRef, useState } from 'react';

import { css, cx } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { actions, button, details, field, notice, sheet } from 'satway-styles/recipes';

import {
  type WithdrawalStatus,
  checkPastedWithdrawalTransaction,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
  errorMessage,
  normalizeStacksTxid,
} from '@satway/core';

import {
  type Backend,
  type WithdrawalReceiptFile,
  type WithdrawalSnapshot,
  checkWithdrawal,
  downloadWithdrawalReceipt,
  latestRequests,
  withStacksTxid,
  withdrawalAdvice,
  withdrawalHeading,
} from '../../shared/index.js';
import { RefundNote, type WithdrawalRouteUpdate, WithdrawalSteps } from '../../ui/index.js';
import { formatTokenAmount, sats } from './flow.js';

const fields = field();

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));
const advice = css({ marginTop: 'space.06' });

export const POLL_INTERVAL_MS = 20_000;
export const SETTLED_POLL_INTERVAL_MS = 120_000;

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
  receipt: WithdrawalReceiptFile;
  receiptUnsaved: boolean;
  walletPrompt: boolean;
  onRoute(route: WithdrawalRouteUpdate | null): void;
  onReceipt(receipt: WithdrawalReceiptFile): void;
  onDiscard(receipt: WithdrawalReceiptFile): void;
  onDone(): void;
}) {
  const { receipt } = props;
  if (receipt.stacksTxid === null && props.walletPrompt) {
    return <WaitingForWallet receipt={receipt} onRoute={props.onRoute} />;
  }
  if (receipt.stacksTxid === null) {
    return (
      <UnconfirmedSignature
        receipt={receipt}
        onRoute={props.onRoute}
        onReceipt={props.onReceipt}
        onDiscard={props.onDiscard}
      />
    );
  }
  return <Following {...props} stacksTxid={receipt.stacksTxid} />;
}

function WaitingForWallet(props: {
  receipt: WithdrawalReceiptFile;
  onRoute(route: WithdrawalRouteUpdate | null): void;
}) {
  const { receipt, onRoute } = props;

  useEffect(() => {
    onRoute({ destination: destinationOf(receipt), milestones: null });
  }, [onRoute, receipt]);

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
        <ReceiptFacts receipt={receipt} />
      </dl>
    </section>
  );
}

function TxidEntry(props: {
  receipt: WithdrawalReceiptFile;
  onReceipt(receipt: WithdrawalReceiptFile): void;
  children?: ReactNode;
}) {
  const { receipt } = props;
  const [txid, setTxid] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [requests] = useState(latestRequests);

  async function follow() {
    let id: string;
    try {
      id = normalizeStacksTxid(txid);
    } catch {
      setError('That is not a Stacks transaction ID. It is 64 hex characters, often with 0x.');
      return;
    }
    const isLatest = requests.begin();
    setChecking(true);
    setError(null);
    try {
      const check = await checkPastedWithdrawalTransaction(config, id, {
        sender: receipt.sender,
        amountSats: receipt.amountSats,
        maxFeeSats: receipt.maxFeeSats,
        recipient: receipt.recipient,
      });
      if (!isLatest()) return;
      if (check.kind === 'matches') {
        props.onReceipt(withStacksTxid(receipt, check.stacksTxid));
        return;
      }
      setError(
        check.kind === 'not-found'
          ? 'Stacks does not know this transaction yet. If your wallet sent it just now, wait a minute and try again.'
          : `That transaction is not this withdrawal. ${check.message} Check the ID in your wallet’s activity.`
      );
    } catch (err) {
      if (isLatest()) {
        setError(
          `Could not check that transaction: ${errorMessage(err) ?? 'unknown error'}. Try again.`
        );
      }
    } finally {
      if (isLatest()) setChecking(false);
    }
  }

  return (
    <>
      <label className={fields.label}>
        Stacks transaction ID
        <input
          className={fields.control}
          value={txid}
          spellCheck={false}
          placeholder="0x…"
          onChange={e => {
            requests.cancel();
            setChecking(false);
            setTxid(e.target.value);
            setError(null);
          }}
        />
      </label>
      {error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {error}
        </p>
      )}
      <div className={actions()}>
        <button
          className={button({ variant: 'primary' })}
          disabled={!txid}
          aria-disabled={checking}
          onClick={() => {
            if (!checking) void follow();
          }}
        >
          {checking ? 'Checking…' : 'Follow this transaction'}
        </button>
        {props.children}
      </div>
    </>
  );
}

function UnconfirmedSignature(props: {
  receipt: WithdrawalReceiptFile;
  onRoute(route: WithdrawalRouteUpdate | null): void;
  onReceipt(receipt: WithdrawalReceiptFile): void;
  onDiscard(receipt: WithdrawalReceiptFile): void;
}) {
  const { receipt, onRoute } = props;

  useEffect(() => {
    onRoute({ destination: destinationOf(receipt), milestones: null });
  }, [onRoute, receipt]);

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
      <TxidEntry receipt={receipt} onReceipt={props.onReceipt}>
        <button className={button()} onClick={() => props.onDiscard(receipt)}>
          Nothing was sent. Discard it
        </button>
      </TxidEntry>
      <dl className={details()}>
        <ReceiptFacts receipt={receipt} />
      </dl>
    </section>
  );
}

function mayBeTheWrongTransaction(status: WithdrawalStatus | null): boolean {
  if (status === null) return false;
  if (status.kind === 'mismatch') return status.requestId === null;
  return status.kind === 'unknown-tx' || status.kind === 'not-a-withdrawal';
}

function Following(props: {
  backend: Backend;
  receipt: WithdrawalReceiptFile;
  stacksTxid: string;
  receiptUnsaved: boolean;
  onRoute(route: WithdrawalRouteUpdate | null): void;
  onReceipt(receipt: WithdrawalReceiptFile): void;
  onDone(): void;
}) {
  const { backend, receipt, stacksTxid, onRoute } = props;
  const [snapshot, setSnapshot] = useState<WithdrawalSnapshot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onReceiptRef = useRef(props.onReceipt);
  onReceiptRef.current = props.onReceipt;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let softMismatches = 0;
    let delay = POLL_INTERVAL_MS;
    setSnapshot(null);
    setProblem(null);
    setChanging(false);
    async function tick() {
      try {
        const next = await checkWithdrawal(
          config,
          backend,
          receipt,
          stacksTxid,
          undefined,
          softMismatches
        );
        if (!live) return;
        softMismatches = next.observation.facts.softMismatches;
        const followed = next.observation.facts.stacksTxid;
        if (followed !== stacksTxid) {
          onReceiptRef.current(withStacksTxid(receipt, followed));
          return;
        }
        setSnapshot(next);
        setProblem(null);
        const progress = next.observation.progress;
        if (progress.stage === 'done' || progress.stage === 'mismatch') return;
        delay = progress.terminal ? SETTLED_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
      } catch (err) {
        if (!live) return;
        setProblem(`Could not refresh: ${errorMessage(err) ?? 'unknown error'}. Retrying.`);
      }
      timer = setTimeout(() => void tick(), delay);
    }
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [backend, receipt, stacksTxid]);

  const milestones = snapshot?.milestones ?? null;
  useEffect(() => {
    onRoute({ destination: destinationOf(receipt), milestones });
  }, [onRoute, receipt, milestones]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const observation = snapshot?.observation ?? null;
  const progress = observation?.progress ?? null;
  const facts = observation?.facts ?? null;
  const stage = progress?.stage ?? null;
  const changeable = mayBeTheWrongTransaction(observation?.stacks ?? null);

  return (
    <section className={sheet()}>
      <styled.h2 ref={headingRef} tabIndex={-1} textStyle="heading" marginBottom="space.06">
        {withdrawalHeading(stage)}
      </styled.h2>

      {props.receiptUnsaved && (
        <p className={notice({ tone: 'warn' })} role="alert">
          This browser could not keep a copy of the receipt, so the file that was just downloaded is
          the only copy. Keep it: it is how you follow this withdrawal later.
        </p>
      )}

      <p className={notice({ tone: 'status' })} role="status">
        {progress?.message ?? 'Checking…'}
      </p>
      {stage !== null && <p className={advice}>{withdrawalAdvice(stage, receipt)}</p>}
      {problem && <p className={notice()}>{problem}</p>}
      {snapshot?.swapError && !progress?.terminal && (
        <p className={notice()}>
          Could not read the swap status right now ({snapshot.swapError}). Checking again shortly.
        </p>
      )}
      {stage === 'mismatch' && facts && facts.mismatches.length > 0 && (
        <ul className={notice({ tone: 'warn' })}>
          {facts.mismatches.map(m => (
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
          <code>0x{stacksTxid}</code>
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

      {changing && changeable && (
        <section aria-labelledby="change-transaction">
          <styled.h3 id="change-transaction" textStyle="emphasis" marginTop="space.10">
            Change the transaction
          </styled.h3>
          <p className={advice}>
            Paste the ID of the Stacks transaction your wallet sent for this withdrawal. It is
            checked before it replaces the one above.
          </p>
          <TxidEntry receipt={receipt} onReceipt={props.onReceipt}>
            <button className={button()} onClick={() => setChanging(false)}>
              Cancel
            </button>
          </TxidEntry>
        </section>
      )}

      <div className={actions()}>
        {changeable && !changing && (
          <button className={button()} onClick={() => setChanging(true)}>
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
        You can close this page. The withdrawal continues, and you can follow it later from the
        Recover tab or by loading the receipt file.
      </p>
    </section>
  );
}
