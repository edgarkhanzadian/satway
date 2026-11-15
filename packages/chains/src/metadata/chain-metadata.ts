import { base58 } from '@scure/base';

import type { OneClickToken } from '@portage/core';

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

const HOT_OMNI_NATIVE_SUFFIX = '_11111111111111111111';

function hotOmniNative(chainId: number): string {
  return `nep245:v2_1.omni.hot.tg:${chainId}${HOT_OMNI_NATIVE_SUFFIX}`;
}

export const EVM_NATIVE_ASSETS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  eth: ['nep141:eth.omft.near'],
  op: [hotOmniNative(10)],
  bsc: ['nep141:bnb.omdep.near', hotOmniNative(56)],
  gnosis: ['nep141:gnosis.omft.near'],
  pol: ['nep141:pol.omdep.near', hotOmniNative(137)],
  base: ['nep141:base.omft.near'],
  arb: ['nep141:arb.omft.near'],
  avax: ['nep141:avax.omdep.near', hotOmniNative(43114)],
  bera: ['nep141:bera.omft.near'],
  scroll: [hotOmniNative(534352)],
});

export const EVM_NATIVE_DECIMALS = 18;

export function isKnownEvmNative(token: Pick<OneClickToken, 'assetId' | 'blockchain'>): boolean {
  return (EVM_NATIVE_ASSETS[token.blockchain] ?? []).includes(token.assetId);
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
