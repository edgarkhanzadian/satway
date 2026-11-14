import { describe, expect, it } from 'vitest';

import { formatUnits, solanaPayUrl } from '../src/solana-pay.js';

const DEPOSIT = '2CXBDfuKKrEmmo5vXnYbCEbUbDyweZcbL12gXC4vHC4G';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('formatUnits', () => {
  it('writes an exact decimal with a leading zero and no trailing zeros', () => {
    expect(formatUnits(25_000_000n, 6)).toBe('25');
    expect(formatUnits(1_500_000n, 6)).toBe('1.5');
    expect(formatUnits(500n, 6)).toBe('0.0005');
    expect(formatUnits(1n, 9)).toBe('0.000000001');
    expect(formatUnits(123_456_789_012_345_678n, 9)).toBe('123456789.012345678');
    expect(formatUnits(7n, 0)).toBe('7');
    expect(formatUnits(0n, 6)).toBe('0');
  });

  it('rejects negative amounts and bad decimals', () => {
    expect(() => formatUnits(-1n, 6)).toThrow();
    expect(() => formatUnits(1n, 1.5)).toThrow();
  });
});

describe('solanaPayUrl', () => {
  it('builds an SPL transfer request with the mint', () => {
    expect(solanaPayUrl({ recipient: DEPOSIT, amount: '25000000', decimals: 6, mint: USDC })).toBe(
      `solana:${DEPOSIT}?amount=25&spl-token=${USDC}`
    );
    expect(solanaPayUrl({ recipient: DEPOSIT, amount: '10000', decimals: 6, mint: USDC })).toBe(
      `solana:${DEPOSIT}?amount=0.01&spl-token=${USDC}`
    );
  });

  it('builds a native SOL request without spl-token', () => {
    expect(
      solanaPayUrl({ recipient: DEPOSIT, amount: '1230000000', decimals: 9, mint: null })
    ).toBe(`solana:${DEPOSIT}?amount=1.23`);
  });

  it('refuses a bad recipient, mint or amount', () => {
    expect(() =>
      solanaPayUrl({ recipient: '0xabc', amount: '1', decimals: 9, mint: null })
    ).toThrow(/Recipient/);
    expect(() => solanaPayUrl({ recipient: DEPOSIT, amount: '1', decimals: 6, mint: 'x' })).toThrow(
      /mint/
    );
    for (const amount of ['0', '-1', '1.5', '1e6', '']) {
      expect(() => solanaPayUrl({ recipient: DEPOSIT, amount, decimals: 9, mint: null })).toThrow(
        /positive integer/
      );
    }
  });
});
