import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { css, cx } from 'portage-styles/css';
import { styled } from 'portage-styles/jsx';
import { actions, button, details, field, link, notice, sheet } from 'portage-styles/recipes';

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
  latestSwap,
  nextRefundField,
  promptWaitMs,
  recordTx,
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
} from '@portage/chains';
import {
  type OneClickToken,
  MAINNET_CONFIG as config,
  errorMessage,
  formatBaseUnits,
} from '@portage/core';

import {
  type Backend,
  type Receipt,
  type Snapshot,
  type WalletAccount,
  checkProgress,
  downloadReceipt,
  latestRequests,
  rememberReceipt,
  sendLock,
  sendRecords,
} from '../../shared/index.js';
import {
  PayoutDetails,
  PayoutNotices,
  QrCode,
  type RouteUpdate,
  SendRecordView,
} from '../../ui/index.js';
import { registerForBackground } from './background-registration.js';
import { type Prepared, prepareDeposit } from './flow.js';

const POPULAR = ['USDC', 'USDT', 'ETH', 'SOL', 'BNB', 'TRX'];

const fields = field();

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));

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
  css({ marginBlock: 'space.02', '.portage-actions + &': { marginTop: 'space.08' } })
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
  account: WalletAccount;
  source: SourceWallet | null;
  resume: Receipt | null;
  onRoute(route: RouteUpdate | null): void;
}) {
  const { backend, account, source, onRoute } = props;
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const [preview, setPreview] = useState<Prepared | null>(null);
  const [active, setActive] = useState<Receipt | null>(props.resume);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receiptUnsaved, setReceiptUnsaved] = useState(false);
  const [previews] = useState(latestRequests);

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
      } catch (err) {
        setError(`Could not load the asset list: ${errorMessage(err)}`);
      }
    }
    void loadTokens();
  }, [backend]);

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
    if (!token) return;
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
      const remembered = rememberReceipt(prepared.receipt);
      downloadReceipt(prepared.receipt);
      setReceiptUnsaved(!remembered);
      const swapAddress = prepared.receipt.quoteResponse.quote.depositAddress;
      if (swapAddress) {
        const { depositScript, reclaimScript } = prepared.receipt;
        await registerForBackground(() =>
          backend.register(depositScript, reclaimScript, swapAddress)
        );
      }
      setPreview(prepared);
      setActive(prepared.receipt);
    } catch (err) {
      if (!dry || isLatest()) setError(errorMessage(err) ?? null);
    } finally {
      setBusy(false);
    }
  }

  function inputsChanged() {
    previews.cancel();
    setPreview(null);
  }

  if (active) {
    return (
      <Tracking
        backend={backend}
        receipt={active}
        receiptUnsaved={receiptUnsaved}
        source={source}
        token={tokens.find(t => t.assetId === active.origin.assetId)}
        onRoute={onRoute}
        onDone={() => {
          setActive(null);
          setPreview(null);
          setReceiptUnsaved(false);
        }}
      />
    );
  }

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

      <div className={actions()}>
        <button
          className={button()}
          disabled={busy || !token || !amount || !refundTo}
          onClick={() => void run(true)}
        >
          {busy ? 'Working…' : 'Get quote'}
        </button>
        {preview && (
          <button
            className={button({ variant: 'primary' })}
            disabled={busy}
            onClick={() => void run(false)}
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
    </section>
  );
}

