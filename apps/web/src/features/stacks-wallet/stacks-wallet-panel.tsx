import { useState } from 'react';

import { css, cx } from 'satway-styles/css';
import { actions, button, details, notice } from 'satway-styles/recipes';

import { errorMessage } from '@satway/core';

import {
  StacksWalletDeclinedError,
  type WalletAccount,
  localStorageWorks,
} from '../../shared/index.js';
import { connected, end, endLede, endTitle, short } from '../../ui/index.js';
import { connectWallet, disconnectWallet } from './wallet.js';

const toActions = cx(actions(), css({ justifyContent: { base: 'flex-start', md: 'flex-end' } }));

export function StacksWalletPanel(props: {
  account: WalletAccount | null;
  onChange(a: WalletAccount | null): void;
  direction?: 'deposit' | 'withdraw';
}) {
  const withdraw = props.direction === 'withdraw';
  const sideActions = withdraw ? actions() : toActions;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [storageWorks] = useState(localStorageWorks);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      props.onChange(await connectWallet());
    } catch (err) {
      setError(
        err instanceof StacksWalletDeclinedError
          ? 'The wallet was closed without connecting. Connect again when you are ready.'
          : errorMessage(err) || 'Wallet connection was cancelled'
      );
    } finally {
      setBusy(false);
    }
  }

  const notConnected = storageWorks ? (
    <>
      <p className={notice()}>
        {withdraw
          ? 'Required. It holds the sBTC you withdraw and signs the withdrawal request.'
          : 'Required. It supplies the Stacks address that receives your sBTC and the Bitcoin key that lets you take your BTC back if a deposit is never minted.'}
      </p>
      <div className={sideActions}>
        <button
          className={button({ variant: 'primary' })}
          disabled={busy}
          onClick={() => void onConnect()}
        >
          {busy ? 'Connecting…' : 'Connect Stacks wallet'}
        </button>
      </div>
    </>
  ) : (
    <>
      <p className={notice({ tone: 'warn' })} role="alert">
        Connecting a Stacks wallet needs this site to store data in your browser, and this browser
        is blocking that (private browsing, or site data turned off for this site).
      </p>
      <p className={notice()}>
        Allow site data for this page, or open it outside private browsing, then reload. A deposit
        cannot be started without the wallet: it supplies the Stacks address that receives your sBTC
        and the Bitcoin key that lets you take your BTC back, and there is no manual way to enter
        them here. Checking a deposit from its receipt file still works on the Deposit tab.
      </p>
    </>
  );

  return (
    <section className={end({ side: withdraw ? 'from' : 'to' })} aria-labelledby="stacks-title">
      <h2 id="stacks-title" className={endTitle}>
        {withdraw ? 'From' : 'To'}
      </h2>
      <p className={endLede}>Your Stacks wallet, Leather or Xverse</p>

      {props.account ? (
        <>
          <p className={connected}>Connected</p>
          <dl className={details({ layout: 'stacked' })}>
            <dt>{withdraw ? 'sBTC comes from' : 'sBTC goes to'}</dt>
            <dd>
              <code title={props.account.stacksAddress}>{short(props.account.stacksAddress)}</code>
            </dd>
            <dt>{withdraw ? 'Bitcoin address' : 'Reclaim key from'}</dt>
            <dd>
              <code title={props.account.reclaimKeyAddress}>
                {short(props.account.reclaimKeyAddress)}
              </code>
            </dd>
          </dl>
          <div className={sideActions}>
            <button
              className={button()}
              onClick={() => {
                disconnectWallet();
                props.onChange(null);
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        notConnected
      )}
      {error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
