import { describe, expect, it } from 'vitest';

import {
  assertMainnetStandardAddress,
  buildDepositAddress,
  depositAddressFromScripts,
  isMainnetTaproot,
  scriptPubKeyOf,
  toXOnly,
} from '../src/index.js';
import { REAL_DEPOSIT as D } from './fixtures.js';

const input = {
  stacksAddress: D.stacksAddress,
  reclaimPublicKey: D.reclaimPublicKey,
  signersPublicKey: D.signersPublicKey,
  maxSignerFeeSats: D.maxSignerFeeSats,
  reclaimLockBlocks: D.reclaimLockBlocks,
};

describe('buildDepositAddress', () => {
  it('reproduces a real confirmed mainnet deposit byte for byte', () => {
    const built = buildDepositAddress(input);
    expect(built.depositScript).toBe(D.depositScript);
    expect(built.reclaimScript).toBe(D.reclaimScript);
    expect(built.scriptPubKey).toBe(D.scriptPubKey);
    expect(built.address).toBe(D.address);
  });

  it('is deterministic', () => {
    expect(buildDepositAddress(input)).toEqual(buildDepositAddress(input));
  });

  it('accepts a compressed reclaim key and gives the same address', () => {
    for (const prefix of ['02', '03']) {
      const built = buildDepositAddress({
        ...input,
        reclaimPublicKey: prefix + D.reclaimPublicKey,
      });
      expect(built.address).toBe(D.address);
    }
  });

  it.each([
    ['recipient', { stacksAddress: 'SP000000000000000000002Q6VF78' }],
    ['reclaim key', { reclaimPublicKey: 'aa'.repeat(32) }],
    ['signer key', { signersPublicKey: 'bb'.repeat(32) }],
    ['fee cap', { maxSignerFeeSats: 79_999 }],
    ['timelock', { reclaimLockBlocks: 951 }],
  ])('changes the address when the %s changes', (_name, change) => {
    expect(buildDepositAddress({ ...input, ...change }).address).not.toBe(D.address);
  });

  it.each([
    ['a testnet address', 'ST000000000000000000002AMW42H'],
    ['a contract principal', 'SP000000000000000000002Q6VF78.pox-5'],
    ['a Bitcoin address', D.address],
    ['garbage', 'not-an-address'],
    ['an empty string', ''],
  ])('rejects %s as recipient', (_name, stacksAddress) => {
    expect(() => buildDepositAddress({ ...input, stacksAddress })).toThrow();
  });

  it('rejects malformed keys', () => {
    expect(() => buildDepositAddress({ ...input, reclaimPublicKey: 'abcd' })).toThrow();
    expect(() =>
      buildDepositAddress({ ...input, reclaimPublicKey: '04' + 'aa'.repeat(32) })
    ).toThrow();
    expect(() => buildDepositAddress({ ...input, signersPublicKey: 'zz'.repeat(32) })).toThrow();
  });

  it('refuses to use the signers key as the reclaim key', () => {
    expect(() => buildDepositAddress({ ...input, reclaimPublicKey: D.signersPublicKey })).toThrow(
      /user/
    );
  });

  it('rejects out-of-range fee caps and timelocks', () => {
    for (const maxSignerFeeSats of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildDepositAddress({ ...input, maxSignerFeeSats })).toThrow();
    }
    for (const reclaimLockBlocks of [0, -1, 65_536, 1.5]) {
      expect(() => buildDepositAddress({ ...input, reclaimLockBlocks })).toThrow();
    }
  });
});

describe('depositAddressFromScripts', () => {
  it('derives the real on-chain address from the recorded scripts', () => {
    expect(depositAddressFromScripts(D.depositScript, D.reclaimScript)).toEqual({
      address: D.address,
      scriptPubKey: D.scriptPubKey,
    });
  });

  it('gives a different address if either script is altered', () => {
    const otherReclaim = D.reclaimScript.replace('02b603', '02b703');
    expect(depositAddressFromScripts(D.depositScript, otherReclaim).address).not.toBe(D.address);
  });

  it('rejects non-hex input', () => {
    expect(() => depositAddressFromScripts('zz', D.reclaimScript)).toThrow();
  });
});

describe('address helpers', () => {
  it('toXOnly normalises keys', () => {
    expect(toXOnly('0x02' + D.reclaimPublicKey.toUpperCase())).toBe(D.reclaimPublicKey);
    expect(toXOnly(D.reclaimPublicKey)).toBe(D.reclaimPublicKey);
  });

  it('scriptPubKeyOf matches the chain', () => {
    expect(scriptPubKeyOf(D.address)).toBe(D.scriptPubKey);
  });

  it('isMainnetTaproot', () => {
    expect(isMainnetTaproot(D.address)).toBe(true);
    expect(isMainnetTaproot('bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys')).toBe(false);
    expect(isMainnetTaproot('tb1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhq0v8xwe')).toBe(
      false
    );
    expect(isMainnetTaproot('nonsense')).toBe(false);
  });

  it('assertMainnetStandardAddress accepts SP and SM', () => {
    expect(() => assertMainnetStandardAddress(D.stacksAddress)).not.toThrow();
    expect(() =>
      assertMainnetStandardAddress('SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4')
    ).not.toThrow();
  });
});
