import { useEffect, useMemo, useRef, useState } from 'react';

import { css, cx } from 'portage-styles/css';
import { styled } from 'portage-styles/jsx';
import { actions, button, details, field, link, notice, sheet } from 'portage-styles/recipes';

import { type OneClickToken, MAINNET_CONFIG as config, errorMessage } from '@portage/core';

import {
  type Backend,
  type Prepared,
  type Snapshot,
  checkProgress,
  prepareDeposit,
} from './flow.js';
import { PayoutDetails, PayoutNotices } from './payout-notes.js';
import { type Receipt, downloadReceipt, rememberReceipt } from './receipt.js';
import type { RouteUpdate } from './route.js';
import type { SolanaPayOffer } from './solana-send.js';
import {
  type SourceWallet,
  buildEvmTransfer,
  chainFamily,
  loadSentTx,
  nextRefundField,
  saveSentTx,
  sendFromEvm,
  solanaSenderOf,
  walletAddressFor,
  walletCovers,
} from './source-wallet.js';
import type { WalletAccount } from './wallet.js';
import { QrCode } from './walletconnect-panel.js';

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
      setPreview(null);
    }
  }, [walletRefund]);

  useEffect(() => {
    if (active) return;
    onRoute({ origin: token ? `${token.symbol} on ${token.blockchain}` : null, deposit: null });
  }, [onRoute, token, active]);
  useEffect(() => () => onRoute(null), [onRoute]);

  async function run(dry: boolean) {
    if (!token) return;
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
        setPreview(prepared);
        return;
      }
      rememberReceipt(prepared.receipt);
      downloadReceipt(prepared.receipt);
      await backend
        .register(
          prepared.receipt.depositScript,
          prepared.receipt.reclaimScript,
          prepared.receipt.quoteResponse.quote.depositAddress
        )
        .catch(() => 'left-to-the-open-tab');
      setPreview(prepared);
      setActive(prepared.receipt);
    } catch (err) {
      setError(errorMessage(err) ?? null);
    } finally {
      setBusy(false);
    }
  }

  if (active) {
    return (
      <Tracking
        backend={backend}
        receipt={active}
        source={source}
        token={tokens.find(t => t.assetId === active.origin.assetId)}
        onRoute={onRoute}
        onDone={() => {
          setActive(null);
          setPreview(null);
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
            setPreview(null);
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
            setPreview(null);
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
            setPreview(null);
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
  source: SourceWallet | null;
  token: OneClickToken | undefined;
  onRoute(route: RouteUpdate | null): void;
  onDone(): void;
}) {
  const { backend, receipt, source, token, onRoute } = props;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const family = chainFamily(receipt.origin.chain);
  const [sentTx, setSentTx] = useState<string | null>(() =>
    loadSentTx(receipt.depositAddress, family)
  );
  const [sendError, setSendError] = useState<string | null>(null);
  const stopped = useRef(false);
  const quote = receipt.quoteResponse.quote;
  const solanaAccount = family === 'solana' ? solanaSenderOf(source) : null;

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const next = await checkProgress(config, backend, receipt);
        if (stopped.current) return;
        setSnapshot(next);
        setProblem(null);
        if (next.progress.terminal) return;
      } catch (err) {
        if (!stopped.current) setProblem(`Could not refresh: ${errorMessage(err)}. Retrying.`);
      }
      timer = setTimeout(() => void tick(), 20_000);
    }
    void tick();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [backend, receipt]);

  const progress = snapshot?.progress;
  const stage = progress?.stage ?? null;
  useEffect(() => {
    onRoute({ origin: `${receipt.origin.symbol} on ${receipt.origin.chain}`, deposit: { stage } });
  }, [onRoute, receipt, stage]);

  const waitingForFunds = !snapshot || progress?.stage === 'awaiting-funds';
  const pendingDeposit = !sentTx && (snapshot?.swap ?? 'PENDING_DEPOSIT') === 'PENDING_DEPOSIT';
  const walletCanSend =
    family === 'evm' ? source?.kind === 'evm' : family === 'solana' && solanaAccount !== null;
  const canSendFromWallet =
    walletCanSend &&
    token !== undefined &&
    token.blockchain === receipt.origin.chain &&
    walletCovers(source, token) &&
    pendingDeposit;
  const offerSolanaPay =
    family === 'solana' &&
    solanaAccount === null &&
    token !== undefined &&
    token.blockchain === 'sol' &&
    pendingDeposit &&
    !quote.depositMemo;

  async function sendFromWallet() {
    if (!token || !quote.depositAddress) return;
    setSending(true);
    setSendError(null);
    try {
      let sent: string;
      if (family === 'solana' && solanaAccount) {
        const { sendSolanaDeposit } = await import('./solana-send.js');
        sent = await sendSolanaDeposit(
          {
            token,
            recipient: quote.depositAddress,
            amount: quote.amountIn,
            memo: quote.depositMemo,
          },
          solanaAccount
        );
      } else if (family === 'evm' && source?.kind === 'evm') {
        const transfer = buildEvmTransfer({
          token,
          from: source.address,
          to: quote.depositAddress,
          amount: quote.amountIn,
        });
        sent = await sendFromEvm(source.provider, transfer);
      } else {
        return;
      }
      saveSentTx(receipt.depositAddress, sent);
      setSentTx(sent);
    } catch (err) {
      setSendError(errorMessage(err) || 'The wallet did not send the transaction');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        {progress?.stage === 'done' ? 'Deposit complete' : 'Deposit in progress'}
      </styled.h2>

      {waitingForFunds && quote.depositAddress && (
        <div className={send}>
          <p className={sendLine}>
            {canSendFromWallet ? 'Send exactly this:' : 'Send exactly this, from your own wallet:'}
          </p>
          <p className={sendFigure}>
            {quote.amountInFormatted} {receipt.origin.symbol} on {receipt.origin.chain}
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
          {canSendFromWallet && (
            <div className={sendActions}>
              <button
                className={button({ variant: 'primary' })}
                disabled={sending}
                onClick={() => void sendFromWallet()}
              >
                {sending ? 'Confirm in your wallet…' : `Send from ${source?.name ?? 'wallet'}`}
              </button>
            </div>
          )}
          {offerSolanaPay && token && quote.depositAddress && (
            <SolanaPayLink token={token} recipient={quote.depositAddress} amount={quote.amountIn} />
          )}
          {sentTx && (
            <p className={sendStatus} role="status">
              Sent from your wallet. Transaction <code>{sentTx}</code>. Do not send again.
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
        const { solanaPayOffer } = await import('./solana-send.js');
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