function Tracking(props: {
  backend: Backend;
  receipt: Receipt;
  receiptUnsaved: boolean;
  source: SourceWallet | null;
  token: OneClickToken | undefined;
  onRoute(route: RouteUpdate | null): void;
  onDone(): void;
}) {
  const { backend, receipt, source, token, onRoute } = props;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
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
    if (!snapshot || sendingRef.current) return;
    setRecord(settleFromProvider(sendRecords, readRecord(), snapshot.swap));
  }, [snapshot, readRecord]);

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
  const checkable = record !== null && record.state !== 'sent' && recordTx(record) !== null;
  const evmProvider = source?.kind === 'evm' ? source.provider : null;

  useEffect(() => {
    if (!checkable || sending) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deps: ResolveDeps = {
      async checkSolana(sent) {
        const { checkSolanaSend } = await import('@portage/chains/solana');
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
      if (current === null || current.state === 'sent') return;
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
    setStale(false);
    setProblem(null);
    async function tick() {
      try {
        const next = await checkProgress(config, backend, receipt);
        if (!live) return;
        setSnapshot(next);
        setStale(false);
        setProblem(null);
        if (next.progress.terminal) return;
      } catch (err) {
        if (!live) return;
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
  useEffect(() => {
    onRoute({ origin: `${receipt.origin.symbol} on ${receipt.origin.chain}`, deposit: { stage } });
  }, [onRoute, receipt, stage]);

  const waitingForFunds = !snapshot || progress?.stage === 'awaiting-funds';
  const shortDeposit = snapshot?.swap === 'INCOMPLETE_DEPOSIT';
  const owed =
    shortDeposit && snapshot.remaining !== null && token !== undefined
      ? formatBaseUnits(snapshot.remaining, token.decimals)
      : null;
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
  const panel = sendPanel({
    swap: latestSwap(snapshot, stale),
    record,
    walletCanSend: walletReady || solanaPayReady,
    sending,
    durable: durable || !walletReady,
    lockable: sendLock !== null || !walletReady,
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
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    setSendInfo(null);
    setCheckNote(null);
    const swapAddress = target.address;
    try {
      if (family === 'solana' && solanaAccount) {
        const { sendSolanaDeposit } = await import('@portage/chains/solana');
        showOutcome(
          await attemptSend(
            sendRecords,
            sendLock,
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
            sendLock,
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
    }
  }

  async function resendSame(current: SendRecord) {
    setResending(true);
    setSendError(null);
    try {
      const { resendSignedTransaction } = await import('@portage/chains/solana');
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

      {waitingForFunds && quote.depositAddress && (
        <div className={send}>
          {shortDeposit ? (
            <p className={sendLine}>
              {owed === null
                ? 'Part of the amount arrived, but the swap provider did not say how much. From your own wallet, send only what is missing from the quoted total:'
                : 'Part of the amount arrived. Send exactly the rest, from your own wallet:'}
            </p>
          ) : (
            <p className={sendLine}>
              {walletReady ? 'Send exactly this:' : 'Send exactly this, from your own wallet:'}
            </p>
          )}
          <p className={sendFigure}>
            {owed ?? quote.amountInFormatted} {receipt.origin.symbol} on {receipt.origin.chain}
          </p>
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
          {walletReady && (panel.kind === 'offer' || panel.kind === 'sending') && (
            <div className={sendActions}>
              <button
                className={button({ variant: 'primary' })}
                disabled={panel.kind === 'sending'}
                onClick={() => void sendFromWallet()}
              >
                {panel.kind === 'sending'
                  ? 'Confirm in your wallet…'
                  : `Send from ${source?.name ?? 'wallet'}`}
              </button>
            </div>
          )}
          {!walletReady && solanaPayReady && panel.kind === 'offer' && token && target && (
            <SolanaPayLink token={token} recipient={target.address} amount={quote.amountIn} />
          )}
          {panel.kind === 'checking' && (
            <p className={sendNote}>Checking whether a payment has already arrived…</p>
          )}
          {panel.kind === 'unknown' && (
            <p className={sendNote}>
              Can’t confirm the swap status right now. If you have not paid yet you can still send
              manually using the details above.
            </p>
          )}
          {panel.kind === 'no-storage' && (
            <p className={sendNote}>
              Sending from your wallet is turned off because this browser cannot save a record of
              the payment, which is what stops it being sent twice. Send it manually using the
              details above.
            </p>
          )}
          {panel.kind === 'no-lock' && (
            <p className={sendNote}>
              Sending from your wallet is turned off because this browser cannot stop two open tabs
              from sending the same payment. Send it manually using the details above, or use an
              up-to-date browser.
            </p>
          )}
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
          <p className={refundNote}>
            A different asset, chain or amount will be refunded to {receipt.refundTo}, minus the
            provider’s refund fee.
          </p>
        </div>
      )}

      <p className={notice({ tone: 'status' })} role="status">
        {progress?.message ?? 'Checking…'}
      </p>
      {problem && <p className={notice()}>{problem}</p>}
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
      <p className={afterActions}>
        You can close this page. The deposit continues, and you can check on it later by loading the
        receipt file.
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
        const { solanaPayOffer } = await import('@portage/chains/solana');
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
