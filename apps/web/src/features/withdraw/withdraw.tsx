import { useEffect, useMemo, useRef, useState } from 'react';

import { css, cx } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { actions, button, details, field, notice, sheet } from 'satway-styles/recipes';

import { type SourceWallet, nextRefundField, walletAddressFor } from '@satway/chains';
import {
  type OneClickToken,
  type WithdrawalContractCall,
  type WithdrawalPreview,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
  errorMessage,
  fetchSbtcBalance,
} from '@satway/core';

import {
  type ActiveWithdrawal,
  type Backend,
  StacksWalletDeclinedError,
  type WalletAccount,
  type WithdrawalBackend,
  activeWithdrawal,
  downloadWithdrawalReceipt,
  forgetWithdrawalDraft,
  latestRequests,
  loadWithdrawals,
  rememberWithdrawal,
  setActiveWithdrawal,
  withStacksTxid,
  withdrawalId,
  withdrawalReceiptOf,
} from '../../shared/index.js';
import type { WithdrawalRouteUpdate } from '../../ui/index.js';
import {
  type FlowDeps,
  type LiveQuote,
  describeQuoteChange,
  formatTokenAmount,
  liveQuoteFor,
  previewFor,
  sats,
  satsOrNull,
  signingRefusal,
  withdrawalDestinations,
} from './flow.js';
import { WithdrawalTracking } from './tracking.js';

const fields = field();

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));

const confirmBox = css({
  borderLeftWidth: 'accent',
  borderLeftStyle: 'solid',
  borderLeftColor: 'route.bitcoin',
  borderRadius: 'sm',
  backgroundColor: 'stage',
  paddingBlock: { base: 'space.08', md: 'space.10' },
  paddingInline: { base: 'space.08', md: 'space.10' },
  marginBlock: 'space.10',
});

const confirmTitle = css({
  textStyle: 'emphasis',
  marginTop: 'space.00',
  marginBottom: 'space.04',
});

export interface WithdrawProps {
  backend: Backend;
  quotes: WithdrawalBackend;
  account: WalletAccount | null;
  destinationWallet: SourceWallet | null;
  active: ActiveWithdrawal | null;
  onActive(update: (current: ActiveWithdrawal | null) => ActiveWithdrawal | null): void;
  requestWithdrawal(call: WithdrawalContractCall): Promise<string>;
  onRoute(route: WithdrawalRouteUpdate | null): void;
}

export function storedActiveWithdrawal(): ActiveWithdrawal | null {
  const receipt = activeWithdrawal(config);
  return receipt ? { receipt, receiptUnsaved: false, walletPrompt: false } : null;
}

export function Withdraw(props: WithdrawProps) {
  const { active, onActive, onRoute } = props;
  const [signingHere, setSigningHere] = useState(false);
  useEffect(() => () => onRoute(null), [onRoute]);

  if (active && !(active.walletPrompt && signingHere)) {
    return (
      <WithdrawalTracking
        backend={props.backend}
        receipt={active.receipt}
        receiptUnsaved={active.receiptUnsaved}
        walletPrompt={active.walletPrompt}
        onRoute={onRoute}
        onReceipt={receipt => {
          const remembered = rememberWithdrawal(config, receipt);
          setActiveWithdrawal(receipt);
          downloadWithdrawalReceipt(receipt);
          onActive(() => ({ receipt, receiptUnsaved: !remembered, walletPrompt: false }));
        }}
        onDiscard={receipt => {
          const id = withdrawalId(receipt);
          const stored = loadWithdrawals(config).find(r => withdrawalId(r) === id);
          if (stored && stored.stacksTxid !== null) {
            setActiveWithdrawal(stored);
            onActive(() => ({ receipt: stored, receiptUnsaved: false, walletPrompt: false }));
            return;
          }
          forgetWithdrawalDraft(config, receipt);
          setActiveWithdrawal(null);
          onActive(() => null);
        }}
        onDone={() => {
          setActiveWithdrawal(null);
          onActive(() => null);
        }}
      />
    );
  }

  if (!props.account) {
    return (
      <section className={sheet()}>
        <styled.h2 textStyle="heading" marginBottom="space.06">
          Withdraw sBTC to another chain
        </styled.h2>
        <p>
          Turn sBTC on Stacks into USDC, ETH and other assets on EVM chains. Connect your Stacks
          wallet above to begin.
        </p>
        <styled.ul
          marginTop="space.08"
          marginInline="space.00"
          marginBottom="space.00"
          paddingLeft="space.09"
          color="muted"
          fontSize="sm"
          listStyleType="disc"
          css={{ '& > li + li': { marginTop: 'space.02' } }}
        >
          <li>This site never holds your funds or keys.</li>
          <li>
            The sBTC signers pay your sBTC out as BTC to a swap address, and NEAR Intents swaps it
            and delivers it to your address.
          </li>
          <li>
            If the signers reject the withdrawal, your sBTC comes back. If the swap cannot complete,
            the BTC is refunded to your Bitcoin address.
          </li>
        </styled.ul>
      </section>
    );
  }

  return <WithdrawForm {...props} account={props.account} onSigning={setSigningHere} />;
}

