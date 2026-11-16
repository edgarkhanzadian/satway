import { useEffect, useState } from 'react';

import { css, cx } from 'satway-styles/css';
import { actions, button, details, notice } from 'satway-styles/recipes';

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
import { connectSolana, discoverEvmWallets, findSolanaWallet } from './injected-wallets.js';
import {
  type SolanaWalletOption,
  connectStandardSolana,
  discoverSolanaWallets,
} from './solana-wallet.js';

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

function walletLines(wallet: SourceWallet): { label: string; address: string }[] {
  if (wallet.kind === 'solana') return [{ label: 'Solana', address: wallet.address }];
  const lines = [{ label: 'EVM', address: wallet.address }];
  if (wallet.solana) lines.push({ label: 'Solana', address: wallet.solana.address });
  return lines;
}

function canSend(wallet: SourceWallet): boolean {
  return wallet.kind === 'evm' || wallet.sender !== undefined;
}

function connectedNote(wallet: SourceWallet, withdraw: boolean): string {
  if (withdraw) return 'Used to fill in the address that receives your withdrawal.';
  return canSend(wallet)
    ? 'Used as your refund address, and to send the funds when you are ready.'
    : 'Used as your refund address. You send the funds from this wallet yourself.';
}

export function SourceWalletPanel(props: {
  wallet: SourceWallet | null;
  onChange(w: SourceWallet | null): void;
  direction?: 'deposit' | 'withdraw';
}) {
  const withdraw = props.direction === 'withdraw';
  const [evmWallets, setEvmWallets] = useState<EvmWalletOption[]>([]);
  const [solanaWallets, setSolanaWallets] = useState<SolanaWalletOption[]>([]);
  const [hasSolana, setHasSolana] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function disconnect() {
    setError(null);
    props.onChange(null);
  }

  useEffect(() => {
    let live = true;
    async function discover() {
      const [evm, solana] = await Promise.all([discoverEvmWallets(), discoverSolanaWallets()]);
      if (!live) return;
      setEvmWallets(evm);
      setSolanaWallets(solana);
    }
    void discover();
    setHasSolana(findSolanaWallet() !== null);
    return () => {
      live = false;
    };
  }, []);

  async function run(connect: () => Promise<SourceWallet>) {
    setBusy(true);
    setError(null);
    try {
      props.onChange(await connect());
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
          {walletLines(props.wallet).length > 1 ? (
            <dl className={details({ layout: 'stacked' })}>
              {walletLines(props.wallet).map(line => (
                <div key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>
                    <code title={line.address}>{short(line.address)}</code>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>
              <code title={props.wallet.address}>{short(props.wallet.address)}</code>
            </p>
          )}
          <p className={notice()}>{connectedNote(props.wallet, withdraw)}</p>
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
              ? 'Optional. Connect the EVM or Solana wallet that should receive the funds, to fill in its address.'
              : 'Optional. Connect the wallet holding the funds you want to move, on any chain NEAR Intents supports.'}
          </p>
          <div className={walletList}>
            {evmWallets.map(option => (
              <button
                key={option.id}
                className={walletOption}
                disabled={busy}
                onClick={() => void run(() => connectEvm(option))}
              >
                <WalletName>{option.name}</WalletName>
                <WalletNote>For Ethereum, Base, Arbitrum and other EVM chains</WalletNote>
              </button>
            ))}
            {solanaWallets.map(option => (
              <button
                key={option.id}
                className={walletOption}
                disabled={busy}
                onClick={() => void run(() => connectStandardSolana(option))}
              >
                <WalletName>{option.name}</WalletName>
                <WalletNote>For Solana</WalletNote>
              </button>
            ))}
            {hasSolana && solanaWallets.length === 0 && (
              <button
                className={walletOption}
                disabled={busy}
                onClick={() => void run(connectSolana)}
              >
                <WalletName>Solana wallet</WalletName>
                <WalletNote>
                  {withdraw ? 'Fills in the address only' : 'Fills in the refund address only'}
                </WalletNote>
              </button>
            )}
          </div>
          {evmWallets.length === 0 && solanaWallets.length === 0 && !hasSolana && (
            <p className={notice()}>No EVM or Solana wallet was found in this browser.</p>
          )}
          <p className={notice()}>
            {withdraw
              ? 'No wallet here? Skip this: you can type the address yourself.'
              : 'No wallet, or a different chain? Skip this: you can type a refund address and send the funds yourself.'}
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
