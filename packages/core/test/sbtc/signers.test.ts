import { describe, expect, it } from 'vitest';

import {
  MAINNET_CONFIG,
  ResponseShapeError,
  SIGNER_EVIDENCE_DEFAULTS,
  SignerVerificationError,
  type SweepTransaction,
  depositLeafControlBlock,
  fetchVerifiedSigners,
  parseAggregatePubkey,
  signerKeyOfDepositScript,
} from '../../src/index.js';
import { REAL_DEPOSIT as D, REGISTRY_RESULT, jsonResponse } from '../fixtures.js';
import { EVIDENCE_DEPOSITS, EVIDENCE_TIP } from './signer-evidence-fixtures.js';
import {
  FIRST_SWEEP,
  SECOND_SWEEP,
  type SignerWorld,
  realDeposits,
  registryResultFor,
  signerWorld,
} from './signer-world.js';

const FORGED_KEY = 'ab'.repeat(32);
const FORGED = registryResultFor(FORGED_KEY);
const [B296, FE3F, C959, , D62D, E34E] = EVIDENCE_DEPOSITS;

function only(...picked: object[]): { deposits: object[] } {
  return { deposits: picked };
}

function verify(w: SignerWorld, options: Parameters<typeof fetchVerifiedSigners>[1] = {}) {
  return fetchVerifiedSigners(MAINNET_CONFIG, { fetchFn: signerWorld(w).fetchFn, ...options });
}

function editInput(
  sweepTxid: string,
  vin: number,
  change: (input: SweepTransaction['vin'][number]) => void
): SignerWorld['sweep'] {
  return (txid, sweep) => {
    const input = sweep.vin[vin];
    if (txid === sweepTxid && input) change(input);
    return sweep;
  };
}

