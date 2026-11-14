import { base58 } from '@scure/base';

import { type OneClickToken, parseWith, z } from '@stxonector/core';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface EvmWalletOption {
  id: string;
  name: string;
  provider: Eip1193Provider;
}

export type SolanaSendResult =
  | { kind: 'sent'; signature: string }
  | { kind: 'signed'; transaction: Uint8Array };

export interface SolanaSender {
  send(transaction: Uint8Array): Promise<SolanaSendResult>;
}

export interface SolanaAccount {
  address: string;
  sender: SolanaSender;
}

export type SourceWallet =
  | {
      kind: 'evm';
      name: string;
      address: string;
      provider: Eip1193Provider;
      solana?: SolanaAccount;
    }
  | { kind: 'solana'; name: string; address: string; sender?: SolanaSender };

export const EVM_CHAIN_IDS: Readonly<Record<string, number>> = Object.freeze({
  eth: 1,
  op: 10,
  bsc: 56,
  gnosis: 100,
  pol: 137,
  base: 8453,
  arb: 42161,
  avax: 43114,
  bera: 80094,
  scroll: 534352,
});

export function chainFamily(blockchain: string): 'evm' | 'solana' | 'other' {
  if (blockchain in EVM_CHAIN_IDS) return 'evm';
  if (blockchain === 'sol') return 'solana';
  return 'other';
}

export function walletAddressFor(
  wallet: SourceWallet | null,
  family: 'evm' | 'solana' | 'other'
): string | null {
  if (!wallet || family === 'other') return null;
  if (wallet.kind === family) return wallet.address;
  if (wallet.kind === 'evm' && family === 'solana') return wallet.solana?.address ?? null;
  return null;
}

export function solanaSenderOf(wallet: SourceWallet | null): SolanaAccount | null {
  if (wallet?.kind === 'solana')
    return wallet.sender ? { address: wallet.address, sender: wallet.sender } : null;
  return wallet?.solana ?? null;
}

export function walletCovers(
  wallet: SourceWallet | null,
  token: OneClickToken | undefined
): boolean {
  return Boolean(token && walletAddressFor(wallet, chainFamily(token.blockchain)) !== null);
}

export interface RefundField {
  value: string;
  autofilled: string | null;
}

export function nextRefundField(field: RefundField, walletAddress: string | null): RefundField {
  if (walletAddress !== null) return { value: walletAddress, autofilled: walletAddress };
  if (field.autofilled !== null && field.value === field.autofilled)
    return { value: '', autofilled: null };
  return { value: field.value, autofilled: null };
}

type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;
const SENT_TX_PREFIX = 'stxonector:sent-tx:';
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

function sessionStore(): SessionStore {
  return globalThis.sessionStorage;
}

export function isSentTxFor(family: 'evm' | 'solana' | 'other', value: string): boolean {
  if (family === 'evm') return TX_HASH.test(value);
  if (family === 'solana') return isSolanaSignature(value);
  return false;
}

export function loadSentTx(
  depositAddress: string,
  family: 'evm' | 'solana' | 'other',
  store: () => SessionStore = sessionStore
): string | null {
  try {
    const value = store().getItem(SENT_TX_PREFIX + depositAddress);
    return value !== null && isSentTxFor(family, value) ? value : null;
  } catch {
    return null;
  }
}

