import { useEffect, useRef, useState } from 'react';

import { css, cva, cx } from 'portage-styles/css';
import { actions, button, details, notice } from 'portage-styles/recipes';

import { errorMessage } from '@portage/core';

import {
  type SolanaWalletOption,
  connectStandardSolana,
  discoverSolanaWallets,
} from './solana-wallet.js';
import {
  type EvmWalletOption,
  type SourceWallet,
  connectEvm,
  connectSolana,
  discoverEvmWallets,
  findSolanaWallet,
} from './source-wallet.js';
import { WalletName, WalletNote } from './wallet-option.js';
import { type WalletAccount, connectWallet, disconnectWallet } from './wallet.js';
import { WalletConnectOption } from './walletconnect-panel.js';
import { endWalletSession, sessionKey } from './walletconnect.js';

const end = cva({
  base: { maxWidth: 'end', overflowWrap: 'anywhere', minWidth: 'zero' },
  variants: {
    side: {
      from: { gridArea: 'from' },
      to: {
        gridArea: 'to',
        textAlign: { base: 'left', md: 'right' },
        justifySelf: { base: 'start', md: 'end' },
      },
    },
  },
});

const endTitle = css({
  textStyle: 'title',
  margin: 'space.00',
});

const endLede = css({
  textStyle: 'lede',
  marginTop: 'space.03',
  marginInline: 'space.00',
  marginBottom: 'space.06',
});

const connected = css({ fontWeight: 'semibold', marginBottom: 'space.02' });

const toActions = cx(actions(), css({ justifyContent: { base: 'flex-start', md: 'flex-end' } }));

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

function short(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

export function SourceWalletPanel(props: {
  wallet: SourceWallet | null;
  onChange(w: SourceWallet | null): void;
}) {
  const [evmWallets, setEvmWallets] = useState<EvmWalletOption[]>([]);
  const [solanaWallets, setSolanaWallets] = useState<SolanaWalletOption[]>([]);
  const [hasSolana, setHasSolana] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useRef(props.wallet);
  const { onChange } = props;

  useEffect(() => {
    current.current = props.wallet;
  }, [props.wallet]);

  function onWalletConnectEnded(key: object) {
    if (sessionKey(current.current) !== key) return;
    onChange(null);
    setError('The wallet ended the WalletConnect session.');
  }

  async function disconnect() {
    const wallet = props.wallet;
    setBusy(true);
    setError(null);
    try {
      await endWalletSession(wallet);
    } catch (err) {
      setError(
        `The WalletConnect session may still be open in your wallet: ${errorMessage(err) ?? 'unknown error'}`
      );
    } finally {
      setBusy(false);
      onChange(null);
    }
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
    <section className={end({ side: 'from' })} aria-labelledby="source-title">
      <h2 id="source-title" className={endTitle}>
        From
      </h2>
      <p className={endLede}>Your wallet on another chain</p>

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
          <p className={notice()}>
            {canSend(props.wallet)
              ? 'Used as your refund address, and to send the funds when you are ready.'
              : 'Used as your refund address. You send the funds from this wallet yourself.'}
          </p>
          <div className={actions()}>
            <button className={button()} disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={notice()}>
            Optional. Connect the wallet holding the funds you want to move, on any chain NEAR
            Intents supports.
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
                <WalletNote>Fills in the refund address only</WalletNote>
              </button>
            )}
            <WalletConnectOption
              disabled={busy}
              onConnected={wallet => {
                setError(null);
                onChange(wallet);
              }}
              onEnded={onWalletConnectEnded}
            />
          </div>
          {evmWallets.length === 0 && solanaWallets.length === 0 && !hasSolana && (
            <p className={notice()}>
              No EVM or Solana wallet was found in this browser. WalletConnect works with a wallet
              on your phone.
            </p>
          )}
          <p className={notice()}>
            No wallet, or a different chain? Skip this: you can type a refund address and send the
            funds yourself.
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
