import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { css, cx } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { actions, button, details, field, link, notice, sheet } from 'satway-styles/recipes';

import {
  type AttemptOutcome,
  type EvmTransfer,
  type ResolveDeps,
  type SendFamily,
  type SendRecord,
  type SolanaPayOffer,
  type SourceWallet,
  attemptSend,
  buildEvmTransfer,
  chainFamily,
  confirmNothingSent,
  evmTransactionState,
  needsChainCheck,
  nextRefundField,
  promptWaitMs,
  quoteExpired,
  recordTx,
  releaseIfCleared,
  resendRecord,
  resolveRecord,
  sendFromEvm,
  sendPanel,
  settleFromProvider,
  solanaSenderOf,
  swapTargetOf,
  walletAddressFor,
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
  latestRequests,
  paymentView,
  rememberReceipt,
  sendAmountOf,
  sendAmountText,
  sendRecords,
} from '../../shared/index.js';
import {
  PayoutDetails,
  PayoutNotices,
  QrCode,
  QuotedOutput,
  RefundNote,
  type RouteUpdate,
  SendRecordView,
} from '../../ui/index.js';
import {
  type RegistrationState,
  closingNote,
  firstRegistration,
  keepRegistering,
  registeredThisSession,
} from './background-registration.js';
import { type Prepared, liveQuoteWorse, prepareDeposit } from './flow.js';

const POPULAR = ['USDC', 'USDT', 'ETH', 'SOL', 'BNB', 'TRX'];

const fields = field();

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

const solanaPay = css({ marginTop: 'space.08', '& svg': { maxWidth: 'qrCompact' } });
const solanaPayOpen = cx(
  link(),
  css({ display: 'inline-flex', alignItems: 'center', minHeight: 'control', fontWeight: 'medium' })
);

