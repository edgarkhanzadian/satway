import { base58 } from '@scure/base';

import {
  SendError,
  type SolanaSendResult,
  type SolanaSender,
  type SourceWallet,
  isSolanaAddress,
  signOnlyFailure,
  walletFailure,
} from '@satway/chains';

export const STANDARD_MAINNET = 'solana:mainnet';
const CONNECT = 'standard:connect';
const SIGN_AND_SEND = 'solana:signAndSendTransaction';
const SIGN = 'solana:signTransaction';

export interface SolanaWalletOption {
  id: string;
  name: string;
  wallet: object;
}

function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const read: unknown = Reflect.get(value, key);
  return read;
}

function method(owner: unknown, key: string): ((...args: unknown[]) => Promise<unknown>) | null {
  const fn = field(owner, key);
  if (typeof fn !== 'function') return null;
  return async (...args: unknown[]) => {
    const out: unknown = await Reflect.apply(fn, owner, args);
    return out;
  };
}

function includes(list: unknown, item: string): boolean {
  return Array.isArray(list) && list.some(entry => entry === item);
}

function features(wallet: unknown): unknown {
  return field(wallet, 'features');
}

function canSend(wallet: unknown): boolean {
  const f = features(wallet);
  return (
    method(field(f, SIGN_AND_SEND), 'signAndSendTransaction') !== null ||
    method(field(f, SIGN), 'signTransaction') !== null
  );
}

export function isUsableSolanaWallet(wallet: unknown): boolean {
  const name = field(wallet, 'name');
  return (
    typeof wallet === 'object' &&
    wallet !== null &&
    typeof name === 'string' &&
    name.trim() !== '' &&
    includes(field(wallet, 'chains'), STANDARD_MAINNET) &&
    method(field(features(wallet), CONNECT), 'connect') !== null &&
    canSend(wallet)
  );
}

function walletName(wallet: object): string {
  const name = field(wallet, 'name');
  return typeof name === 'string' ? name.trim().slice(0, 40) : 'Solana wallet';
}

export interface SolanaWalletCollector {
  wallets(): SolanaWalletOption[];
  stop(): void;
}

export function collectSolanaWallets(target: EventTarget): SolanaWalletCollector {
  const found = new Map<string, SolanaWalletOption>();
  const api = {
    register(...wallets: unknown[]) {
      for (const wallet of wallets) {
        if (typeof wallet !== 'object' || wallet === null || !isUsableSolanaWallet(wallet))
          continue;
        const name = walletName(wallet);
        if (!found.has(name)) found.set(name, { id: `solana:${name}`, name, wallet });
      }
      return () => undefined;
    },
  };
  function onRegister(event: Event) {
    const callback = field(event, 'detail');
    if (typeof callback !== 'function') return;
    try {
      Reflect.apply(callback, undefined, [api]);
    } catch {
      return;
    }
  }
  target.addEventListener('wallet-standard:register-wallet', onRegister);
  target.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  return {
    wallets: () => [...found.values()],
    stop: () => target.removeEventListener('wallet-standard:register-wallet', onRegister),
  };
}

export async function discoverSolanaWallets(waitMs = 300): Promise<SolanaWalletOption[]> {
  const collector = collectSolanaWallets(window);
  await new Promise(resolve => setTimeout(resolve, waitMs));
  collector.stop();
  return collector.wallets();
}

function accountFor(list: unknown, address: string): object | null {
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const read: unknown = item;
    if (typeof read !== 'object' || read === null) continue;
    if (field(read, 'address') !== address) continue;
    const chains = field(read, 'chains');
    if (Array.isArray(chains) && !includes(chains, STANDARD_MAINNET)) continue;
    return read;
  }
  return null;
}

function firstAddress(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const address = field(item, 'address');
    if (typeof address === 'string' && isSolanaAddress(address) && accountFor(list, address))
      return address;
  }
  return null;
}

function bytes(value: unknown): Uint8Array | null {
  return value instanceof Uint8Array ? value : null;
}

function firstOutput(out: unknown): unknown {
  const first: unknown = Array.isArray(out) ? out[0] : undefined;
  return first;
}

export function standardSolanaSender(wallet: object, address: string): SolanaSender {
  return {
    async send(transaction): Promise<SolanaSendResult> {
      const account = accountFor(field(wallet, 'accounts'), address);
      if (!account)
        throw new SendError(
          'The connected wallet account changed. Reconnect and try again.',
          'not-sent'
        );
      const f = features(wallet);
      const signAndSend = method(field(f, SIGN_AND_SEND), 'signAndSendTransaction');
      if (signAndSend) {
        let reply: unknown;
        try {
          reply = await signAndSend({
            account,
            transaction,
            chain: STANDARD_MAINNET,
            options: { preflightCommitment: 'confirmed' },
          });
        } catch (err) {
          throw walletFailure(err, 'The wallet did not confirm whether it sent the transaction');
        }
        const signature = bytes(field(firstOutput(reply), 'signature'));
        if (!signature || signature.length !== 64)
          throw new SendError('The wallet did not return a transaction signature', 'uncertain');
        return { kind: 'sent', signature: base58.encode(signature) };
      }
      const sign = method(field(f, SIGN), 'signTransaction');
      if (sign) {
        let reply: unknown;
        try {
          reply = await sign({ account, transaction, chain: STANDARD_MAINNET });
        } catch (err) {
          throw signOnlyFailure(err);
        }
        const signed = bytes(field(firstOutput(reply), 'signedTransaction'));
        if (!signed)
          throw new SendError('The wallet did not return a signed transaction', 'not-sent');
        return { kind: 'signed', transaction: signed };
      }
      throw new SendError('This wallet cannot send Solana transactions', 'not-sent');
    },
  };
}

export async function connectStandardSolana(option: SolanaWalletOption): Promise<SourceWallet> {
  const connect = method(field(features(option.wallet), CONNECT), 'connect');
  if (!connect) throw new Error('This wallet cannot connect');
  const out = await connect();
  const address =
    firstAddress(field(out, 'accounts')) ?? firstAddress(field(option.wallet, 'accounts'));
  if (!address) throw new Error('The wallet did not share a Solana mainnet account');
  return {
    kind: 'solana',
    name: option.name,
    address,
    sender: standardSolanaSender(option.wallet, address),
  };
}
