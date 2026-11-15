import { base58 } from '@scure/base';
import { describe, expect, it, vi } from 'vitest';

import { SendError } from '@satway/chains';

import {
  collectSolanaWallets,
  connectStandardSolana,
  isUsableSolanaWallet,
  standardSolanaSender,
} from '../../../src/features/chain-wallets/solana-wallet.js';

const ADDRESS = 'DgrD34m4MdR1SWr7VYezeddN61i9ib14YUVXh5QvKG1H';
const OTHER = 'oCMJgh2BEpNyWN4RBFnjXfaLG5NgMCGcqRkEomN6jo6';
const SIG =
  '4QMdVtgtZcuygfB7RnGhZvrPxVDjXU7WgaKCaYEd2XSeQYMGKSrthoiV4GmL6pq2fu5gHaoiHofNEYTNSJuryyr';

function fakeWallet(opts: {
  name?: string;
  signAndSend?: boolean;
  sign?: boolean;
  chains?: string[];
}) {
  const account = {
    address: ADDRESS,
    publicKey: base58.decode(ADDRESS),
    chains: ['solana:mainnet'],
  };
  const signAndSendTransaction = vi.fn((input: unknown) =>
    Promise.resolve([{ signature: base58.decode(SIG), input }])
  );
  const signTransaction = vi.fn((input: unknown) =>
    Promise.resolve([{ signedTransaction: Uint8Array.from([1, 2, 3]), input }])
  );
  const features: Record<string, unknown> = {
    'standard:connect': { connect: () => Promise.resolve({ accounts: [account] }) },
  };
  if (opts.signAndSend !== false)
    features['solana:signAndSendTransaction'] = { signAndSendTransaction };
  if (opts.sign) features['solana:signTransaction'] = { signTransaction };
  const wallet = {
    version: '1.0.0',
    name: opts.name ?? 'Phantom',
    icon: 'data:image/svg+xml,',
    chains: opts.chains ?? ['solana:mainnet', 'solana:devnet'],
    accounts: [account],
    features,
  };
  return { wallet, account, signAndSendTransaction, signTransaction };
}

describe('collectSolanaWallets', () => {
  it('collects Wallet Standard wallets that can send on Solana mainnet', () => {
    const target = new EventTarget();
    const phantom = fakeWallet({});
    const devnetOnly = fakeWallet({ name: 'Dev', chains: ['solana:devnet'] });
    target.addEventListener('wallet-standard:app-ready', event => {
      const api: unknown = Reflect.get(event, 'detail');
      const register: unknown = Reflect.get(Object(api), 'register');
      if (typeof register === 'function')
        Reflect.apply(register, api, [phantom.wallet, devnetOnly.wallet]);
    });
    const collector = collectSolanaWallets(target);
    target.dispatchEvent(
      new CustomEvent('wallet-standard:register-wallet', {
        detail: (api: { register(...w: unknown[]): unknown }) =>
          api.register(fakeWallet({ name: 'Solflare', sign: true, signAndSend: false }).wallet),
      })
    );
    collector.stop();
    expect(collector.wallets().map(w => w.name)).toEqual(['Phantom', 'Solflare']);
  });

  it('ignores wallets without a way to send', () => {
    expect(isUsableSolanaWallet(fakeWallet({ signAndSend: false }).wallet)).toBe(false);
    expect(isUsableSolanaWallet({ name: 'x' })).toBe(false);
    expect(isUsableSolanaWallet(null)).toBe(false);
  });
});

describe('standardSolanaSender', () => {
  it('signs and sends on solana:mainnet with the wallet’s own account object', async () => {
    const { wallet, account, signAndSendTransaction } = fakeWallet({});
    const tx = Uint8Array.from([1, 0, 0]);
    expect(await standardSolanaSender(wallet, ADDRESS).send(tx)).toEqual({
      kind: 'sent',
      signature: SIG,
    });
    expect(signAndSendTransaction).toHaveBeenCalledWith({
      account,
      transaction: tx,
      chain: 'solana:mainnet',
      options: { preflightCommitment: 'confirmed' },
    });
  });

  it('falls back to signTransaction', async () => {
    const { wallet } = fakeWallet({ signAndSend: false, sign: true });
    expect(await standardSolanaSender(wallet, ADDRESS).send(Uint8Array.from([1]))).toEqual({
      kind: 'signed',
      transaction: Uint8Array.from([1, 2, 3]),
    });
  });

  it('refuses when the account is gone or the reply is malformed', async () => {
    const { wallet, signAndSendTransaction } = fakeWallet({});
    await expect(standardSolanaSender(wallet, OTHER).send(Uint8Array.from([1]))).rejects.toThrow(
      /account changed/
    );
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    signAndSendTransaction.mockResolvedValueOnce([
      { signature: Uint8Array.from([1, 2]), input: null },
    ]);
    await expect(standardSolanaSender(wallet, ADDRESS).send(Uint8Array.from([1]))).rejects.toThrow(
      /did not return a transaction signature/
    );
  });

  async function phaseOf(work: Promise<unknown>): Promise<string> {
    try {
      await work;
      return 'resolved';
    } catch (err) {
      return err instanceof SendError ? err.phase : 'untyped';
    }
  }

  it('says where it failed: refused before asking, rejected, or unknown after sending', async () => {
    const { wallet, signAndSendTransaction } = fakeWallet({});
    const tx = Uint8Array.from([1]);
    expect(await phaseOf(standardSolanaSender(wallet, OTHER).send(tx))).toBe('not-sent');
    signAndSendTransaction.mockRejectedValueOnce(
      Object.assign(new Error('User rejected the request.'), { code: 4001 })
    );
    expect(await phaseOf(standardSolanaSender(wallet, ADDRESS).send(tx))).toBe('rejected');
    signAndSendTransaction.mockRejectedValueOnce(new Error('Connection lost'));
    expect(await phaseOf(standardSolanaSender(wallet, ADDRESS).send(tx))).toBe('uncertain');
    signAndSendTransaction.mockResolvedValueOnce([]);
    expect(await phaseOf(standardSolanaSender(wallet, ADDRESS).send(tx))).toBe('uncertain');
    const signOnly = fakeWallet({ signAndSend: false, sign: true });
    signOnly.signTransaction.mockRejectedValueOnce(new Error('Connection lost'));
    expect(await phaseOf(standardSolanaSender(signOnly.wallet, ADDRESS).send(tx))).toBe('not-sent');
  });
});

describe('connectStandardSolana', () => {
  it('returns a Solana source wallet that can send', async () => {
    const { wallet } = fakeWallet({});
    const connected = await connectStandardSolana({
      id: 'solana:Phantom',
      name: 'Phantom',
      wallet,
    });
    expect(connected).toMatchObject({ kind: 'solana', name: 'Phantom', address: ADDRESS });
    expect(connected.kind === 'solana' && connected.sender !== undefined).toBe(true);
  });

  it('fails when no mainnet account is shared', async () => {
    const { wallet } = fakeWallet({});
    wallet.accounts = [];
    Reflect.set(wallet.features, 'standard:connect', {
      connect: () => Promise.resolve({ accounts: [] }),
    });
    await expect(
      connectStandardSolana({ id: 'solana:Phantom', name: 'Phantom', wallet })
    ).rejects.toThrow(/did not share a Solana mainnet account/);
  });
});
