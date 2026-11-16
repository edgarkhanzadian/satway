import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { css, cx } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { actions, button, details, notice, sheet } from 'satway-styles/recipes';

import {
  type AttemptOutcome,
  type SendRecord,
  type SourceWallet,
  attemptSend,
  buildEvmTransfer,
  confirmNothingSent,
  evmTransactionState,
  isEvmChain,
  needsChainCheck,
  promptWaitMs,
  quoteExpired,
  recordTx,
  releaseIfCleared,
  resolveRecord,
  sendFromEvm,
  sendPanel,
  settleFromProvider,
  swapTargetOf,
  walletCovers,
  watchSendRecords,
} from '@satway/chains';
import { type OneClickToken, MAINNET_CONFIG as config, errorMessage } from '@satway/core';

import {
  type ActiveDeposit,
  type Backend,
  type BackgroundRegistration,
  ProgressReadError,
  type Receipt,
  type Snapshot,
  type SwapReading,
  type WalletAccount,
  checkProgress,
  downloadReceipt,
  paymentView,
  sendAmountOf,
  sendAmountText,
  sendRecords,
} from '../../shared/index.js';
import {
  PayoutDetails,
  PayoutNotices,
  QuotedOutput,
  RefundNote,
  type RouteUpdate,
  SendRecordView,
} from '../../ui/index.js';
import {
  type RegistrationState,
  closingNote,
  keepRegistering,
  registeredThisSession,
} from './background-registration.js';
import { DepositForm } from './deposit-form.js';
import { depositOrigins } from './flow.js';
import { useDepositForm } from './use-deposit-form.js';

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));
const afterActionsWarn = cx(notice({ tone: 'warn' }), css({ marginTop: 'space.08' }));

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

export function Deposit(props: {
  backend: Backend;
  account: WalletAccount | null;
  source: SourceWallet | null;
  active: ActiveDeposit | null;
  onActive(active: ActiveDeposit | null): void;
  onRoute(route: RouteUpdate | null): void;
}) {
  const { backend, account, source, active, onActive, onRoute } = props;
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenAttempt, setTokenAttempt] = useState(0);

  useEffect(() => {
    async function loadTokens() {
      try {
        const all = await backend.tokens();
        setTokens(depositOrigins(all, config.btcAssetId));
        setTokenError(null);
      } catch (err) {
        setTokenError(`Could not load the asset list: ${errorMessage(err)}`);
      }
    }
    void loadTokens();
  }, [backend, tokenAttempt]);

  const form = useDepositForm({ backend, account, source, tokens, onActive });
  const token = form.token;

  useEffect(() => {
    if (active) return;
    onRoute({ origin: token ? `${token.symbol} on ${token.blockchain}` : null, deposit: null });
  }, [onRoute, token, active]);
  useEffect(() => () => onRoute(null), [onRoute]);

  if (active) {
    return (
      <Tracking
        backend={backend}
        receipt={active.receipt}
        receiptUnsaved={active.receiptUnsaved}
        firstRegistration={active.firstRegistration}
        source={source}
        token={tokens.find(t => t.assetId === active.receipt.origin.assetId)}
        onRoute={onRoute}
        onDone={() => onActive(null)}
      />
    );
  }

  if (!account) return null;

  return (
    <DepositForm
      account={account}
      tokens={tokens}
      tokenError={tokenError}
      onRetryTokens={() => {
        setTokenError(null);
        setTokenAttempt(attempt => attempt + 1);
      }}
      form={form}
    />
  );
}

