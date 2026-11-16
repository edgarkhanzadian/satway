import { describe, expect, it } from 'vitest';

import { buildEvmTransfer, evmChainIdOf, isEvmChain, isKnownEvmNative } from '../../src/index.js';

describe('isEvmChain', () => {
  it('knows EVM chains only', () => {
    expect(isEvmChain('base')).toBe(true);
    expect(isEvmChain('eth')).toBe(true);
    expect(isEvmChain('sol')).toBe(false);
    expect(isEvmChain('tron')).toBe(false);
    expect(isEvmChain('btc')).toBe(false);
    expect(isEvmChain('near')).toBe(false);
  });
});

describe('chain lookups ignore inherited object properties', () => {
  const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

  it.each(INHERITED)('%s is not an EVM chain', name => {
    expect(isEvmChain(name)).toBe(false);
    expect(evmChainIdOf(name)).toBeUndefined();
    expect(isKnownEvmNative({ blockchain: name, assetId: 'nep141:eth.omft.near' })).toBe(false);
    expect(() =>
      buildEvmTransfer({
        token: {
          assetId: 'x',
          blockchain: name,
          symbol: 'X',
          decimals: 18,
          price: 1,
        },
        from: `0x${'1'.repeat(40)}`,
        to: `0x${'2'.repeat(40)}`,
        amount: '1',
      })
    ).toThrow(`Sending from a wallet is not supported on ${name}`);
  });

  it('still finds real chain ids', () => {
    expect(evmChainIdOf('base')).toBe(8453);
  });
});
