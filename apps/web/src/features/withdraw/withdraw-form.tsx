import { useEffect, useMemo, useRef, useState } from 'react';

import { css, cx } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { actions, button, field, notice, sheet } from 'satway-styles/recipes';

import { type SourceWallet, nextRefundField, walletAddressFor } from '@satway/chains';
import {
  type OneClickToken,
  type WithdrawalContractCall,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
  errorMessage,
  fetchSbtcBalance,
} from '@satway/core';

import {
  type ActiveWithdrawal,
  type Backend,
  type WalletAccount,
  type WithdrawalBackend,
  useFlow,
} from '../../shared/index.js';
import type { WithdrawalRouteUpdate } from '../../ui/index.js';
import {
  type FlowDeps,
  liveQuoteFor,
  previewFor,
  sats,
  satsOrNull,
  signingRefusal,
  withdrawalDestinations,
} from './flow.js';
import { type FormEvent, INITIAL_FORM, formMachine, formView } from './form-state.js';
import { ConfirmLiveQuote, PreviewDetails } from './quote-details.js';
import { DECLINED_MESSAGE, signWithdrawal } from './sign-withdrawal.js';

const fields = field();

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));

export interface WithdrawFormProps {
  backend: Backend;
  quotes: WithdrawalBackend;
  account: WalletAccount;
  destinationWallet: SourceWallet | null;
  walletPromptOpen: boolean;
  onActive(update: (current: ActiveWithdrawal | null) => ActiveWithdrawal | null): void;
  requestWithdrawal(call: WithdrawalContractCall): Promise<string>;
  onRoute(route: WithdrawalRouteUpdate | null): void;
  onSigning(signing: boolean): void;
}

export function WithdrawForm(props: WithdrawFormProps) {
  const { backend, quotes, account, destinationWallet, onRoute } = props;
  const deps: FlowDeps = useMemo(() => ({ config, backend, quotes }), [backend, quotes]);
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [tokenAttempt, setTokenAttempt] = useState(0);
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [refundTo, setRefundTo] = useState(account.reclaimKeyAddress);
  const [slippageBps, setSlippageBps] = useState(config.withdrawalDefaultSlippageBps);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const flow = useFlow(formMachine, () => INITIAL_FORM);
  const view = formView(flow.state.step);
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
        setTokensError(null);
      } catch (err) {
        if (!live) return;
        setTokensError(`Could not load the asset list: ${errorMessage(err) ?? 'unknown error'}`);
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
  const { dispatch } = flow;
  useEffect(() => {
    const next = nextRefundField(
      { value: recipientRef.current, autofilled: autofilled.current },
      walletAddress
    );
    autofilled.current = next.autofilled;
    if (next.value !== recipientRef.current) {
      setRecipient(next.value);
      dispatch({ type: 'autofilled' });
    }
  }, [walletAddress, dispatch]);

  useEffect(() => {
    onRoute({
      destination: token ? `${token.symbol} on ${token.blockchain}` : null,
      milestones: null,
    });
  }, [onRoute, token]);

  const { live } = view;
  useEffect(() => {
    if (live) confirmRef.current?.focus();
  }, [live]);

  function edit() {
    dispatch({ type: 'edited' });
  }

  const form = token ? { token, amount, recipient, refundTo, slippageBps } : null;

  function startedQuote(event: FormEvent): number | null {
    const before = flow.current();
    dispatch(event);
    const after = flow.current();
    if (after.last === before.last || after.step.kind !== 'quoting') return null;
    return after.step.request;
  }

  async function getPreview() {
    if (!form) return;
    const request = startedQuote({ type: 'preview-requested', inputs: form });
    if (request === null) return;
    try {
      const preview = await previewFor(deps, form);
      dispatch({ type: 'preview-ready', request, preview });
    } catch (err) {
      dispatch({
        type: 'quote-failed',
        request,
        message: errorMessage(err) ?? 'The quote could not be checked',
      });
    }
  }

  async function getLiveQuote() {
    if (!form || !view.preview) return;
    const preview = view.preview;
    const request = startedQuote({ type: 'live-requested', inputs: form });
    if (request === null) return;
    const signal = flow.signal(request);
    try {
      const next = await liveQuoteFor(deps, form, account.stacksAddress, preview, signal);
      if (signal.aborted) return;
      setBalance(next.balanceSats);
      dispatch({ type: 'live-ready', request, live: next });
    } catch (err) {
      dispatch({
        type: 'quote-failed',
        request,
        message: errorMessage(err) ?? 'The withdrawal could not be prepared',
      });
    }
  }

  const walletOpen = view.signing || props.walletPromptOpen;

  async function sign() {
    const quote = view.live;
    if (!token || !quote || walletOpen) return;
    const refusal = signingRefusal(config, quote.receipt, new Date());
    if (refusal) {
      dispatch({ type: 'sign-refused', message: refusal });
      return;
    }
    dispatch({ type: 'sign-started' });
    const { onSigning } = props;
    onSigning(true);
    try {
      const outcome = await signWithdrawal(props, quote, token);
      dispatch(
        outcome === 'declined'
          ? { type: 'wallet-declined', message: DECLINED_MESSAGE }
          : { type: 'wallet-answered' }
      );
    } finally {
      onSigning(false);
    }
  }

  const amountSats = satsOrNull(amount);
  const error = view.error ?? tokensError;

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
            edit();
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
            edit();
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
            edit();
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
            edit();
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
            edit();
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
      {tokensError && (
        <div className={actions()}>
          <button
            className={button()}
            onClick={() => {
              setTokensError(null);
              setTokenAttempt(attempt => attempt + 1);
            }}
          >
            Load the asset list again
          </button>
        </div>
      )}

      {view.preview && token && (
        <PreviewDetails preview={view.preview} token={token} balance={balance} />
      )}

      {view.live && view.preview && token && (
        <ConfirmLiveQuote
          live={view.live}
          preview={view.preview}
          token={token}
          walletOpen={walletOpen}
          headingRef={confirmRef}
          onSign={() => void sign()}
          onCancel={() => dispatch({ type: 'cancelled' })}
        />
      )}

      {!view.live && (
        <div className={actions()}>
          <button
            className={button()}
            disabled={!token || amountSats === null || !recipient || !refundTo}
            aria-disabled={view.busy}
            onClick={() => {
              if (!view.busy) void getPreview();
            }}
          >
            {view.busy && !view.preview ? 'Working…' : 'Get quote'}
          </button>
          {view.preview && (
            <button
              className={button({ variant: 'primary' })}
              aria-disabled={view.busy}
              onClick={() => {
                if (!view.busy) void getLiveQuote();
              }}
            >
              {view.busy ? 'Working…' : 'Continue'}
            </button>
          )}
        </div>
      )}
      {view.preview && !view.live && (
        <p className={afterActions}>
          Continuing asks NEAR Intents for a live quote and a swap address. Nothing is signed until
          you confirm it.
        </p>
      )}
    </section>
  );
}
