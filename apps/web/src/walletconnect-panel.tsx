import { useEffect, useReducer, useRef, useState } from 'react';

import { css, cx } from 'portage-styles/css';
import { styled } from 'portage-styles/jsx';
import { actions, button, link, notice } from 'portage-styles/recipes';

import type { SourceWallet } from './source-wallet.js';
import { WalletName, WalletNote } from './wallet-option.js';
import {
  INITIAL_PAIRING,
  pairingReducer,
  qrPath,
  walletConnectErrorMessage,
} from './walletconnect.js';

const QUIET_ZONE = 4;

const qr = css({
  display: 'block',
  width: 'full',
  maxWidth: 'qr',
  height: 'auto',
  marginTop: 'space.06',
});

const openInWallet = cx(
  link(),
  css({
    display: { base: 'inline-flex', md: 'none' },
    alignItems: 'center',
    minHeight: 'control',
    paddingBlock: 'space.04',
    paddingInline: 'space.07',
    fontWeight: 'medium',
  })
);

const pairingActions = cx(actions(), css({ marginTop: 'space.06' }));

const pairingButton = button();

export function QrCode(props: { matrix: boolean[][]; label: string }) {
  const size = props.matrix.length + QUIET_ZONE * 2;
  return (
    <svg
      className={qr}
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${size} ${size}`}
      role="img"
      aria-label={props.label}
      shapeRendering="crispEdges"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={size} height={size} fill="#ffffff" />
      <path d={qrPath(props.matrix)} fill="#000000" />
    </svg>
  );
}

export function WalletConnectOption(props: {
  disabled: boolean;
  onConnected(wallet: SourceWallet): void;
  onEnded(key: object): void;
}) {
  const [state, dispatch] = useReducer(pairingReducer, INITIAL_PAIRING);
  const [copied, setCopied] = useState(false);
  const attempt = useRef(0);
  const { onConnected, onEnded } = props;

  useEffect(() => {
    return () => {
      attempt.current += 1;
    };
  }, []);

  async function start() {
    attempt.current += 1;
    const mine = attempt.current;
    dispatch({ type: 'start', attempt: mine });
    setCopied(false);
    try {
      const { connectWalletConnect } = await import('./walletconnect-client.js');
      const wallet = await connectWalletConnect({
        onUri: (uri, matrix) => dispatch({ type: 'uri', attempt: mine, uri, matrix }),
        onEnded,
        cancelled: () => attempt.current !== mine,
      });
      if (attempt.current !== mine) return;
      dispatch({ type: 'connected', attempt: mine });
      onConnected(wallet);
    } catch (err) {
      dispatch({ type: 'fail', attempt: mine, message: walletConnectErrorMessage(err) });
    }
  }

  function cancel() {
    attempt.current += 1;
    dispatch({ type: 'cancel' });
  }

  async function copy(uri: string) {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (state.status === 'idle' || state.status === 'failed') {
    return (
      <>
        <button
          className={button({ layout: 'stacked' })}
          disabled={props.disabled}
          onClick={() => void start()}
        >
          <WalletName>WalletConnect</WalletName>
          <WalletNote>Scan with a mobile wallet</WalletNote>
        </button>
        {state.status === 'failed' && (
          <p className={notice({ tone: 'error' })} role="alert">
            {state.message}
          </p>
        )}
      </>
    );
  }

  return (
    <styled.div
      borderWidth="hairline"
      borderStyle="solid"
      borderColor="hairline"
      borderRadius="lg"
      paddingBlock="space.08"
      paddingInline="space.08"
      backgroundColor="surface"
      aria-live="polite"
    >
      {state.status === 'starting' ? (
        <p className={notice()}>Getting a WalletConnect code…</p>
      ) : (
        <>
          <p>Scan with a WalletConnect wallet, then approve the connection there.</p>
          <QrCode matrix={state.matrix} label="WalletConnect pairing code" />
          <div className={pairingActions}>
            <a className={openInWallet} href={state.uri}>
              Open in wallet
            </a>
            <button className={pairingButton} onClick={() => void copy(state.uri)}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button className={pairingButton} onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}
      {state.status === 'starting' && (
        <div className={pairingActions}>
          <button className={pairingButton} onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
    </styled.div>
  );
}
