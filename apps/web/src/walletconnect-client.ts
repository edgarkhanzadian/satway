import { UniversalProvider } from '@walletconnect/universal-provider';
import { encode } from 'uqr';

import {
  SOLANA_MAINNET_CAIP2,
  WALLETCONNECT_PROJECT_ID,
  WALLETCONNECT_RELAY_URL,
  WALLETCONNECT_STORAGE_PREFIX,
  walletConnectMetadata,
} from './config.js';
import type { SourceWallet } from './source-wallet.js';
import {
  DISCONNECT_TIMEOUT_MS,
  PAIRING_TIMEOUT_MS,
  RELAY_TIMEOUT_MS,
  type SolanaSessionTransport,
  type WalletConnectTransport,
  approvedChainIds,
  evmNamespaces,
  isPairingUri,
  readSession,
  registerSessionEnd,
  sessionKey,
  sessionWallet,
  solanaNamespaces,
  walletConnectProvider,
  walletConnectSolanaSender,
} from './walletconnect.js';

type Client = InstanceType<typeof UniversalProvider>;

export interface WalletConnectAttempt {
  onUri(uri: string, matrix: boolean[][]): void;
  onEnded(key: object): void;
  cancelled(): boolean;
}

let shared: Promise<Client> | null = null;

async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function ignore(): undefined {
  return undefined;
}

async function client(): Promise<Client> {
  shared ??= UniversalProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    relayUrl: WALLETCONNECT_RELAY_URL,
    metadata: walletConnectMetadata(window.location.origin),
    customStoragePrefix: WALLETCONNECT_STORAGE_PREFIX,
    telemetryEnabled: false,
    logger: 'error',
  });
  const pending = shared;
  try {
    return await withTimeout(pending, RELAY_TIMEOUT_MS, 'Timed out reaching the relay');
  } catch (err) {
    if (shared === pending) shared = null;
    throw err;
  }
}

function transport(up: Client): WalletConnectTransport {
  return {
    request: args => up.request(args),
    approvedChainIds: () => approvedChainIds(up.session?.namespaces),
  };
}

async function endSession(up: Client): Promise<void> {
  if (!up.session) return;
  await withTimeout(up.disconnect(), DISCONNECT_TIMEOUT_MS, 'Timed out reaching the relay');
}

function solanaTransport(up: Client): SolanaSessionTransport {
  return {
    request: args => up.request(args, SOLANA_MAINNET_CAIP2),
    namespaces: () => up.session?.namespaces,
  };
}

function finish(up: Client, session: unknown, attempt: WalletConnectAttempt): SourceWallet {
  const info = readSession(session);
  if (info.evm) up.setDefaultChain(`eip155:${info.evm.activeChainId}`);
  else up.setDefaultChain(SOLANA_MAINNET_CAIP2);
  const provider = info.evm ? walletConnectProvider(transport(up)) : null;
  const solanaSender = info.solana
    ? walletConnectSolanaSender(solanaTransport(up), info.solana.address)
    : null;
  const wallet = sessionWallet(info, provider, solanaSender);
  const key = sessionKey(wallet);
  function ended() {
    up.off('session_delete', ended);
    if (key) attempt.onEnded(key);
  }
  up.on('session_delete', ended);
  if (key)
    registerSessionEnd(key, async () => {
      up.off('session_delete', ended);
      await endSession(up);
    });
  return wallet;
}

export async function connectWalletConnect(attempt: WalletConnectAttempt): Promise<SourceWallet> {
  const up = await client();
  if (up.session) {
    try {
      return finish(up, up.session, attempt);
    } catch {
      await endSession(up);
    }
  }

  let shown: (() => void) | null = null;
  const uriShown = new Promise<void>(resolve => {
    shown = resolve;
  });
  function onUri(uri: unknown) {
    if (typeof uri !== 'string' || !isPairingUri(uri) || attempt.cancelled()) return;
    attempt.onUri(uri, encode(uri, { ecc: 'M', border: 0 }).data);
    shown?.();
  }
  up.on('display_uri', onUri);
  try {
    const connecting = up.connect({
      optionalNamespaces: { ...evmNamespaces(), ...solanaNamespaces() },
    });
    void connecting.catch(ignore);
    await withTimeout(
      Promise.race([uriShown, connecting]),
      RELAY_TIMEOUT_MS,
      'Timed out reaching the relay'
    );
    const session = await withTimeout(connecting, PAIRING_TIMEOUT_MS, 'Pairing expired');
    if (!session) throw new Error('The wallet did not approve a session');
    if (attempt.cancelled()) {
      await endSession(up);
      throw new Error('Cancelled');
    }
    return finish(up, session, attempt);
  } finally {
    up.off('display_uri', onUri);
  }
}
