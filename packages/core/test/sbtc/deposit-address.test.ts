import { describe, expect, it } from 'vitest';

import {
  DEPOSIT_INDEX_LIMIT,
  MAINNET_CONFIG,
  assertMainnetStandardAddress,
  buildDepositAddress,
  buildIndexedDepositAddress,
  depositAddressFromScripts,
  depositIndexOfFeeCap,
  depositParametersOf,
  isMainnetTaproot,
  scriptPubKeyOf,
  signerFeeCapFor,
  toXOnly,
} from '../../src/index.js';
import { REAL_DEPOSIT as D } from '../fixtures.js';

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

const owner = {
  stacksAddress: D.stacksAddress,
  reclaimPublicKey: D.reclaimPublicKey,
  signersPublicKey: D.signersPublicKey,
};

describe('buildIndexedDepositAddress', () => {
  it('index 0 is the real deposit with the base fee cap', () => {
    const built = buildIndexedDepositAddress({ ...owner, depositIndex: 0 }, MAINNET_CONFIG);
    expect(built.address).toBe(D.address);
    expect(built.maxSignerFeeSats).toBe(80_000);
    expect(built.depositIndex).toBe(0);
  });

  it('gives every index its own address, with the index added to the fee cap', () => {
    const indices = [0, 1, 2, 255, 256, 4_096, DEPOSIT_INDEX_LIMIT - 1];
    const built = indices.map(depositIndex =>
      buildIndexedDepositAddress({ ...owner, depositIndex }, MAINNET_CONFIG)
    );
    expect(new Set(built.map(b => b.address)).size).toBe(indices.length);
    built.forEach((b, i) => {
      const n = indices[i] ?? -1;
      expect(b.maxSignerFeeSats).toBe(80_000 + n);
      const feeHex = /^1e([0-9a-f]{16})/.exec(b.depositScript)?.[1] ?? '';
      expect(Number(BigInt(`0x${feeHex}`))).toBe(80_000 + n);
      expect(b.reclaimScript).toBe(D.reclaimScript);
    });
  });

  it('index 1 matches the address derived independently from its scripts', () => {
    const built = buildIndexedDepositAddress({ ...owner, depositIndex: 1 }, MAINNET_CONFIG);
    expect(built.address).toBe('bc1p8vqs7u8lnh8slfzyejq5ml4smmdjj64mjcz9yswhakthg7fcgs3qja4a4x');
    expect(depositAddressFromScripts(built.depositScript, built.reclaimScript).address).toBe(
      built.address
    );
  });

  it.each([-1, 1.5, DEPOSIT_INDEX_LIMIT, Number.NaN])('rejects index %s', depositIndex => {
    expect(() => buildIndexedDepositAddress({ ...owner, depositIndex }, MAINNET_CONFIG)).toThrow(
      /deposit index/
    );
  });

  it('maps fee caps back to indices only inside the range', () => {
    expect(signerFeeCapFor(7, 80_000)).toBe(80_007);
    expect(depositIndexOfFeeCap(80_007, 80_000)).toBe(7);
    expect(depositIndexOfFeeCap(80_000, 80_000)).toBe(0);
    expect(depositIndexOfFeeCap(79_999, 80_000)).toBeNull();
    expect(depositIndexOfFeeCap(80_000 + DEPOSIT_INDEX_LIMIT, 80_000)).toBeNull();
    expect(depositIndexOfFeeCap(80_000 + DEPOSIT_INDEX_LIMIT - 1, 80_000)).toBe(
      DEPOSIT_INDEX_LIMIT - 1
    );
  });
});

describe('depositParametersOf', () => {
  it('reads the real deposit scripts back into their parameters', () => {
    expect(depositParametersOf(D.depositScript, D.reclaimScript)).toEqual({
      stacksAddress: D.stacksAddress,
      reclaimPublicKey: D.reclaimPublicKey,
      signersPublicKey: D.signersPublicKey,
      maxSignerFeeSats: 80_000,
      reclaimLockBlocks: 950,
    });
  });

  it('reads a per-deposit fee cap and a small lock', () => {
    const built = buildDepositAddress({ ...input, maxSignerFeeSats: 80_123, reclaimLockBlocks: 6 });
    expect(depositParametersOf(built.depositScript, built.reclaimScript)).toMatchObject({
      maxSignerFeeSats: 80_123,
      reclaimLockBlocks: 6,
    });
  });

  it('refuses scripts that are not the standard shape', () => {
    expect(depositParametersOf(D.depositScript, '03ffff00b26a')).toBeNull();
    expect(
      depositParametersOf(D.depositScript.replace('7520', '7620'), D.reclaimScript)
    ).toBeNull();
    expect(depositParametersOf('zz', D.reclaimScript)).toBeNull();
    const contract =
      '2400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac';
    expect(depositParametersOf(contract, D.reclaimScript)).toBeNull();
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
