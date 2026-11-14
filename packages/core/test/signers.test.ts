import { describe, expect, it } from 'vitest';

import {
  type FetchLike,
  MAINNET_CONFIG,
  fetchVerifiedSigners,
  parseAggregatePubkey,
  signerKeyOfDepositScript,
} from '../src/index.js';
import { REAL_DEPOSIT as D, REGISTRY_RESULT, jsonResponse } from './fixtures.js';

const FORGED_KEY = 'ab'.repeat(32);
const FORGED = '0x0200000021' + '02' + FORGED_KEY;
const TIP = 975_805;

interface Scenario {
  primary?: string;
  secondary?: string;
  depositKeys?: string[];
  spent?: boolean;
  sweptAt?: number;
}

function fakeFetch(s: Scenario): FetchLike {
  return function fetchFn(url) {
    return new Promise(resolve => resolve(route(url)));
  };
  function route(url: string): Response {
    if (url.startsWith('https://second.example')) {
      return jsonResponse({ okay: true, result: s.secondary ?? REGISTRY_RESULT });
    }
    if (url.includes('/v2/contracts/call-read/')) {
      return jsonResponse({ okay: true, result: s.primary ?? REGISTRY_RESULT });
    }
    if (url.includes('/deposit?status=confirmed')) {
      const keys = s.depositKeys ?? [D.signersPublicKey, D.signersPublicKey];
      return jsonResponse({
        deposits: keys.map((key, i) => ({
          bitcoinTxid: String(i).repeat(64),
          bitcoinTxOutputIndex: 1,
          depositScript: D.depositScript.replace(D.signersPublicKey, key),
        })),
      });
    }
    if (url.endsWith('/blocks/tip/height')) return new Response(String(TIP));
    if (url.includes('/outspend/')) {
      const spent = s.spent ?? true;
      return jsonResponse(
        spent
          ? { spent: true, status: { confirmed: true, block_height: s.sweptAt ?? TIP - 1 } }
          : { spent: false }
      );
    }
    throw new Error(`unexpected url ${url}`);
  }
}

describe('parseAggregatePubkey', () => {
  it('parses the mainnet registry response', () => {
    expect(parseAggregatePubkey(REGISTRY_RESULT)).toBe(D.signersPublicKey);
  });

  it('rejects anything that is not a 33-byte buffer', () => {
    expect(() => parseAggregatePubkey('0x0100000000000000000000000000000001')).toThrow();
    expect(() => parseAggregatePubkey('0x0200000020' + 'ab'.repeat(32))).toThrow();
    expect(() => parseAggregatePubkey('0x0200000021' + 'ab'.repeat(10))).toThrow();
  });
});

describe('signerKeyOfDepositScript', () => {
  it('reads the key out of a real deposit script', () => {
    expect(signerKeyOfDepositScript(D.depositScript)).toBe(D.signersPublicKey);
    expect(signerKeyOfDepositScript(D.depositScript.toUpperCase())).toBe(D.signersPublicKey);
  });

  it('reads the key from a deposit to a contract principal', () => {
    const toContract =
      '2400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac';
    expect(signerKeyOfDepositScript(toContract)).toBe(D.signersPublicKey);
  });

  it('returns null for a reclaim script, which also ends in DROP <key> CHECKSIG', () => {
    expect(signerKeyOfDepositScript(D.reclaimScript)).toBeNull();
  });

  it('returns null for malformed scripts', () => {
    expect(signerKeyOfDepositScript('')).toBeNull();
    expect(signerKeyOfDepositScript('zz')).toBeNull();
    expect(signerKeyOfDepositScript(D.depositScript.slice(0, -2) + 'ad')).toBeNull();
    expect(signerKeyOfDepositScript(D.depositScript + '00')).toBeNull();
    expect(signerKeyOfDepositScript('1f' + D.depositScript.slice(2))).toBeNull();
  });
});

describe('fetchVerifiedSigners', () => {
  it('returns the key with the on-chain sweep it relied on', async () => {
    const res = await fetchVerifiedSigners(MAINNET_CONFIG, { fetchFn: fakeFetch({}) });
    expect(res.signersPublicKey).toBe(D.signersPublicKey);
    expect(res.evidence).toEqual({
      txid: '0'.repeat(64),
      vout: 1,
      sweptAtHeight: TIP - 1,
      blocksAgo: 1,
    });
  });

  it('refuses a registry key that no confirmed deposit uses', async () => {
    await expect(
      fetchVerifiedSigners(MAINNET_CONFIG, { fetchFn: fakeFetch({ primary: FORGED }) })
    ).rejects.toThrow(/does not appear/);
  });

  it('refuses when a forged key is echoed by the sBTC API but never swept on Bitcoin', async () => {
    await expect(
      fetchVerifiedSigners(MAINNET_CONFIG, {
        fetchFn: fakeFetch({ primary: FORGED, depositKeys: [FORGED_KEY], spent: false }),
      })
    ).rejects.toThrow(/sweep/);
  });

  it('refuses when the only sweeps are stale, as after a key rotation', async () => {
    await expect(
      fetchVerifiedSigners(MAINNET_CONFIG, { fetchFn: fakeFetch({ sweptAt: TIP - 5_000 }) })
    ).rejects.toThrow(/sweep/);
  });

  it('accepts older evidence when told to', async () => {
    const res = await fetchVerifiedSigners(MAINNET_CONFIG, {
      fetchFn: fakeFetch({ sweptAt: TIP - 5_000 }),
      maxEvidenceAgeBlocks: 6_000,
    });
    expect(res.evidence.blocksAgo).toBe(5_000);
  });

  it('refuses when two Stacks APIs disagree', async () => {
    await expect(
      fetchVerifiedSigners(MAINNET_CONFIG, {
        fetchFn: fakeFetch({ secondary: FORGED }),
        secondaryStxApiUrl: 'https://second.example',
      })
    ).rejects.toThrow(/mismatch/);
  });

  it('passes when two Stacks APIs agree', async () => {
    const res = await fetchVerifiedSigners(MAINNET_CONFIG, {
      fetchFn: fakeFetch({}),
      secondaryStxApiUrl: 'https://second.example',
    });
    expect(res.signersPublicKey).toBe(D.signersPublicKey);
  });

  it('refuses when the registry read fails', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(jsonResponse({ okay: false, cause: 'boom' }));
    }
    await expect(fetchVerifiedSigners(MAINNET_CONFIG, { fetchFn })).rejects.toThrow(/boom/);
  });
});
