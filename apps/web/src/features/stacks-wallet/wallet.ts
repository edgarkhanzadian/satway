import { base64, hex } from '@scure/base';
import { connect, disconnect, getSelectedProviderId, request } from '@stacks/connect';

import { assertMainnetStandardAddress, toXOnly } from '@satway/core';

import { type WalletAccount, declinedOr } from '../../shared/index.js';

export function stacksWalletError(err: unknown): unknown {
  return declinedOr(err, getSelectedProviderId());
}

interface Entry {
  address: string;
  publicKey: string;
}

export function pickAccount(addresses: Entry[]): WalletAccount {
  const stacks = addresses.find(a => /^S[PM]/.test(a.address));
  if (!stacks) throw new Error('The wallet did not share a mainnet Stacks address');
  assertMainnetStandardAddress(stacks.address);

  const bitcoin =
    addresses.find(a => a.address.startsWith('bc1q') && a.publicKey) ??
    addresses.find(a => a.address.startsWith('bc1p') && a.publicKey);
  if (!bitcoin) throw new Error('The wallet did not share a mainnet Bitcoin address and key');

  return {
    stacksAddress: stacks.address,
    reclaimPublicKey: toXOnly(bitcoin.publicKey),
    reclaimKeyAddress: bitcoin.address,
  };
}

export async function connectWallet(): Promise<WalletAccount> {
  let result;
  try {
    result = await connect({ network: 'mainnet' });
  } catch (err) {
    throw stacksWalletError(err);
  }
  return pickAccount(result.addresses);
}

export function disconnectWallet(): void {
  disconnect();
}

export async function signReclaimWithWallet(
  psbtHex: string,
  account: WalletAccount
): Promise<Uint8Array> {
  let result;
  try {
    result = await request('signPsbt', {
      psbt: base64.encode(hex.decode(psbtHex)),
      signInputs: [{ index: 0, address: account.reclaimKeyAddress }],
      broadcast: false,
      network: 'mainnet',
    });
  } catch (err) {
    throw stacksWalletError(err);
  }
  const signed = result.psbt.trim();
  return /^[0-9a-fA-F]+$/.test(signed) ? hex.decode(signed.toLowerCase()) : base64.decode(signed);
}