function swapWitness(item: number, value: string) {
  return (input: SweepTransaction['vin'][number]) => {
    const witness = [...(input.witness ?? [])];
    witness[item] = value;
    input.witness = witness;
  };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  const err: unknown = await promise.catch((e: unknown) => e);
  if (!(err instanceof Error)) throw new Error('expected a rejection');
  return err;
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

  it('rejects the sBTC v2 registry encoding, a 0xff tag and a Bitcoin block hash', () => {
    expect(() => parseAggregatePubkey('0x0200000021ff' + '00'.repeat(32))).toThrow();
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

describe('depositLeafControlBlock', () => {
  it('matches the control block revealed by a real mainnet sweep', () => {
    expect(depositLeafControlBlock(B296.depositScript, B296.reclaimScript)).toBe(
      'c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614'
    );
  });
});

describe('fetchVerifiedSigners on real mainnet evidence', () => {
  it('accepts the key with two deposits swept through their deposit leaf', async () => {
    const world = signerWorld();
    const res = await fetchVerifiedSigners(MAINNET_CONFIG, { fetchFn: world.fetchFn });
    expect(res.signersPublicKey).toBe(D.signersPublicKey);
    expect(res.evidenceItems).toEqual([
      {
        txid: B296.bitcoinTxid,
        vout: 1,
        sweptAtHeight: EVIDENCE_TIP,
        blocksAgo: 0,
        sweepTxid: FIRST_SWEEP,
        sweepInput: 1,
        signerUtxoSats: 248_335_327_083,
      },
      {
        txid: FE3F.bitcoinTxid,
        vout: 1,
        sweptAtHeight: EVIDENCE_TIP,
        blocksAgo: 0,
        sweepTxid: FIRST_SWEEP,
        sweepInput: 2,
        signerUtxoSats: 248_335_327_083,
      },
    ]);
    expect(res.evidence).toEqual(res.evidenceItems[0]);
    expect(res.rejectedEvidence).toEqual([]);
    expect(res.stacksSources).toEqual(['https://api.hiro.so', 'https://stacks-node.alexlab.co']);
    expect(res.requests).toBe(9);
    expect(world.urls).toHaveLength(9);
    expect(world.urls.filter(u => u.endsWith(`/tx/${FIRST_SWEEP}`))).toHaveLength(1);
  });

  it('accepts evidence from different sweeps', async () => {
    const res = await verify({ deposits: only(D62D, E34E, B296) }, { minEvidence: 3 });
    expect(res.evidenceItems.map(e => e.sweptAtHeight)).toEqual([975_945, 975_943, 975_946]);
  });

  it('defaults to two pieces of evidence and a 100 BTC signer UTXO', () => {
    expect(SIGNER_EVIDENCE_DEFAULTS).toMatchObject({
      minEvidence: 2,
      minSignerUtxoSats: 10_000_000_000,
      maxEvidenceAgeBlocks: 1008,
    });
  });

  it('skips a bad item and keeps looking at further deposits', async () => {
    const res = await verify({
      deposits: { deposits: [{ ...B296, reclaimScript: D.reclaimScript }, FE3F, C959] },
    });
    expect(res.evidenceItems.map(e => e.txid)).toEqual([FE3F.bitcoinTxid, C959.bitcoinTxid]);
    expect(res.rejectedEvidence.map(r => `${r.txid}:${r.vout}`)).toEqual([`${B296.bitcoinTxid}:1`]);
    expect(res.rejectedEvidence[0]?.reason).toMatch(/does not pay the deposit address/);
  });
});

describe('fetchVerifiedSigners refuses evidence that is not tied to the chain', () => {
  it('refuses an Emily record whose scripts do not match the on-chain output', async () => {
    const err = await rejection(
      verify({
        deposits: only(
          { ...B296, reclaimScript: D.reclaimScript },
          { ...FE3F, reclaimScript: D.reclaimScript }
        ),
      })
    );
    expect(err).toBeInstanceOf(SignerVerificationError);
    expect(err.message).toMatch(/Found 0 of the 2/);
    expect(err.message).toMatch(/does not pay the deposit address/);
  });

  it('refuses a forged key whose records point at real, recently swept outpoints', async () => {
    function forgedScript(s: string): string {
      return s.replace(D.signersPublicKey, FORGED_KEY);
    }
    const err = await rejection(
      verify({
        primary: { okay: true, result: FORGED },
        secondary: { data: FORGED },
        deposits: only(
          { ...B296, depositScript: forgedScript(B296.depositScript) },
          { ...FE3F, depositScript: forgedScript(FE3F.depositScript) }
        ),
      })
    );
    expect(err.message).toMatch(/Found 0 of the 2/);
    expect(err.message).toMatch(/does not pay the deposit address/);
  });

  it('refuses an outpoint spent through the reclaim leaf', async () => {
    const err = await rejection(
      verify(
        {
          deposits: only(B296),
          sweep: editInput(FIRST_SWEEP, 1, swapWitness(1, B296.reclaimScript)),
        },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/did not spend the deposit through its deposit script/);
  });

  it('refuses a witness script that carries a different key', async () => {
    const err = await rejection(
      verify(
        {
          deposits: only(B296),
          sweep: editInput(
            FIRST_SWEEP,
            1,
            swapWitness(1, B296.depositScript.replace(D.signersPublicKey, FORGED_KEY))
          ),
        },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/did not spend the deposit through its deposit script/);
  });

  it('refuses a control block for a different taproot tree', async () => {
    const bad = depositLeafControlBlock(B296.depositScript, D.reclaimScript);
    const err = await rejection(
      verify(
        { deposits: only(B296), sweep: editInput(FIRST_SWEEP, 1, swapWitness(2, bad)) },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/control block/);
  });

  it('refuses a key-path style witness with no script', async () => {
    const err = await rejection(
      verify(
        {
          deposits: only(B296),
          sweep: editInput(FIRST_SWEEP, 1, input => {
            input.witness = ['00'.repeat(64)];
          }),
        },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/through its deposit script/);
  });

  it('refuses a witness whose signature is not a Schnorr signature', async () => {
    const err = await rejection(
      verify(
        { deposits: only(B296), sweep: editInput(FIRST_SWEEP, 1, swapWitness(0, '00'.repeat(71))) },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/Schnorr/);
  });

  it('refuses evidence pointing at an unrelated spending transaction', async () => {
    const err = await rejection(
      verify(
        {
          deposits: only(B296),
          outspends: {
            [B296.bitcoinTxid]: {
              spent: true,
              txid: SECOND_SWEEP,
              vin: 1,
              status: { confirmed: true },
            },
          },
        },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/does not spend the deposit/);
  });

  it('refuses a spend reported in a different input than the one that spends it', async () => {
    const err = await rejection(
      verify(
        {
          deposits: only(B296),
          outspends: {
            [B296.bitcoinTxid]: {
              spent: true,
              txid: FIRST_SWEEP,
              vin: 3,
              status: { confirmed: true },
            },
          },
        },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/different input/);
  });

  it('refuses a sweep answer for a different transaction', async () => {
    const err = await rejection(
      verify(
        { deposits: only(B296), sweep: (_txid, sweep) => ({ ...sweep, txid: SECOND_SWEEP }) },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/returned/);
  });

  it('refuses an unspent deposit', async () => {
    const err = await rejection(
      verify(
        { deposits: only(B296), outspends: { [B296.bitcoinTxid]: { spent: false } } },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/not spent/);
  });

  it('refuses an unconfirmed spend', async () => {
    const err = await rejection(
      verify(
        {
          deposits: only(B296),
          sweep: (_txid, sweep) => ({ ...sweep, status: { confirmed: false } }),
        },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/not confirmed/);
  });

  it('refuses spends that are too old, as after a key rotation, unless told otherwise', async () => {
    const stale = { tip: String(EVIDENCE_TIP + 5_000) };
    expect((await rejection(verify(stale))).message).toMatch(/outside the 1008-block window/);
    const res = await verify(stale, { maxEvidenceAgeBlocks: 6_000 });
    expect(res.evidence.blocksAgo).toBe(5_000);
  });

  it('refuses a spend that confirmed above the tip', async () => {
    const err = await rejection(
      verify({ tip: String(EVIDENCE_TIP - 1), deposits: only(B296, FE3F) })
    );
    expect(err.message).toMatch(/-1 blocks ago/);
  });

  it('refuses a spend that does not carry the signer UTXO', async () => {
    const err = await rejection(
      verify(
        {
          deposits: only(B296),
          sweep: (_txid, sweep) => ({
            ...sweep,
            vout: sweep.vout.map((o, i) =>
              i === 0 ? { ...o, scriptpubkey: '5120' + '11'.repeat(32) } : o
            ),
          }),
        },
        { minEvidence: 1 }
      )
    );
    expect(err.message).toMatch(/does not carry a signer UTXO/);
  });

  it('refuses a spend whose signer UTXO is too small to be the peg', async () => {
    const err = await rejection(
      verify({ deposits: only(B296) }, { minEvidence: 1, minSignerUtxoSats: 300_000_000_000 })
    );
    expect(err.message).toMatch(/under the 300000000000 required/);
  });

  it('refuses fewer valid items than required', async () => {
    const err = await rejection(verify({ deposits: only(B296) }));
    expect(err).toBeInstanceOf(SignerVerificationError);
    expect(err.message).toMatch(/Found 1 of the 2 recent on-chain sweeps/);
  });

  it('refuses a registry key that no confirmed deposit uses', async () => {
    const err = await rejection(
      verify({ primary: { okay: true, result: FORGED }, secondary: { data: FORGED } })
    );
    expect(err.message).toMatch(/does not appear/);
  });

  it('checks at most the configured number of candidates', async () => {
    const world = signerWorld({
      deposits: {
        deposits: realDeposits().deposits.map(d => ({ ...d, reclaimScript: D.reclaimScript })),
      },
    });
    await expect(
      fetchVerifiedSigners(MAINNET_CONFIG, { fetchFn: world.fetchFn, maxEvidenceCandidates: 3 })
    ).rejects.toThrow(/checked 3 deposit/);
    expect(world.urls.filter(u => u.endsWith('/hex'))).toHaveLength(3);
  });
});

describe('fetchVerifiedSigners second Stacks source', () => {
  it('refuses when the two Stacks APIs disagree', async () => {
    const err = await rejection(verify({ secondary: { data: FORGED } }));
    expect(err).toBeInstanceOf(SignerVerificationError);
    expect(err.message).toMatch(
      /mismatch between Stacks APIs: api\.hiro\.so says d99a.*stacks-node\.alexlab\.co says abab/
    );
  });

  it('refuses when the second source is down', async () => {
    const err = await rejection(verify({ secondary: { error: 'busy' }, secondaryStatus: 503 }));
    expect(err.message).toMatch(
      /second Stacks source stacks-node\.alexlab\.co .*HTTP 503.*refusing/
    );
  });

  it('refuses when the second source is unreachable', async () => {
    const err = await rejection(verify({ secondaryDown: true }));
    expect(err.message).toMatch(/second Stacks source.*Failed to fetch/);
  });

  it.each([
    ['no data field', { result: REGISTRY_RESULT }],
    ['data that is not text', { data: 42 }],
    ['data that is not a key', { data: '0x0100000000000000000000000000000001' }],
  ])('refuses a second source answer with %s', async (_name, secondary) => {
    await expect(verify({ secondary })).rejects.toThrow(/second Stacks source/);
  });

  it('refuses a second source on the same host as the first', async () => {
    const world = signerWorld();
    await expect(
      fetchVerifiedSigners(MAINNET_CONFIG, {
        fetchFn: world.fetchFn,
        secondaryStxApiUrl: 'https://api.hiro.so/',
      })
    ).rejects.toThrow(/different host/);
    expect(world.urls).toEqual([]);
  });

  it('uses an overriding second source when given one', async () => {
    const urls: string[] = [];
    const inner = signerWorld().fetchFn;
    const res = await fetchVerifiedSigners(MAINNET_CONFIG, {
      secondaryStxApiUrl: 'https://second.example',
      fetchFn(url) {
        urls.push(url);
        if (url.startsWith('https://second.example/v2/data_var/')) {
          return Promise.resolve(jsonResponse({ data: REGISTRY_RESULT }));
        }
        return inner(url);
      },
    });
    expect(res.stacksSources[1]).toBe('https://second.example');
    expect(urls).toContain(
      'https://second.example/v2/data_var/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4/sbtc-registry/current-aggregate-pubkey?proof=0'
    );
  });

  it('refuses when the primary registry read fails', async () => {
    await expect(verify({ primary: { okay: false, cause: 'boom' } })).rejects.toThrow(/boom/);
  });
});

describe('fetchVerifiedSigners malformed upstream payloads', () => {
  it.each([
    ['a registry answer with no okay flag', { primary: { result: REGISTRY_RESULT } }],
    [
      'a deposit list without reclaim scripts',
      { deposits: { deposits: [{ ...B296, reclaimScript: undefined }] } },
    ],
    ['a deposit list that is not a list', { deposits: { deposits: 'none' } }],
  ])('refuses %s', async (_name, w) => {
    await expect(verify(w)).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it('refuses a tip height that is not a number', async () => {
    await expect(verify({ tip: 'soon' })).rejects.toThrow(/tip height/);
  });

  it.each([
    [
      'an outspend flag given as text',
      { outspends: { [B296.bitcoinTxid]: { spent: 'yes' } } },
      /Unexpected data/,
    ],
    [
      'an outspend without the spending txid',
      { outspends: { [B296.bitcoinTxid]: { spent: true } } },
      /did not say which transaction/,
    ],
    ['funding data that is not hex', { funding: { [B296.bitcoinTxid]: 'not hex' } }, /non-hex/],
    [
      'funding data for another transaction',
      { funding: { [B296.bitcoinTxid]: D.depositScript } },
      /does not parse|has txid/,
    ],
    [
      'a sweep with a text block height',
      {
        sweep: (_t: string, s: SweepTransaction) => ({
          ...s,
          status: { confirmed: true, block_height: 'x' },
        }),
      },
      /Unexpected data/,
    ],
    [
      'a sweep with inputs that are not a list',
      { sweep: (_t: string, s: SweepTransaction) => ({ ...s, vin: {} }) },
      /Unexpected data/,
    ],
  ])('discards an item with %s', async (_name, w, reason) => {
    const err = await rejection(verify({ deposits: only(B296), ...w }, { minEvidence: 1 }));
    expect(err).toBeInstanceOf(SignerVerificationError);
    expect(err.message).toMatch(reason);
  });
});
