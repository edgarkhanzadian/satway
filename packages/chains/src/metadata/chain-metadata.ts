import type { OneClickToken } from '@satway/core';

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

export function evmChainIdOf(blockchain: string): number | undefined {
  return Object.hasOwn(EVM_CHAIN_IDS, blockchain) ? EVM_CHAIN_IDS[blockchain] : undefined;
}

export function isEvmChain(blockchain: string): boolean {
  return evmChainIdOf(blockchain) !== undefined;
}

export const SUPPORTED_ORIGIN_CHAINS: ReadonlySet<string> = new Set(Object.keys(EVM_CHAIN_IDS));

export function isSupportedOriginChain(blockchain: string): boolean {
  return SUPPORTED_ORIGIN_CHAINS.has(blockchain);
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
  if (!Object.hasOwn(EVM_NATIVE_ASSETS, token.blockchain)) return false;
  return (EVM_NATIVE_ASSETS[token.blockchain] ?? []).includes(token.assetId);
}
