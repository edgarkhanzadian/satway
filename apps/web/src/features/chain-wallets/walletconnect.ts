import { base58, base64 } from '@scure/base';

import {
  EVM_CHAIN_IDS,
  type Eip1193Provider,
  SOLANA_MAINNET_CAIP2,
  SendError,
  type SolanaSendResult,
  type SolanaSender,
  type SourceWallet,
  isSolanaAddress,
  isSolanaSignature,
  notSent,
  signOnlyFailure,
  walletFailure,
} from '@portage/chains';
import { errorMessage } from '@portage/core';

export const WALLETCONNECT_METHODS: readonly string[] = Object.freeze([
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
]);

export const WALLETCONNECT_EVENTS: readonly string[] = Object.freeze([
  'chainChanged',
  'accountsChanged',
]);

export const PAIRING_TIMEOUT_MS = 5 * 60_000;
export const RELAY_TIMEOUT_MS = 20_000;
export const DISCONNECT_TIMEOUT_MS = 10_000;

const CHAIN_NAMES: Readonly<Record<number, string>> = Object.freeze({
  1: 'Ethereum',
  10: 'OP Mainnet',
  56: 'BNB Smart Chain',
  100: 'Gnosis',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum One',
  43114: 'Avalanche C-Chain',
  80094: 'Berachain',
  534352: 'Scroll',
});

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PAIRING_URI = /^wc:[0-9a-f]{64}@2\?\S+$/;

export function chainName(chainId: number): string {
  return CHAIN_NAMES[chainId] ?? `chain ${chainId}`;
}

export interface WalletConnectNamespace {
  chains: string[];
  methods: string[];
  events: string[];
}

export function evmNamespaces(
  chainIds: readonly number[] = Object.values(EVM_CHAIN_IDS)
): Record<'eip155', WalletConnectNamespace> {
  return {
    eip155: {
      chains: chainIds.map(id => `eip155:${id}`),
      methods: [...WALLETCONNECT_METHODS],
      events: [...WALLETCONNECT_EVENTS],
    },
  };
}

export const SOLANA_WALLETCONNECT_METHODS: readonly string[] = Object.freeze([
  'solana_signAndSendTransaction',
  'solana_signTransaction',
]);

export function solanaNamespaces(): Record<'solana', WalletConnectNamespace> {
  return {
    solana: {
      chains: [SOLANA_MAINNET_CAIP2],
      methods: [...SOLANA_WALLETCONNECT_METHODS],
      events: [],
    },
  };
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const read: unknown = Reflect.get(value, key);
  return read;
}

