import { secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { getAddressFromPublicKey } from '@stacks/transactions';

import type { Rng } from './random.js';

export interface BitcoinKey {
  privateKey: Uint8Array;
  publicKey: string;
  xOnly: string;
}

export function bitcoinKey(rng: Rng): BitcoinKey {
  for (;;) {
    const candidate = rng.bytes(32);
    if (!secp256k1.utils.isValidSecretKey(candidate)) continue;
    const publicKey = hex.encode(secp256k1.getPublicKey(candidate, true));
    return { privateKey: candidate, publicKey, xOnly: publicKey.slice(2) };
  }
}

export function p2wpkhOf(key: BitcoinKey): { address: string; script: string } {
  const out = btc.p2wpkh(hex.decode(key.publicKey), btc.NETWORK);
  if (!out.address) throw new Error('Could not encode a p2wpkh address');
  return { address: out.address, script: hex.encode(out.script) };
}

export function p2trOf(key: BitcoinKey): { address: string; script: string } {
  const out = btc.p2tr(hex.decode(key.xOnly), undefined, btc.NETWORK);
  if (!out.address) throw new Error('Could not encode a p2tr address');
  return { address: out.address, script: hex.encode(out.script) };
}

export function stacksAddressOf(key: BitcoinKey): string {
  return getAddressFromPublicKey(key.publicKey, 'mainnet');
}