function WithdrawForm(
  props: WithdrawProps & {
    account: WalletAccount;
    onSigning(signing: boolean): void;
  }
) {
  const { backend, quotes, account, destinationWallet, onRoute } = props;
  const deps: FlowDeps = useMemo(() => ({ config, backend, quotes }), [backend, quotes]);
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [tokensFailed, setTokensFailed] = useState(false);
  const [tokenAttempt, setTokenAttempt] = useState(0);
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [refundTo, setRefundTo] = useState(account.reclaimKeyAddress);
  const [slippageBps, setSlippageBps] = useState(config.withdrawalDefaultSlippageBps);
  const [preview, setPreview] = useState<WithdrawalPreview | null>(null);
  const [live, setLive] = useState<LiveQuote | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests] = useState(latestRequests);
  const liveQuoteAbort = useRef<AbortController | null>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const all = await backend.tokens();
        if (!live) return;
        const usable = withdrawalDestinations(all, config.btcAssetId);
        setTokens(usable);
        setAssetId(current => current || usable[0]?.assetId || '');
        setTokensFailed(false);
      } catch (err) {
        if (!live) return;
        setError(`Could not load the asset list: ${errorMessage(err) ?? 'unknown error'}`);
        setTokensFailed(true);
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [backend, tokenAttempt]);

  useEffect(() => {
    let live = true;
    async function load() {
      setBalanceError(null);
      try {
        const sats = await fetchSbtcBalance(config, account.stacksAddress);
        if (live) setBalance(sats);
      } catch (err) {
        if (live) setBalanceError(errorMessage(err) ?? 'unknown error');
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [account.stacksAddress]);

  const token = useMemo(() => tokens.find(t => t.assetId === assetId), [tokens, assetId]);
  const walletAddress = walletAddressFor(destinationWallet, token?.blockchain);

  const recipientRef = useRef(recipient);
  recipientRef.current = recipient;
  const autofilled = useRef<string | null>(null);
  useEffect(() => {
    const next = nextRefundField(
      { value: recipientRef.current, autofilled: autofilled.current },
      walletAddress
    );
    autofilled.current = next.autofilled;
    if (next.value !== recipientRef.current) {
      setRecipient(next.value);
      requests.cancel();
      liveQuoteAbort.current?.abort();
      setBusy(false);
      setPreview(null);
      setLive(null);
    }
  }, [walletAddress, requests]);

  useEffect(() => {
    onRoute({
      destination: token ? `${token.symbol} on ${token.blockchain}` : null,
      milestones: null,
    });
  }, [onRoute, token]);

  useEffect(() => {
    if (live) confirmRef.current?.focus();
  }, [live]);

  useEffect(() => () => liveQuoteAbort.current?.abort(), []);

  function inputsChanged() {
    requests.cancel();
    liveQuoteAbort.current?.abort();
    setBusy(false);
    setPreview(null);
    setLive(null);
    setError(null);
  }

  const form = token ? { token, amount, recipient, refundTo, slippageBps } : null;

  async function getPreview() {
    if (!form) return;
    const isLatest = requests.begin();
    setBusy(true);
    setError(null);
    setLive(null);
    try {
      const next = await previewFor(deps, form);
      if (isLatest()) setPreview(next);
    } catch (err) {
      if (isLatest()) setError(errorMessage(err) ?? 'The quote could not be checked');
    } finally {
      if (isLatest()) setBusy(false);
    }
  }

  async function getLiveQuote() {
    if (!form) return;
    const isLatest = requests.begin();
    liveQuoteAbort.current?.abort();
    const controller = new AbortController();
    liveQuoteAbort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const next = await liveQuoteFor(
        deps,
        form,
        account.stacksAddress,
        preview,
        controller.signal
      );
      if (!isLatest()) return;
      setBalance(next.balanceSats);
      setLive(next);
    } catch (err) {
      if (isLatest()) setError(errorMessage(err) ?? 'The withdrawal could not be prepared');
    } finally {
      if (isLatest()) setBusy(false);
    }
  }

  async function sign(quote: LiveQuote) {
    if (!token || signing) return;
    const refusal = signingRefusal(config, quote.receipt, new Date());
    if (refusal) {
      setError(refusal);
      setLive(null);
      return;
    }
    setSigning(true);
    setError(null);
    const draft = withdrawalReceiptOf(quote.receipt, {
      assetId: token.assetId,
      chain: token.blockchain,
      symbol: token.symbol,
      decimals: token.decimals,
    });
    const draftSaved = rememberWithdrawal(config, draft);
    if (draftSaved) setActiveWithdrawal(draft);
    const mine = withdrawalId(draft);
    const { onActive, onSigning } = props;
    function show(next: ActiveWithdrawal | null) {
      onActive(current =>
        current === null || withdrawalId(current.receipt) === mine ? next : current
      );
    }
    onSigning(true);
    show({ receipt: draft, receiptUnsaved: !draftSaved, walletPrompt: true });
    try {
      const txid = await props.requestWithdrawal(quote.receipt.contractCall);
      const receipt = withStacksTxid(draft, txid);
      const remembered = rememberWithdrawal(config, receipt);
      setActiveWithdrawal(receipt);
      downloadWithdrawalReceipt(receipt);
      show({ receipt, receiptUnsaved: !remembered, walletPrompt: false });
    } catch (err) {
      if (err instanceof StacksWalletDeclinedError) {
        forgetWithdrawalDraft(config, draft);
        setActiveWithdrawal(null);
        show(null);
        setError('You declined the request in your wallet, so nothing was signed or sent.');
        return;
      }
      setError(null);
      show({ receipt: draft, receiptUnsaved: !draftSaved, walletPrompt: false });
    } finally {
      setSigning(false);
      onSigning(false);
    }
  }

  const amountSats = satsOrNull(amount);

  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        Withdraw sBTC to another chain
      </styled.h2>
      <p className={notice()}>
        sBTC is withdrawn from <code>{account.stacksAddress}</code>.{' '}
        {balance !== null && <>Your balance is {sats(balance)}.</>}
        {balanceError && <>Could not read your sBTC balance: {balanceError}</>}
      </p>

      <label className={fields.label}>
        You receive
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
        Amount of sBTC (sats)
        <input
          className={fields.control}
          inputMode="numeric"
          value={amount}
          placeholder="50000"
          onChange={e => {
            setAmount(e.target.value);
            inputsChanged();
          }}
        />
        <small className={fields.hint}>
          At least {sats(config.minWithdrawalSats)}. A fee cap for the Bitcoin payout is locked on
          top; the unused part comes back to you as sBTC.
        </small>
      </label>

      <label className={fields.label}>
        Receive at{token ? ` (your address on ${token.blockchain})` : ''}
        <input
          className={fields.control}
          value={recipient}
          placeholder="Your own address on the chain you receive on"
          spellCheck={false}
          onChange={e => {
            autofilled.current = null;
            setRecipient(e.target.value);
            inputsChanged();
          }}
        />
        <small className={fields.hint}>
          {walletAddress !== null && recipient === walletAddress
            ? 'Filled in from your connected wallet.'
            : 'Use a wallet you control. Funds sent to a wrong address cannot be recovered.'}
        </small>
      </label>

      <label className={fields.label}>
        Bitcoin refund address
        <input
          className={fields.control}
          value={refundTo}
          spellCheck={false}
          onChange={e => {
            setRefundTo(e.target.value);
            inputsChanged();
          }}
        />
        <small className={fields.hint}>
          If the swap cannot complete, NEAR Intents refunds the BTC here, minus its refund fee.
          {refundTo === account.reclaimKeyAddress
            ? ' Filled in from your Stacks wallet’s Bitcoin address.'
            : ''}
        </small>
      </label>

      <label className={fields.label}>
        Slippage tolerance
        <select
          className={fields.control}
          value={slippageBps}
          onChange={e => {
            setSlippageBps(Number(e.target.value));
            inputsChanged();
          }}
        >
          {config.withdrawalSlippageOptionsBps.map(bps => (
            <option key={bps} value={bps}>
              {bps / 100}%
            </option>
          ))}
        </select>
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

      {preview && token && (
        <dl className={details()}>
          <dt>You receive about</dt>
          <dd>
            {formatTokenAmount(preview.amountOut, token)} {token.symbol} on {token.blockchain}
          </dd>
          <dt>At least</dt>
          <dd>
            {formatTokenAmount(preview.minAmountOut, token)} {token.symbol}, or the BTC is refunded
          </dd>
          <dt>You withdraw</dt>
          <dd>{sats(preview.amountSats)} of sBTC</dd>
          <dt>Signer fee cap</dt>
          <dd>
            Up to {sats(preview.maxFeeSats)} for the Bitcoin payout, at{' '}
            {preview.feeRateSatsPerVbyte} sat/vB; the unused part comes back as sBTC
          </dd>
          <dt>Swap provider fees</dt>
          <dd>
            {preview.providerFees.reduce((sum, f) => sum + f.fee, 0) / 100}%
            {preview.refundFeeSats !== null
              ? `, and ${sats(preview.refundFeeSats)} if the BTC has to be refunded`
              : ''}
          </dd>
          <dt>Our fee</dt>
          <dd>{config.appFeeBps / 100}%</dd>
          <dt>Typical time</dt>
          <dd>A few hours; the sBTC signers wait for Bitcoin confirmations before paying out</dd>
          {balance !== null && preview.lockedSats > balance && (
            <dd className={notice({ tone: 'warn' })}>
              Your balance of {sats(balance)} does not cover the {sats(preview.lockedSats)} this
              locks (the amount plus the fee cap).
            </dd>
          )}
        </dl>
      )}

      {live && token && (
        <div className={confirmBox}>
          <h3 ref={confirmRef} tabIndex={-1} className={confirmTitle}>
            Check the live quote before you sign
          </h3>
          {live.change?.worse &&
            preview &&
            describeQuoteChange(live.change, preview, live.receipt, token).map(line => (
              <p key={line} className={notice({ tone: 'warn' })} role="alert">
                {line}
              </p>
            ))}
          <dl className={details()}>
            <dt>You sign away</dt>
            <dd>
              {sats(live.receipt.lockedSats)} of sBTC: {sats(live.receipt.amountSats)} plus a fee
              cap of {sats(live.receipt.maxFeeSats)}
            </dd>
            <dt>You receive about</dt>
            <dd>
              {formatTokenAmount(live.receipt.amountOut, token)} {token.symbol} on{' '}
              {token.blockchain}
            </dd>
            <dt>At least</dt>
            <dd>
              {formatTokenAmount(live.receipt.minAmountOut, token)} {token.symbol}
            </dd>
            <dt>Delivered to</dt>
            <dd>
              <code>{live.receipt.destinationRecipient}</code>
            </dd>
            <dt>BTC is paid to the swap at</dt>
            <dd>
              <code>{live.receipt.depositAddress}</code>
            </dd>
            <dt>Refunds go to</dt>
            <dd>
              <code>{live.receipt.refundTo}</code>
            </dd>
            <dt>Quote valid until</dt>
            <dd>{new Date(live.receipt.quoteDeadline).toLocaleString()}</dd>
          </dl>
          <div className={actions()}>
            <button
              className={button({ variant: 'primary' })}
              aria-disabled={signing}
              onClick={() => void sign(live)}
            >
              {signing ? 'Confirm in your wallet…' : 'Sign the withdrawal in your wallet'}
            </button>
            <button
              className={button()}
              disabled={signing}
              onClick={() => {
                setLive(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
          <p className={afterActions}>
            Your wallet shows a post-condition that lets exactly {sats(live.receipt.lockedSats)} of
            sBTC leave your account and nothing else. Signing downloads a receipt file; keep it.
          </p>
        </div>
      )}

      {!live && (
        <div className={actions()}>
          <button
            className={button()}
            disabled={!token || amountSats === null || !recipient || !refundTo}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) void getPreview();
            }}
          >
            {busy && !preview ? 'Working…' : 'Get quote'}
          </button>
          {preview && (
            <button
              className={button({ variant: 'primary' })}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) void getLiveQuote();
              }}
            >
              {busy ? 'Working…' : 'Continue'}
            </button>
          )}
        </div>
      )}
      {preview && !live && (
        <p className={afterActions}>
          Continuing asks NEAR Intents for a live quote and a swap address. Nothing is signed until
          you confirm it.
        </p>
      )}
    </section>
  );
}
