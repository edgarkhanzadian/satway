import { useState } from 'react';

import { css, cx } from 'portage-styles/css';
import { actions, button, details, notice } from 'portage-styles/recipes';

import { errorMessage } from '@portage/core';

import type { WalletAccount } from '../../shared/index.js';
import { connected, end, endLede, endTitle, short } from '../../ui/index.js';
import { connectWallet, disconnectWallet } from './wallet.js';

const toActions = cx(actions(), css({ justifyContent: { base: 'flex-start', md: 'flex-end' } }));

export function StacksWalletPanel(props: {
  account: WalletAccount | null;
  onChange(a: WalletAccount | null): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      props.onChange(await connectWallet());
    } catch (err) {
      setError(errorMessage(err) || 'Wallet connection was cancelled');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={end({ side: 'to' })} aria-labelledby="stacks-title">
      <h2 id="stacks-title" className={endTitle}>
        To
      </h2>
      <p className={endLede}>Your Stacks wallet, Leather or Xverse</p>

      {props.account ? (
        <>
          <p className={connected}>Connected</p>
          <dl className={details({ layout: 'stacked' })}>
            <dt>sBTC goes to</dt>
            <dd>
              <code title={props.account.stacksAddress}>{short(props.account.stacksAddress)}</code>
            </dd>
            <dt>Reclaim key from</dt>
            <dd>
              <code title={props.account.reclaimKeyAddress}>
                {short(props.account.reclaimKeyAddress)}
              </code>
            </dd>
          </dl>
          <div className={toActions}>
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
        <>
          <p className={notice()}>
            Required. It supplies the Stacks address that receives your sBTC and the Bitcoin key
            that lets you take your BTC back if a deposit is never minted.
          </p>
          <div className={toActions}>
            <button
              className={button({ variant: 'primary' })}
              disabled={busy}
              onClick={() => void onConnect()}
            >
              {busy ? 'Connecting…' : 'Connect Stacks wallet'}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