export function saveSentTx(
  depositAddress: string,
  hash: string,
  store: () => SessionStore = sessionStore
): void {
  try {
    store().setItem(SENT_TX_PREFIX + depositAddress, hash);
  } catch {
    return;
  }
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function word(hexNoPrefix: string): string {
  return hexNoPrefix.toLowerCase().padStart(64, '0');
}

export function encodeErc20Transfer(to: string, amount: bigint): string {
  if (!EVM_ADDRESS.test(to)) throw new Error('Recipient is not an EVM address');
  if (amount <= 0n) throw new Error('Amount must be greater than zero');
  return `0xa9059cbb${word(to.slice(2))}${word(amount.toString(16))}`;
}

export interface EvmTransfer {
  chainId: number;
  tx: { from: string; to: string; value: string; data?: string };
}

export function buildEvmTransfer(input: {
  token: OneClickToken;
  from: string;
  to: string;
  amount: string;
}): EvmTransfer {
  const chainId = EVM_CHAIN_IDS[input.token.blockchain];
  if (chainId === undefined)
    throw new Error(`Sending from a wallet is not supported on ${input.token.blockchain}`);
  if (!EVM_ADDRESS.test(input.from)) throw new Error('Sender is not an EVM address');
  if (!EVM_ADDRESS.test(input.to))
    throw new Error('The swap deposit address is not an EVM address');
  if (!/^[1-9][0-9]*$/.test(input.amount)) throw new Error('Amount must be a positive integer');
  const amount = BigInt(input.amount);

  const contract = input.token.contractAddress;
  if (contract === undefined || contract === '') {
    return { chainId, tx: { from: input.from, to: input.to, value: `0x${amount.toString(16)}` } };
  }
  if (!EVM_ADDRESS.test(contract)) throw new Error('Token contract address is not valid');
  return {
    chainId,
    tx: {
      from: input.from,
      to: contract,
      value: '0x0',
      data: encodeErc20Transfer(input.to, amount),
    },
  };
}

const chainIdSchema = z.string();
const accountsSchema = z.array(z.string());

async function walletResult<T>(
  provider: Eip1193Provider,
  method: string,
  schema: z.ZodType<T>
): Promise<T> {
  return parseWith(schema, await provider.request({ method }), `the wallet (${method})`);
}

export async function sendFromEvm(
  provider: Eip1193Provider,
  transfer: EvmTransfer
): Promise<string> {
  const wanted = `0x${transfer.chainId.toString(16)}`;
  const current = await walletResult(provider, 'eth_chainId', chainIdSchema);
  if (BigInt(current) !== BigInt(wanted)) {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: wanted }] });
    const after = await walletResult(provider, 'eth_chainId', chainIdSchema);
    if (BigInt(after) !== BigInt(wanted))
      throw new Error('The wallet did not switch to the required network');
  }
  const accounts = await walletResult(provider, 'eth_accounts', accountsSchema);
  if (!accounts.some(a => a.toLowerCase() === transfer.tx.from.toLowerCase())) {
    throw new Error('The connected wallet account changed. Reconnect and try again.');
  }
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [transfer.tx] });
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error('The wallet did not return a transaction hash');
  }
  return hash;
}

interface Eip6963Detail {
  info: { uuid: string; name: string };
  provider: Eip1193Provider;
}

export async function discoverEvmWallets(waitMs = 300): Promise<EvmWalletOption[]> {
  const found = new Map<string, EvmWalletOption>();
  function onAnnounce(event: CustomEvent<Eip6963Detail>) {
    const detail = event.detail;
    if (detail?.info?.uuid && detail.provider) {
      found.set(detail.info.uuid, {
        id: detail.info.uuid,
        name: detail.info.name,
        provider: detail.provider,
      });
    }
  }
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(resolve => setTimeout(resolve, waitMs));
  window.removeEventListener('eip6963:announceProvider', onAnnounce);

  if (found.size === 0) {
    const injected = window.ethereum;
    if (injected)
      found.set('injected', { id: 'injected', name: 'Browser wallet', provider: injected });
  }
  return [...found.values()];
}

export async function connectEvm(option: EvmWalletOption): Promise<SourceWallet> {
  const accounts = await walletResult(option.provider, 'eth_requestAccounts', accountsSchema);
  const address = accounts[0];
  if (!address || !EVM_ADDRESS.test(address))
    throw new Error('The wallet did not share an account');
  return { kind: 'evm', name: option.name, address, provider: option.provider };
}

interface SolanaProvider {
  connect(): Promise<{ publicKey: { toString(): string } }>;
}

export function findSolanaWallet(): SolanaProvider | null {
  return window.phantom?.solana ?? window.solana ?? null;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    phantom?: { solana?: SolanaProvider };
    solana?: SolanaProvider;
  }
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<Eip6963Detail>;
  }
}

export async function connectSolana(): Promise<SourceWallet> {
  const provider = findSolanaWallet();
  if (!provider) throw new Error('No Solana wallet found in this browser');
  const { publicKey } = await provider.connect();
  const address = publicKey.toString();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
    throw new Error('The wallet did not share an account');
  return { kind: 'solana', name: 'Solana wallet', address };
}

function base58Length(value: string): number | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value) || value.length > 90) return null;
  try {
    return base58.decode(value).length;
  } catch {
    return null;
  }
}

export function isSolanaAddress(value: string): boolean {
  return base58Length(value) === 32;
}

export function isSolanaSignature(value: string): boolean {
  return base58Length(value) === 64;
}
