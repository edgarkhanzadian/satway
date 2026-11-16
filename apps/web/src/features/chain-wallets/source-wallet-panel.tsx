import { useEffect, useState } from 'react';

import { css, cx } from 'satway-styles/css';
import { actions, button, notice } from 'satway-styles/recipes';

import { type EvmWalletOption, type SourceWallet, connectEvm } from '@satway/chains';
import { errorMessage } from '@satway/core';

import {
  WalletName,
  WalletNote,
  connected,
  end,
  endLede,
  endTitle,
  short,
} from '../../ui/index.js';
import { discoverEvmWallets } from './injected-wallets.js';

const toSideActions = cx(
  actions(),
  css({ justifyContent: { base: 'flex-start', md: 'flex-end' } })
);

const walletList = css({
  display: 'grid',
  gap: 'space.04',
  marginBlock: 'space.06',
  _empty: { display: 'none' },
});

const walletOption = button({ layout: 'stacked' });

export function SourceWalletPanel(props: {
  wallet: SourceWallet | null;
  onChange(w: SourceWallet | null): void;
  direction?: 'deposit' | 'withdraw';
}) {
  const withdraw = props.direction === 'withdraw';
  const [evmWallets, setEvmWallets] = useState<EvmWalletOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function disconnect() {
    setError(null);
    props.onChange(null);
  }

  useEffect(() => {
    let live = true;
    async function discover() {
      const evm = await discoverEvmWallets();
      if (live) setEvmWallets(evm);
    }
    void discover();
    return () => {
      live = false;
    };
  }, []);

  async function connect(option: EvmWalletOption) {
    setBusy(true);
    setError(null);
    try {
      props.onChange(await connectEvm(option));
    } catch (err) {
      setError(errorMessage(err) || 'Connection was cancelled');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={end({ side: withdraw ? 'to' : 'from' })} aria-labelledby="source-title">
      <h2 id="source-title" className={endTitle}>
        {withdraw ? 'To' : 'From'}
      </h2>
      <p className={endLede}>
        {withdraw ? 'Your wallet on the chain you receive on' : 'Your wallet on another chain'}
      </p>

      {props.wallet ? (
        <>
          <p className={connected}>{props.wallet.name} connected</p>
          <p>
            <code title={props.wallet.address}>{short(props.wallet.address)}</code>
          </p>
          <p className={notice()}>
            {withdraw
              ? 'Used to fill in the address that receives your withdrawal.'
              : 'Used as your refund address, and to send the funds when you are ready.'}
          </p>
          <div className={withdraw ? toSideActions : actions()}>
            <button className={button()} disabled={busy} onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={notice()}>
            {withdraw
              ? 'Optional. Connect the EVM wallet that should receive the funds, to fill in its address.'
              : 'Optional. Connect the EVM wallet holding the funds you want to move.'}
          </p>
          <div className={walletList}>
            {evmWallets.map(option => (
              <button
                key={option.id}
                className={walletOption}
                disabled={busy}
                onClick={() => void connect(option)}
              >
                <WalletName>{option.name}</WalletName>
                <WalletNote>For Ethereum, Base, Arbitrum and other EVM chains</WalletNote>
              </button>
            ))}
          </div>
          {evmWallets.length === 0 && (
            <p className={notice()}>No EVM wallet was found in this browser.</p>
          )}
          <p className={notice()}>
            {withdraw
              ? 'No wallet here? Skip this: you can type the address yourself.'
              : 'No wallet here? Skip this: you can type a refund address and send the funds yourself.'}
          </p>
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
