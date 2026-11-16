import { describe, expect, it } from 'vitest';

import { isEvmChain } from '../../src/index.js';

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
