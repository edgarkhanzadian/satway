import { describe, expect, it } from 'vitest';

import {
  checkDestinationAddress,
  destinationSupported,
  evmChecksumAddress,
} from '../../src/index.js';

const FIRST = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

const EIP55_EXAMPLES = [
  FIRST,
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
];

const SOLANA_WALLET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('evmChecksumAddress', () => {
  it.each(EIP55_EXAMPLES)('reproduces the EIP-55 example %s', address => {
    expect(evmChecksumAddress(address.toLowerCase())).toBe(address);
  });
});

describe('checkDestinationAddress', () => {
  it.each(EIP55_EXAMPLES)('accepts the checksummed EVM address %s', address => {
    expect(checkDestinationAddress('base', address)).toEqual({ ok: true, address });
  });

  it('accepts all-lowercase and all-uppercase EVM addresses, which carry no checksum', () => {
    const lower = FIRST.toLowerCase();
    expect(checkDestinationAddress('eth', lower).ok).toBe(true);
    expect(checkDestinationAddress('arb', `0x${lower.slice(2).toUpperCase()}`).ok).toBe(true);
  });

  it('refuses an EVM address with a wrong checksum', () => {
    const typo = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD';
    const check = checkDestinationAddress('base', typo);
    expect(check.ok).toBe(false);
    expect(check.ok ? '' : check.message).toMatch(/capitalisation error/);
  });

  it.each([
    ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe', /40 hex/],
    ['5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', /40 hex/],
    ['0x0000000000000000000000000000000000000000', /zero address/],
    [SOLANA_WALLET, /40 hex/],
  ])('refuses %s on an EVM chain', (address, message) => {
    const check = checkDestinationAddress('eth', address);
    expect(check.ok ? '' : check.message).toMatch(message);
  });

  it('accepts a Solana address and refuses EVM addresses or the system program on Solana', () => {
    expect(checkDestinationAddress('sol', SOLANA_WALLET)).toEqual({
      ok: true,
      address: SOLANA_WALLET,
    });
    const evm = checkDestinationAddress('sol', FIRST);
    expect(evm.ok ? '' : evm.message).toMatch(/not a Solana address/);
    const system = checkDestinationAddress('sol', '11111111111111111111111111111111');
    expect(system.ok ? '' : system.message).toMatch(/program address/);
  });

  it('refuses empty input and spaces', () => {
    expect(checkDestinationAddress('eth', '')).toEqual({
      ok: false,
      message: 'Enter the address that receives the funds.',
    });
    const spaced = checkDestinationAddress('eth', ` ${FIRST}`);
    expect(spaced.ok ? '' : spaced.message).toMatch(/spaces/);
  });

  it('refuses chains whose addresses it cannot check', () => {
    const check = checkDestinationAddress('tron', 'TR7NHqjeKQxGTCi8q8ZY4pxL8otSzgjLj6t');
    expect(check.ok ? '' : check.message).toMatch(/to tron are not supported/);
  });
});

describe('destinationSupported', () => {
  it('supports EVM chains and Solana only', () => {
    expect(destinationSupported('base')).toBe(true);
    expect(destinationSupported('eth')).toBe(true);
    expect(destinationSupported('sol')).toBe(true);
    expect(destinationSupported('tron')).toBe(false);
    expect(destinationSupported('btc')).toBe(false);
    expect(destinationSupported('near')).toBe(false);
  });
});