function sats(n: number): string {
  return `${n.toLocaleString('en-US')} sats`;
}

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
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const [preview, setPreview] = useState<Prepared | null>(null);
  const [repriced, setRepriced] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews] = useState(latestRequests);
  const [tokensFailed, setTokensFailed] = useState(false);
  const [tokenAttempt, setTokenAttempt] = useState(0);

  useEffect(() => {
    async function loadTokens() {
      try {
        const all = await backend.tokens();
        const usable = all
          .filter(
            t =>
              t.assetId !== config.btcAssetId &&
              t.blockchain !== 'btc' &&
              t.price > 0 &&
              !/deprecated/i.test(t.symbol)
          )
          .sort((a, b) => {
            function rank(t: OneClickToken) {
              return POPULAR.indexOf(t.symbol) + 1 || POPULAR.length + 1;
            }
            return (
              rank(a) - rank(b) ||
              a.symbol.localeCompare(b.symbol) ||
              a.blockchain.localeCompare(b.blockchain)
            );
          });
        setTokens(usable);
        setAssetId(current => current || usable[0]?.assetId || '');
        setTokensFailed(false);
      } catch (err) {
        setError(`Could not load the asset list: ${errorMessage(err)}`);
        setTokensFailed(true);
      }
    }
    void loadTokens();
  }, [backend, tokenAttempt]);

  const token = useMemo(() => tokens.find(t => t.assetId === assetId), [tokens, assetId]);
  const covered = walletCovers(source, token);

  useEffect(() => {
    if (!source) return;
    setAssetId(current => {
      const now = tokens.find(t => t.assetId === current);
      if (now && walletCovers(source, now)) return current;
      return tokens.find(t => chainFamily(t.blockchain) === source.kind)?.assetId ?? current;
    });
  }, [source, tokens]);

  const refundRef = useRef(refundTo);
  refundRef.current = refundTo;
  const autofilledRefund = useRef<string | null>(null);
  const walletRefund =
    covered && token ? walletAddressFor(source, chainFamily(token.blockchain)) : null;

  useEffect(() => {
    const next = nextRefundField(
      { value: refundRef.current, autofilled: autofilledRefund.current },
      walletRefund
    );
    autofilledRefund.current = next.autofilled;
    if (next.value !== refundRef.current) {
      setRefundTo(next.value);
      previews.cancel();
      setPreview(null);
    }
  }, [walletRefund, previews]);

  useEffect(() => {
    if (active) return;
    onRoute({ origin: token ? `${token.symbol} on ${token.blockchain}` : null, deposit: null });
  }, [onRoute, token, active]);
  useEffect(() => () => onRoute(null), [onRoute]);

  async function run(dry: boolean) {
    if (!token || !account) return;
    const isLatest = previews.begin();
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareDeposit(
        config,
        backend,
        { ...account, token, amount, refundTo },
        { dry }
      );
      if (dry) {
        if (isLatest()) setPreview(prepared);
        return;
      }
      if (preview && liveQuoteWorse(preview, prepared, config.slippageBps)) {
        setRepriced(prepared);
        return;
      }
      await activate(prepared);
    } catch (err) {
      if (!dry || isLatest()) setError(errorMessage(err) ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function activate(prepared: Prepared) {
    const remembered = rememberReceipt(prepared.receipt);
    downloadReceipt(prepared.receipt);
    const swapAddress = prepared.receipt.quoteResponse.quote.depositAddress;
    const { depositScript, reclaimScript } = prepared.receipt;
    const first = swapAddress
      ? await firstRegistration(() => backend.register(depositScript, reclaimScript, swapAddress))
      : undefined;
    setRepriced(null);
    setPreview(prepared);
    onActive({
      receipt: prepared.receipt,
      receiptUnsaved: !remembered,
      ...(first === undefined ? {} : { firstRegistration: first }),
    });
  }

  async function acceptRepriced(live: Prepared) {
    if (quoteExpired(live.receipt.quoteResponse.quote.deadline, new Date())) {
      setRepriced(null);
      setError('That new quote has expired. Get a new quote to continue.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await activate(live);
    } catch (err) {
      setError(errorMessage(err) ?? null);
    } finally {
      setBusy(false);
    }
  }

  function inputsChanged() {
    previews.cancel();
    setPreview(null);
    setRepriced(null);
  }

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
        onDone={() => {
          onActive(null);
          setPreview(null);
        }}
      />
    );
  }

  if (!account) return null;

  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        Deposit to sBTC from another chain
      </styled.h2>
      <p className={notice()}>
        sBTC will be minted to <code>{account.stacksAddress}</code>.
      </p>

      <label className={fields.label}>
        You send
        <select
          className={fields.control}
          value={assetId}
          onChange={e => {
            setAssetId(e.target.value);
            inputsChanged();
          }}
        >
          {tokens.map(t => (
            <option key={t.assetId} value={t.assetId}>
              {t.symbol} on {t.blockchain}
            </option>
          ))}
        </select>
      </label>

      <label className={fields.label}>
        Amount{token ? ` (${token.symbol})` : ''}
        <input
          className={fields.control}
          inputMode="decimal"
          value={amount}
          placeholder="25"
          onChange={e => {
            setAmount(e.target.value);
            inputsChanged();
          }}
        />
      </label>

      <label className={fields.label}>
        Refund address{token ? ` on ${token.blockchain}` : ''}
        <input
          className={fields.control}
          value={refundTo}
          placeholder="Your own address on the chain you are sending from"
          spellCheck={false}
          onChange={e => {
            autofilledRefund.current = null;
            setRefundTo(e.target.value);
            inputsChanged();
          }}
        />
        <small className={fields.hint}>
          {covered
            ? 'Filled in from your connected wallet. If the swap cannot complete, your funds go back here.'
            : 'If the swap cannot complete, your funds go back here. Use a wallet you control, not an exchange deposit address.'}
        </small>
      </label>

      {error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {error}
        </p>
      )}
      {tokensFailed && (
        <div className={actions()}>
          <button
            className={button()}
            onClick={() => {
              setError(null);
              setTokensFailed(false);
              setTokenAttempt(attempt => attempt + 1);
            }}
          >
            Load the asset list again
          </button>
        </div>
      )}

      {preview && (
        <dl className={details()}>
          <dt>You receive about</dt>
          <dd>{sats(preview.expectedSats)} as sBTC</dd>
          <dt>At least</dt>
          <dd>{sats(preview.minimumSats)}, before the signers’ Bitcoin fee</dd>
          <dt>Swap provider fees</dt>
          <dd>
            {preview.providerFeeBps / 100}%
            {preview.withdrawFeeSats !== null
              ? ` plus ${sats(preview.withdrawFeeSats)} Bitcoin withdrawal`
              : ''}
          </dd>
          <dt>Our fee</dt>
          <dd>{config.appFeeBps / 100}%</dd>
          <dt>Typical time</dt>
          <dd>40 to 60 minutes; sBTC waits for Bitcoin confirmations</dd>
          <dt>Pays out to</dt>
          <dd>
            <code>{preview.receipt.depositAddress}</code>
          </dd>
          {preview.warnings.map(w => (
            <dd key={w} className={notice({ tone: 'warn' })}>
              {w}
            </dd>
          ))}
        </dl>
      )}

      {repriced && preview ? (
        <>
          <p className={notice({ tone: 'warn' })} role="status">
            The price moved since your quote. You would now receive about{' '}
            {sats(repriced.expectedSats)} as sBTC, at least {sats(repriced.minimumSats)}, instead of
            about {sats(preview.expectedSats)}, at least {sats(preview.minimumSats)}. Continue only
            if the new amounts are acceptable.
          </p>
          <div className={actions()}>
            <button
              className={button({ variant: 'primary' })}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) void acceptRepriced(repriced);
              }}
            >
              Continue with the new amounts
            </button>
            <button className={button()} disabled={busy} onClick={() => setRepriced(null)}>
              Cancel
            </button>
          </div>
          <p className={afterActions}>
            Nothing has been saved or registered yet, and nothing is sent until you pay. If you
            cancel, the new quote is not used and simply expires.
          </p>
        </>
      ) : (
        <>
          <div className={actions()}>
            <button
              className={button()}
              disabled={!token || !amount || !refundTo}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) void run(true);
              }}
            >
              {busy ? 'Working…' : 'Get quote'}
            </button>
            {preview && (
              <button
                className={button({ variant: 'primary' })}
                aria-disabled={busy}
                onClick={() => {
                  if (!busy) void run(false);
                }}
              >
                Continue
              </button>
            )}
          </div>
          {preview && (
            <p className={afterActions}>
              Continuing downloads a receipt file. Keep it: it is what lets you recover your BTC if
              anything goes wrong.
            </p>
          )}
        </>
      )}
    </section>
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
  const family = chainFamily(receipt.origin.chain);
  const sendFamily: SendFamily | null = family === 'other' ? null : family;
  const quote = receipt.quoteResponse.quote;
  const target = useMemo(
    () => swapTargetOf(quote.depositAddress, quote.depositMemo),
    [quote.depositAddress, quote.depositMemo]
  );
  const readRecord = useCallback(
    () => (target && sendFamily ? sendRecords.read(target, sendFamily) : null),
    [target, sendFamily]
  );
  const [record, setRecord] = useState<SendRecord | null>(readRecord);
  const [durable] = useState(() => sendRecords.durable());
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendInfo, setSendInfo] = useState<string | null>(null);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const solanaAccount = family === 'solana' ? solanaSenderOf(source) : null;

  useEffect(() => {
    setRecord(readRecord());
    return watchSendRecords(window, () => setRecord(readRecord()));
  }, [readRecord]);

  useEffect(() => {
    if (record !== null || sending || !target || !sendFamily) return;
    releaseIfCleared(sendRecords, target, sendFamily);
  }, [record, sending, target, sendFamily]);

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
  const evmProvider = source?.kind === 'evm' ? source.provider : null;

  useEffect(() => {
    if (!checkable || sending) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deps: ResolveDeps = {
      async checkSolana(sent) {
        const { checkSolanaSend } = await import('@satway/chains/solana');
        return checkSolanaSend(sent);
      },
      evmState(hash) {
        if (!evmProvider)
          return Promise.reject(new Error('connect the wallet you sent from to check it'));
        return evmTransactionState(evmProvider, hash);
      },
    };
    async function check() {
      const current = readRecord();
      if (current === null || !needsChainCheck(current)) return;
      try {
        const result = await resolveRecord(sendRecords, current, deps);
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
    async function tick() {
      try {
        const next = await checkProgress(config, backend, receipt);
        if (!live) return;
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
  const tokenDecimals =
    token !== undefined && token.assetId === receipt.origin.assetId ? token.decimals : null;
  const owed =
    shortDeposit && reading.remaining !== null
      ? sendAmountOf(receipt, tokenDecimals, reading.remaining)
      : null;
  const sendAmount = owed ?? sendAmountOf(receipt, tokenDecimals);
  const walletCanSend =
    family === 'evm' ? source?.kind === 'evm' : family === 'solana' && solanaAccount !== null;
  const walletReady =
    walletCanSend &&
    target !== null &&
    token !== undefined &&
    token.blockchain === receipt.origin.chain &&
    walletCovers(source, token);
  const solanaPayReady =
    family === 'solana' &&
    solanaAccount === null &&
    token !== undefined &&
    token.blockchain === 'sol' &&
    !quote.depositMemo;
  const now = new Date();
  const expired = quoteExpired(quote.deadline, now);
  const panel = sendPanel({
    swap: stale ? null : reading?.swap,
    record,
    walletCanSend: walletReady || solanaPayReady,
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
    if (!token || !target || sendingRef.current) return;
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
    const swapAddress = target.address;
    try {
      if (family === 'solana' && solanaAccount) {
        const { sendSolanaDeposit } = await import('@satway/chains/solana');
        showOutcome(
          await attemptSend(
            sendRecords,
            { target, family: 'solana', account: solanaAccount.address, now: new Date() },
            hooks =>
              sendSolanaDeposit(
                { token, recipient: swapAddress, amount: quote.amountIn, memo: quote.depositMemo },
                solanaAccount,
                undefined,
                hooks
              )
          )
        );
      } else if (family === 'evm' && source?.kind === 'evm') {
        const provider = source.provider;
        const transfer: EvmTransfer = buildEvmTransfer({
          token,
          from: source.address,
          to: swapAddress,
          amount: quote.amountIn,
        });
        showOutcome(
          await attemptSend(
            sendRecords,
            { target, family: 'evm', account: source.address, now: new Date() },
            () => sendFromEvm(provider, transfer)
          )
        );
      }
    } catch (err) {
      setSendError(errorMessage(err) || 'The wallet did not send the transaction');
    } finally {
      sendingRef.current = false;
      setSending(false);
      setRecord(readRecord());
      if (keepFocus) setFocusAfterSend(tick => tick + 1);
    }
  }

  async function resendSame(current: SendRecord) {
    setResending(true);
    setSendError(null);
    try {
      const { resendSignedTransaction } = await import('@satway/chains/solana');
      const outcome = await resendRecord(sendRecords, current, signed =>
        resendSignedTransaction(signed)
      );
      if (outcome.kind === 'uncertain') setCheckNote(outcome.record.message);
    } catch (err) {
      setCheckNote(errorMessage(err) ?? 'The transaction could not be sent again.');
    } finally {
      setResending(false);
      setRecord(readRecord());
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
          {payment === 'pay' &&
            !walletReady &&
            solanaPayReady &&
            panel.kind === 'offer' &&
            token &&
            target && (
              <SolanaPayLink token={token} recipient={target.address} amount={quote.amountIn} />
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
                  resending={resending}
                  now={new Date()}
                  onResend={() => void resendSame(panel.record)}
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

function SolanaPayLink(props: { token: OneClickToken; recipient: string; amount: string }) {
  const { token, recipient, amount } = props;
  const [offer, setOffer] = useState<SolanaPayOffer | null>(null);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const { solanaPayOffer } = await import('@satway/chains/solana');
        const next = await solanaPayOffer({ token, recipient, amount });
        if (live) setOffer(next);
      } catch (err) {
        if (live)
          setOffer({
            status: 'unavailable',
            reason: `A Solana Pay link cannot be offered: ${errorMessage(err) ?? 'unknown error'}`,
          });
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [token, recipient, amount]);

  if (!offer) return <p className={sendNote}>Checking whether a Solana Pay link can be offered…</p>;
  if (offer.status === 'unavailable') return <p className={sendNote}>{offer.reason}</p>;
  return (
    <div className={solanaPay}>
      <p className={sendLine}>
        Or scan with a Solana Pay wallet. The link asks for exactly this amount.
      </p>
      <QrCode matrix={offer.matrix} label="Solana Pay transfer request" />
      <div className={sendActions}>
        <a className={solanaPayOpen} href={offer.url}>
          Open in a Solana wallet
        </a>
      </div>
    </div>
  );
}
