import { base64, hex } from '@scure/base';
import { connect, disconnect, request } from '@stacks/connect';

import { assertMainnetStandardAddress, toXOnly } from '@portage/core';

export interface WalletAccount {
  stacksAddress: string;
  reclaimPublicKey: string;
  reclaimKeyAddress: string;
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
  const result = await connect({ network: 'mainnet' });
  return pickAccount(result.addresses);
}

export function disconnectWallet(): void {
  disconnect();
}

export async function signReclaimWithWallet(
  psbtHex: string,
  account: WalletAccount
): Promise<Uint8Array> {
  const result = await request('signPsbt', {
    psbt: base64.encode(hex.decode(psbtHex)),
    signInputs: [{ index: 0, address: account.reclaimKeyAddress }],
    broadcast: false,
    network: 'mainnet',
  });
  const signed = result.psbt.trim();
  return /^[0-9a-fA-F]+$/.test(signed) ? hex.decode(signed.toLowerCase()) : base64.decode(signed);
}