function strings(value: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

export function parseChainId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  if (/^0x[0-9a-fA-F]+$/.test(value) || /^[1-9][0-9]*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function caipChainId(value: string): number | null {
  const parts = value.split(':');
  if (parts.length !== 2 || parts[0] !== 'eip155') return null;
  return parseChainId(parts[1]);
}

interface CaipAccount {
  chainId: number;
  address: string;
}

function caipAccount(value: string): CaipAccount | null {
  const parts = value.split(':');
  if (parts.length !== 3 || parts[0] !== 'eip155') return null;
  const chainId = parseChainId(parts[1]);
  const address = parts[2];
  if (chainId === null || address === undefined || !EVM_ADDRESS.test(address)) return null;
  return { chainId, address };
}

export interface WalletConnectEvmAccount {
  address: string;
  activeChainId: number;
  chainIds: number[];
}

export interface WalletConnectSession {
  evm: WalletConnectEvmAccount | null;
  solana: { address: string } | null;
  peerName: string | null;
}

export function approvedChainIds(namespaces: unknown): number[] {
  const eip155 = field(namespaces, 'eip155');
  const accountChains = strings(field(eip155, 'accounts'))
    .map(caipAccount)
    .map(account => account?.chainId ?? null);
  const listed = strings(field(eip155, 'chains')).map(caipChainId);
  const supported = new Set(Object.values(EVM_CHAIN_IDS));
  const ids = new Set<number>();
  for (const id of [...listed, ...accountChains]) {
    if (id !== null && supported.has(id)) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

function readEvmAccount(namespaces: unknown): WalletConnectEvmAccount | null {
  const accounts = strings(field(field(namespaces, 'eip155'), 'accounts'));
  const chainIds = approvedChainIds(namespaces);
  const first = accounts
    .map(caipAccount)
    .find(account => account !== null && chainIds.includes(account.chainId));
  if (!first) return null;
  return { address: first.address, activeChainId: first.chainId, chainIds };
}

export interface SolanaApproval {
  addresses: string[];
  methods: string[];
}

export function approvedSolana(namespaces: unknown): SolanaApproval {
  const solana = field(namespaces, 'solana');
  const prefix = `${SOLANA_MAINNET_CAIP2}:`;
  const addresses: string[] = [];
  for (const account of strings(field(solana, 'accounts'))) {
    if (!account.startsWith(prefix)) continue;
    const address = account.slice(prefix.length);
    if (isSolanaAddress(address) && !addresses.includes(address)) addresses.push(address);
  }
  const methods = strings(field(solana, 'methods')).filter(m =>
    SOLANA_WALLETCONNECT_METHODS.includes(m)
  );
  return { addresses, methods };
}

export function readSession(session: unknown): WalletConnectSession {
  const namespaces = field(session, 'namespaces');
  const evm = readEvmAccount(namespaces);
  const solanaAddress = approvedSolana(namespaces).addresses[0];
  const solana = solanaAddress === undefined ? null : { address: solanaAddress };
  if (!evm && !solana)
    throw new Error('The wallet did not share an account on a supported EVM network or Solana');
  const name = field(field(field(session, 'peer'), 'metadata'), 'name');
  const peerName = typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 40) : null;
  return { evm, solana, peerName };
}

export interface WalletConnectTransport {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  approvedChainIds(): number[];
}

function requestedChainId(params: unknown[] | undefined): number | null {
  return parseChainId(field(params?.[0], 'chainId'));
}

export function missingChainMessage(chainId: number): string {
  return `Your WalletConnect wallet did not approve ${chainName(chainId)} for this session. Disconnect, connect again and approve ${chainName(chainId)}, or send the funds yourself.`;
}

export function walletConnectProvider(transport: WalletConnectTransport): Eip1193Provider {
  async function currentChain(): Promise<number> {
    const chainId = parseChainId(await transport.request({ method: 'eth_chainId' }));
    if (chainId === null) throw new Error('The WalletConnect session has no active network');
    return chainId;
  }
  return {
    async request(args) {
      if (args.method === 'eth_chainId') return `0x${(await currentChain()).toString(16)}`;
      if (args.method === 'wallet_switchEthereumChain') {
        const wanted = requestedChainId(args.params);
        if (wanted === null) throw new Error('No network was given to switch to');
        if (!transport.approvedChainIds().includes(wanted))
          throw new Error(missingChainMessage(wanted));
        return transport.request(args);
      }
      if (args.method === 'eth_sendTransaction') {
        let chainId: number;
        try {
          chainId = await currentChain();
        } catch (err) {
          throw notSent(err);
        }
        if (!transport.approvedChainIds().includes(chainId))
          throw new SendError(missingChainMessage(chainId), 'not-sent');
      }
      return transport.request(args);
    },
  };
}

export interface SolanaSessionTransport {
  request(args: { method: string; params: Record<string, unknown> }): Promise<unknown>;
  namespaces(): unknown;
}

export const MISSING_SOLANA_MESSAGE =
  'Your WalletConnect wallet did not approve sending Solana transactions for this session. Disconnect, connect again and approve Solana, or send the funds yourself.';

export function walletConnectSolanaSender(
  transport: SolanaSessionTransport,
  address: string
): SolanaSender {
  return {
    async send(transaction): Promise<SolanaSendResult> {
      const approval = approvedSolana(transport.namespaces());
      if (approval.addresses.length === 0) throw new SendError(MISSING_SOLANA_MESSAGE, 'not-sent');
      if (!approval.addresses.includes(address))
        throw new SendError(
          'The connected wallet account changed. Reconnect and try again.',
          'not-sent'
        );
      const encoded = base64.encode(transaction);
      if (approval.methods.includes('solana_signAndSendTransaction')) {
        let out: unknown;
        try {
          out = await transport.request({
            method: 'solana_signAndSendTransaction',
            params: { transaction: encoded, sendOptions: { preflightCommitment: 'confirmed' } },
          });
        } catch (err) {
          throw walletFailure(err, 'The wallet did not confirm whether it sent the transaction');
        }
        const signature = field(out, 'signature');
        if (typeof signature !== 'string' || !isSolanaSignature(signature))
          throw new SendError('The wallet did not return a transaction signature', 'uncertain');
        return { kind: 'sent', signature };
      }
      if (approval.methods.includes('solana_signTransaction')) {
        let out: unknown;
        try {
          out = await transport.request({
            method: 'solana_signTransaction',
            params: { transaction: encoded },
          });
        } catch (err) {
          throw signOnlyFailure(err);
        }
        const signed = field(out, 'transaction');
        if (typeof signed === 'string' && signed !== '') {
          try {
            return { kind: 'signed', transaction: base64.decode(signed) };
          } catch {
            throw new SendError(
              'The wallet returned a signed transaction that could not be read',
              'not-sent'
            );
          }
        }
        const signature = field(out, 'signature');
        if (typeof signature !== 'string' || !isSolanaSignature(signature))
          throw new SendError('The wallet did not return a transaction signature', 'not-sent');
        try {
          return { kind: 'signed', transaction: withSignature(transaction, signature) };
        } catch (err) {
          throw notSent(err);
        }
      }
      throw new SendError(MISSING_SOLANA_MESSAGE, 'not-sent');
    },
  };
}

export function withSignature(transaction: Uint8Array, signature: string): Uint8Array {
  if (transaction[0] !== 1 || transaction.length < 65)
    throw new Error('Not a single-signer Solana transaction');
  const signed = Uint8Array.from(transaction);
  signed.set(base58.decode(signature), 1);
  return signed;
}

export function sessionWallet(
  session: WalletConnectSession,
  provider: Eip1193Provider | null,
  solanaSender: SolanaSender | null = null
): SourceWallet {
  const name = session.peerName ? `${session.peerName} (WalletConnect)` : 'WalletConnect';
  const solana =
    session.solana && solanaSender
      ? { address: session.solana.address, sender: solanaSender }
      : null;
  if (session.evm && provider) {
    const wallet: SourceWallet = { kind: 'evm', name, address: session.evm.address, provider };
    return solana ? { ...wallet, solana } : wallet;
  }
  if (solana) return { kind: 'solana', name, address: solana.address, sender: solana.sender };
  throw new Error('The wallet did not share an account on a supported EVM network or Solana');
}

export function isPairingUri(uri: unknown): boolean {
  return typeof uri === 'string' && PAIRING_URI.test(uri);
}

export function walletConnectErrorMessage(err: unknown): string {
  const message = errorMessage(err) ?? '';
  const code = field(err, 'code');
  if (code === 4001 || code === 5000 || code === 5002 || /reject|denied|declined/i.test(message))
    return 'The wallet rejected the connection.';
  if (/expired/i.test(message)) return 'The pairing code expired. Start again for a new one.';
  if (/relay|socket|network|fetch|timed? ?out|unreachable|offline/i.test(message))
    return 'Could not reach the WalletConnect relay. Use a browser wallet, or skip this and send the funds yourself.';
  return message ? `WalletConnect failed: ${message}` : 'WalletConnect failed.';
}

export type PairingState =
  | { status: 'idle'; attempt: number }
  | { status: 'starting'; attempt: number }
  | { status: 'pairing'; attempt: number; uri: string; matrix: boolean[][] }
  | { status: 'failed'; attempt: number; message: string };

export type PairingEvent =
  | { type: 'start'; attempt: number }
  | { type: 'uri'; attempt: number; uri: string; matrix: boolean[][] }
  | { type: 'fail'; attempt: number; message: string }
  | { type: 'connected'; attempt: number }
  | { type: 'cancel' };

export const INITIAL_PAIRING: PairingState = Object.freeze({ status: 'idle', attempt: 0 });

export function pairingReducer(state: PairingState, event: PairingEvent): PairingState {
  switch (event.type) {
    case 'start':
      return { status: 'starting', attempt: event.attempt };
    case 'cancel':
      return { status: 'idle', attempt: state.attempt };
    case 'uri':
      if (event.attempt !== state.attempt) return state;
      if (state.status !== 'starting' && state.status !== 'pairing') return state;
      if (!isPairingUri(event.uri)) return state;
      return { status: 'pairing', attempt: state.attempt, uri: event.uri, matrix: event.matrix };
    case 'fail':
      if (event.attempt !== state.attempt || state.status === 'idle') return state;
      return { status: 'failed', attempt: state.attempt, message: event.message };
    case 'connected':
      if (event.attempt !== state.attempt) return state;
      return { status: 'idle', attempt: state.attempt };
    default:
      return state;
  }
}

const endings = new WeakMap<object, () => Promise<void>>();

export function sessionKey(wallet: SourceWallet | null): object | null {
  if (!wallet) return null;
  if (wallet.kind === 'evm') return wallet.provider;
  return wallet.sender ?? null;
}

export function registerSessionEnd(key: object, end: () => Promise<void>): void {
  endings.set(key, end);
}

export async function endWalletSession(wallet: SourceWallet | null): Promise<void> {
  const key = sessionKey(wallet);
  if (!key) return;
  const end = endings.get(key);
  if (!end) return;
  endings.delete(key);
  await end();
}