function Tracking(props: {
  backend: Backend;
  receipt: Receipt;
  receiptUnsaved: boolean;
  firstRegistration: BackgroundRegistration | null | undefined;
  source: SourceWallet | null;
  token: OneClickToken | undefined;
  onRoute(route: RouteUpdate | null): void;
  onDone(): void;
}) {
  const { backend, receipt, source, token, onRoute } = props;
  const [registration, setRegistration] = useState<RegistrationState>(() =>
    props.firstRegistration?.kind === 'registered'
      ? { kind: 'registered' }
      : { kind: 'registering' }
  );
  const firstRegistrationRef = useRef(props.firstRegistration);
  const stopRegistrationRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const swapAddress = receipt.quoteResponse.quote.depositAddress;
    if (!swapAddress) return;
    const first = firstRegistrationRef.current;
    firstRegistrationRef.current = undefined;
    const stop = keepRegistering(
      () => backend.register(receipt.depositScript, receipt.reclaimScript, swapAddress),
      {
        ...(first === undefined ? {} : { first }),
        known: { swaps: registeredThisSession, swapAddress },
        onState: setRegistration,
      }
    );
    stopRegistrationRef.current = stop;
    return stop;
  }, [backend, receipt]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [reading, setReading] = useState<SwapReading | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const sendButtonRef = useRef<HTMLButtonElement>(null);
  const sendResultRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLParagraphElement>(null);
  const [focusAfterSend, setFocusAfterSend] = useState(0);

  useEffect(() => {
    if (focusAfterSend === 0) return;
    const button = sendButtonRef.current;
    if (button !== null && document.activeElement === button) return;
    (sendResultRef.current ?? progressRef.current)?.focus();
  }, [focusAfterSend]);
  const evmOrigin = isEvmChain(receipt.origin.chain);
  const quote = receipt.quoteResponse.quote;
  const target = useMemo(
    () => swapTargetOf(quote.depositAddress, quote.depositMemo),
    [quote.depositAddress, quote.depositMemo]
  );
  const readRecord = useCallback(
    () => (target && evmOrigin ? sendRecords.read(target) : null),
    [target, evmOrigin]
  );
  const [record, setRecord] = useState<SendRecord | null>(readRecord);
  const [durable] = useState(() => sendRecords.durable());
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendInfo, setSendInfo] = useState<string | null>(null);
  const [checkNote, setCheckNote] = useState<string | null>(null);

  useEffect(() => {
    setRecord(readRecord());
    return watchSendRecords(window, () => setRecord(readRecord()));
  }, [readRecord]);

  useEffect(() => {
    if (record !== null || sending || !target || !evmOrigin) return;
    releaseIfCleared(sendRecords, target);
  }, [record, sending, target, evmOrigin]);

  useEffect(() => {
    if (!reading || sendingRef.current) return;
    setRecord(settleFromProvider(sendRecords, readRecord(), reading.swap));
  }, [reading, readRecord]);

  const [promptTick, setPromptTick] = useState(0);
  const promptOpen = record !== null && promptWaitMs(record, new Date()) > 0;
  useEffect(() => {
    if (record === null || !promptOpen) return;
    const timer = setTimeout(
      () => setPromptTick(tick => tick + 1),
      promptWaitMs(record, new Date()) + 100
    );
    return () => clearTimeout(timer);
  }, [record, promptOpen, promptTick]);

  const recordStamp = record ? `${record.state}|${record.startedAt}|${recordTx(record) ?? ''}` : '';
  const checkable = record !== null && needsChainCheck(record);
  const evmProvider = source?.provider ?? null;

  useEffect(() => {
    if (!checkable || sending) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function evmState(hash: string) {
      if (!evmProvider)
        return Promise.reject(new Error('connect the wallet you sent from to check it'));
      return evmTransactionState(evmProvider, hash);
    }
    async function check() {
      const current = readRecord();
      if (current === null || !needsChainCheck(current)) return;
      try {
        const result = await resolveRecord(sendRecords, current, evmState);
        if (!live) return;
        if (result.kind === 'cleared') setSendInfo(result.message);
        setCheckNote(result.kind === 'unchanged' ? result.note : null);
        setRecord(readRecord());
      } catch (err) {
        if (live)
          setCheckNote(
            `Could not check the transaction: ${errorMessage(err) ?? 'unknown error'}. Retrying.`
          );
      }
      if (live) timer = setTimeout(() => void check(), 15_000);
    }
    void check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [checkable, recordStamp, sending, readRecord, evmProvider]);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSnapshot(null);
    setReading(undefined);
    setStale(false);
    setProblem(null);
    let known: Snapshot['mints'] | undefined;
    async function tick() {
      try {
        const next = await checkProgress(config, backend, receipt, undefined, known);
        if (!live) return;
        known = next.mints;
        setSnapshot(next);
        setReading({ swap: next.swap, remaining: next.remaining });
        setStale(false);
        setProblem(null);
        if (next.progress.terminal) return;
      } catch (err) {
        if (!live) return;
        setReading(
          err instanceof ProgressReadError ? err.reading : { swap: null, remaining: null }
        );
        setStale(true);
        setProblem(`Could not refresh: ${errorMessage(err)}. Retrying.`);
      }
      timer = setTimeout(() => void tick(), 20_000);
    }
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [backend, receipt]);

  const progress = snapshot?.progress;
  const stage = progress?.stage ?? null;
  const terminal = progress?.terminal ?? false;
  useEffect(() => {
    if (terminal) stopRegistrationRef.current();
  }, [terminal]);
  const closable = terminal || registration.kind === 'registered';
  useEffect(() => {
    onRoute({ origin: `${receipt.origin.symbol} on ${receipt.origin.chain}`, deposit: { stage } });
  }, [onRoute, receipt, stage]);

  const payment = paymentView(
    reading,
    snapshot !== null && !stale ? snapshot.progress.stage : null
  );
  const shortDeposit = reading?.swap === 'INCOMPLETE_DEPOSIT';
  const owed =
    shortDeposit && reading.remaining !== null ? sendAmountOf(receipt, reading.remaining) : null;
  const sendAmount = owed ?? sendAmountOf(receipt);
  const walletReady =
    evmOrigin &&
    target !== null &&
    token !== undefined &&
    token.blockchain === receipt.origin.chain &&
    walletCovers(source, token);
  const now = new Date();
  const expired = quoteExpired(quote.deadline, now);
  const panel = sendPanel({
    swap: stale ? null : reading?.swap,
    record,
    walletCanSend: walletReady,
    sending,
    durable: durable || !walletReady,
    lockable: sendRecords.lockable() || !walletReady,
    expired,
  });

  function showOutcome(outcome: AttemptOutcome) {
    if (outcome.kind === 'refused') setSendError(outcome.message);
    if (outcome.kind === 'cleared')
      setSendError(
        outcome.rejected
          ? 'The request was rejected in your wallet, so nothing was sent.'
          : outcome.message
      );
  }

  async function sendFromWallet() {
    const wallet = source;
    if (!token || !target || !wallet || sendingRef.current) return;
    if (quoteExpired(quote.deadline, new Date())) {
      setSendError('This quote has expired, so the wallet was not asked to send.');
      return;
    }
    const keepFocus =
      sendButtonRef.current !== null && document.activeElement === sendButtonRef.current;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    setSendInfo(null);
    setCheckNote(null);
    try {
      const transfer = buildEvmTransfer({
        token,
        from: wallet.address,
        to: target.address,
        amount: quote.amountIn,
      });
      showOutcome(
        await attemptSend(sendRecords, { target, account: wallet.address, now: new Date() }, () =>
          sendFromEvm(wallet.provider, transfer)
        )
      );
    } catch (err) {
      setSendError(errorMessage(err) || 'The wallet did not send the transaction');
    } finally {
      sendingRef.current = false;
      setSending(false);
      setRecord(readRecord());
      if (keepFocus) setFocusAfterSend(tick => tick + 1);
    }
  }

  function confirmNothing(current: SendRecord) {
    confirmNothingSent(sendRecords, current);
    setCheckNote(null);
    setSendInfo(null);
    setRecord(readRecord());
  }

  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        {progress?.stage === 'done' ? 'Deposit complete' : 'Deposit in progress'}
      </styled.h2>

      {props.receiptUnsaved && (
        <p className={notice({ tone: 'warn' })} role="alert">
          This browser could not keep a copy of the receipt, so the file that was just downloaded is
          the only copy. Keep it: it is what lets you recover your BTC if anything goes wrong.
        </p>
      )}

      {payment !== 'none' && quote.depositAddress && (
        <div className={send}>
          {payment !== 'pay' && !expired && (
            <p className={sendLine}>
              {payment === 'checking'
                ? 'Checking whether a payment has already arrived…'
                : 'Can’t confirm the swap status right now, so the payment details are not shown. If you have already paid, there is nothing more to do here. This page keeps checking.'}
            </p>
          )}
          {expired ? (
            <>
              <p className={sendLine}>
                {quote.deadline && Date.parse(quote.deadline) > now.getTime()
                  ? `This quote expires at ${new Date(quote.deadline).toLocaleString()}, too soon to send safely.`
                  : `This quote expired${quote.deadline ? ` at ${new Date(quote.deadline).toLocaleString()}` : ''}.`}
              </p>
              <p className={sendNote}>
                Do not send anything to this swap now: the swap provider says funds that arrive
                after the deadline may be lost. Start a new deposit to get a fresh quote. If you
                already sent the payment, this page keeps tracking it.
              </p>
            </>
          ) : (
            payment === 'pay' && (
              <>
                {shortDeposit ? (
                  <p className={sendLine}>
                    {owed === null
                      ? 'Part of the amount arrived, but the swap provider did not say how much. From your own wallet, send only what is missing from the quoted total:'
                      : 'Part of the amount arrived. Send exactly the rest, from your own wallet:'}
                  </p>
                ) : (
                  <p className={sendLine}>
                    {walletReady
                      ? 'Send exactly this:'
                      : 'Send exactly this, from your own wallet:'}
                  </p>
                )}
                <p className={sendFigure}>
                  {sendAmountText(sendAmount, receipt.origin.symbol)} on {receipt.origin.chain}
                </p>
                {sendAmount.kind === 'base-units' && (
                  <p className={sendNote}>
                    This page does not know how many decimal places {receipt.origin.symbol} has, so
                    the amount is shown in its smallest unit, exactly as the swap was quoted. Check
                    that your wallet shows the same amount before you send.
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
            )
          )}
          {payment === 'pay' &&
            walletReady &&
            (panel.kind === 'offer' || panel.kind === 'sending') && (
              <div className={sendActions}>
                <button
                  ref={sendButtonRef}
                  className={button({ variant: 'primary' })}
                  aria-disabled={panel.kind === 'sending'}
                  onClick={() => void sendFromWallet()}
                >
                  {panel.kind === 'sending'
                    ? 'Confirm in your wallet…'
                    : `Send from ${source?.name ?? 'wallet'}`}
                </button>
              </div>
            )}
          {payment === 'pay' && panel.kind === 'unknown' && (
            <p className={sendNote}>
              This page could not refresh, so sending from your wallet is paused until it can. You
              can still send manually using the details above.
            </p>
          )}
          {payment === 'pay' && panel.kind === 'no-storage' && (
            <p className={sendNote}>
              Sending from your wallet is turned off because this browser cannot save a record of
              the payment, which is what stops it being sent twice. Send it manually using the
              details above.
            </p>
          )}
          {payment === 'pay' && panel.kind === 'no-lock' && (
            <p className={sendNote}>
              Sending from your wallet is turned off because this browser cannot stop two open tabs
              from sending the same payment. Send it manually using the details above, or use an
              up-to-date browser.
            </p>
          )}
          {(panel.kind === 'record' || sendInfo || sendError) && (
            <div ref={sendResultRef} tabIndex={-1}>
              {panel.kind === 'record' && (
                <SendRecordView
                  record={panel.record}
                  note={checkNote}
                  now={new Date()}
                  onConfirmNothingSent={() => confirmNothing(panel.record)}
                />
              )}
              {sendInfo && (
                <p className={sendStatus} role="status">
                  {sendInfo}
                </p>
              )}
              {sendError && (
                <p className={sendFailure} role="alert">
                  {sendError}
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
      )}

      <p ref={progressRef} tabIndex={-1} className={notice({ tone: 'status' })} role="status">
        {progress?.message ?? 'Checking…'}
      </p>
      {problem && <p className={notice()}>{problem}</p>}
      {snapshot?.swap === 'REFUNDED' && (
        <RefundNote
          refund={snapshot.refund}
          refundTo={receipt.refundTo}
          symbol={receipt.origin.symbol}
          chain={receipt.origin.chain}
        />
      )}
      {snapshot && <PayoutNotices snapshot={snapshot} />}

      <dl className={details()}>
        <dt>sBTC recipient</dt>
        <dd>
          <code>{receipt.stacksAddress}</code>
        </dd>
        <dt>Bitcoin deposit address</dt>
        <dd>
          <code>{receipt.depositAddress}</code>
        </dd>
        <QuotedOutput quote={quote} />
        {snapshot && <PayoutDetails snapshot={snapshot} />}
        {progress?.blocksUntilReclaim != null && progress.stage !== 'done' && (
          <>
            <dt>Reclaim available</dt>
            <dd>
              {progress.blocksUntilReclaim === 0
                ? 'now, from the Recover tab'
                : `in about ${progress.blocksUntilReclaim} Bitcoin blocks, if the deposit is never minted`}
            </dd>
          </>
        )}
      </dl>

      <div className={actions()}>
        <button className={button()} onClick={() => downloadReceipt(receipt)}>
          Download receipt again
        </button>
        <button className={button()} onClick={props.onDone}>
          {progress?.terminal ? 'Start another' : 'Hide'}
        </button>
      </div>
      <p className={closable ? afterActions : afterActionsWarn} role="status">
        {closingNote(registration, progress?.terminal ?? false)}
      </p>
    </section>
  );
}
