import { css, cx } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { actions, button, details, field, notice, sheet } from 'satway-styles/recipes';

import { type OneClickToken, MAINNET_CONFIG as config } from '@satway/core';

import type { WalletAccount } from '../../shared/index.js';
import { sats } from './sats.js';
import type { DepositForm as Form } from './use-deposit-form.js';

const fields = field();

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));

const NEW_ADDRESS_NOTE =
  'A new Bitcoin deposit address for this deposit only, built from your keys when you continue.';

export function DepositForm(props: {
  account: WalletAccount;
  tokens: readonly OneClickToken[];
  tokenError: string | null;
  onRetryTokens(): void;
  form: Form;
}) {
  const { account, tokens, form } = props;
  const { view, token } = form;
  const { preview, repriced, busy } = view;
  const error = props.tokenError ?? view.error;

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
          value={form.assetId}
          onChange={e => form.chooseAsset(e.target.value)}
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
          value={form.amount}
          placeholder="25"
          onChange={e => form.typeAmount(e.target.value)}
        />
      </label>

      <label className={fields.label}>
        Refund address{token ? ` on ${token.blockchain}` : ''}
        <input
          className={fields.control}
          value={form.refundTo}
          placeholder="Your own address on the chain you are sending from"
          spellCheck={false}
          onChange={e => form.typeRefund(e.target.value)}
        />
        <small className={fields.hint}>
          {form.covered
            ? 'Filled in from your connected wallet. If the swap cannot complete, your funds go back here.'
            : 'If the swap cannot complete, your funds go back here. Use a wallet you control, not an exchange deposit address.'}
        </small>
      </label>

      {error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {error}
        </p>
      )}
      {props.tokenError !== null && (
        <div className={actions()}>
          <button className={button()} onClick={props.onRetryTokens}>
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
          <dd>{NEW_ADDRESS_NOTE}</dd>
          {preview.warnings.map(w => (
            <dd key={w} className={notice({ tone: 'warn' })}>
              {w}
            </dd>
          ))}
        </dl>
      )}

      {repriced ? (
        <>
          <p className={notice({ tone: 'warn' })} role="status">
            The price moved since your quote. You would now receive about{' '}
            {sats(repriced.live.expectedSats)} as sBTC, at least {sats(repriced.live.minimumSats)},
            instead of about {sats(repriced.preview.expectedSats)}, at least{' '}
            {sats(repriced.preview.minimumSats)}. Continue only if the new amounts are acceptable.
          </p>
          <div className={actions()}>
            <button
              className={button({ variant: 'primary' })}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) form.acceptRepriced();
              }}
            >
              Continue with the new amounts
            </button>
            <button className={button()} disabled={busy} onClick={form.declineRepriced}>
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
              disabled={!token || !form.amount || !form.refundTo}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) form.getQuote();
              }}
            >
              {busy ? 'Working…' : 'Get quote'}
            </button>
            {preview && (
              <button
                className={button({ variant: 'primary' })}
                aria-disabled={busy}
                onClick={() => {
                  if (!busy) form.continueLive();
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
