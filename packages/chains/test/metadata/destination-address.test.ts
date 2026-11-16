import { describe, expect, it } from 'vitest';

import { checkDestinationAddress, evmChecksumAddress } from '../../src/index.js';

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
    expect(checkDestinationAddress('base', address, {})).toEqual({ ok: true, address });
  });

  it('accepts all-lowercase and all-uppercase EVM addresses, which carry no checksum', () => {
    const lower = FIRST.toLowerCase();
    expect(checkDestinationAddress('eth', lower, {}).ok).toBe(true);
    expect(checkDestinationAddress('arb', `0x${lower.slice(2).toUpperCase()}`, {}).ok).toBe(true);
  });

  it('refuses an EVM address with a wrong checksum', () => {
    const typo = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD';
    const check = checkDestinationAddress('base', typo, {});
    expect(check.ok).toBe(false);
    expect(check.ok ? '' : check.message).toMatch(/capitalisation error/);
  });

  it.each([
    ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe', /40 hex/],
    ['5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', /40 hex/],
    ['0x0000000000000000000000000000000000000000', /zero address/],
    [SOLANA_WALLET, /40 hex/],
  ])('refuses %s on an EVM chain', (address, message) => {
    const check = checkDestinationAddress('eth', address, {});
    expect(check.ok ? '' : check.message).toMatch(message);
  });

  it.each([
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000004',
    '0x000000000000000000000000000000000000000a',
    '0x000000000000000000000000000000000000000A',
    '0x0000000000000000000000000000000000000100',
    '0x000000000000000000000000000000000000dEaD',
    '0x000000000000000000000000000000000000dead',
  ])('refuses the reserved system address %s', address => {
    const check = checkDestinationAddress('base', address, {});
    expect(check.ok ? '' : check.message).toBe(
      'This is a reserved system or burn address, not a wallet. Funds sent there are lost.'
    );
  });

  it.each([
    '0xdEAD000000000000000042069420694206942069',
    '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    '0xffffffffffffffffffffffffffffffffffffffff',
  ])('refuses the well-known burn or placeholder address %s', address => {
    const check = checkDestinationAddress('eth', address, {});
    expect(check.ok ? '' : check.message).toBe(
      'This is a reserved system or burn address, not a wallet. Funds sent there are lost.'
    );
  });

  it('accepts an address that merely starts with zeros', () => {
    const address = '0x0000000000000000000000000000000000010000';
    expect(checkDestinationAddress('base', address, {})).toEqual({ ok: true, address });
  });

  it('refuses the delivered token’s own contract, in any capitalisation', () => {
    const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b6bfbc8bc05';
    const token = { contractAddress: usdc };
    const upper = `0x${usdc.slice(2).toUpperCase()}`;
    for (const address of [usdc, evmChecksumAddress(usdc), upper]) {
      const check = checkDestinationAddress('base', address, token);
      expect(check.ok ? '' : check.message).toBe(
        'This is the contract of the token you receive, not a wallet. Funds sent there are lost. Enter an address you control.'
      );
    }
    expect(checkDestinationAddress('base', FIRST, token)).toEqual({ ok: true, address: FIRST });
    expect(checkDestinationAddress('base', usdc, {})).toEqual({ ok: true, address: usdc });
  });

  it.each([
    ['op', '0x4200000000000000000000000000000000000000'],
    ['base', '0x4200000000000000000000000000000000000006'],
    ['base', '0x4200000000000000000000000000000000000016'],
    ['op', '0x42000000000000000000000000000000000007fF'],
  ])('refuses the OP Stack predeploy on %s at %s', (chain, address) => {
    const check = checkDestinationAddress(chain, address.toLowerCase(), {});
    expect(check.ok ? '' : check.message).toBe(
      `This is a system contract on ${chain}, not a wallet. Funds sent there are lost.`
    );
  });

  it('does not treat the OP Stack predeploy range as special on other chains, or past its end', () => {
    expect(
      checkDestinationAddress('eth', '0x4200000000000000000000000000000000000016', {}).ok
    ).toBe(true);
    expect(
      checkDestinationAddress('base', '0x4200000000000000000000000000000000000800', {}).ok
    ).toBe(true);
    expect(
      checkDestinationAddress('base', '0x4200000000000000000000000000000000010000', {}).ok
    ).toBe(true);
  });

  it.each([
    ['arb', '0x0000000000000000000000000000000000000064'],
    ['arb', '0x0000000000000000000000000000000000000073'],
    ['arb', '0x00000000000000000000000000000000000000C8'],
    ['arb', '0x00000000000000000000000000000000000000fF'],
  ])('refuses the Arbitrum precompile on %s at %s', (chain, address) => {
    const check = checkDestinationAddress(chain, address.toLowerCase(), {});
    expect(check.ok).toBe(false);
  });

  it.each([
    ['eth', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'],
    ['arb', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'],
  ])('refuses the wrapped native coin contract on %s', (chain, address) => {
    for (const input of [address, address.toLowerCase()]) {
      const check = checkDestinationAddress(chain, input, {});
      expect(check.ok ? '' : check.message).toBe(
        `This is the wrapped-coin contract on ${chain}, not a wallet. Funds sent there are lost.`
      );
    }
  });

  it('accepts the WETH address of one chain on a chain where it is not WETH', () => {
    const weth = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    expect(checkDestinationAddress('base', weth, {})).toEqual({ ok: true, address: weth });
  });

  it('refuses withdrawals to Solana, whatever the address', () => {
    for (const address of [SOLANA_WALLET, FIRST]) {
      const check = checkDestinationAddress('sol', address, {});
      expect(check.ok).toBe(false);
      expect(check.ok ? '' : check.message).toMatch(/to sol are not supported/);
    }
  });

  it('refuses empty input and spaces', () => {
    expect(checkDestinationAddress('eth', '', {})).toEqual({
      ok: false,
      message: 'Enter the address that receives the funds.',
    });
    const spaced = checkDestinationAddress('eth', ` ${FIRST}`, {});
    expect(spaced.ok ? '' : spaced.message).toMatch(/spaces/);
  });

  it('refuses chains whose addresses it cannot check', () => {
    const check = checkDestinationAddress('tron', 'TR7NHqjeKQxGTCi8q8ZY4pxL8otSzgjLj6t', {});
    expect(check.ok ? '' : check.message).toMatch(/to tron are not supported/);
  });
});
