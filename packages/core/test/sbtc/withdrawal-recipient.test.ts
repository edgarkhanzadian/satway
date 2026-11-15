import { bech32, bech32m, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { MAINNET, TESTNET } from 'sbtc';
import { describe, expect, it } from 'vitest';

import {
  WITHDRAWAL_ADDRESS_KINDS,
  WithdrawalAddressError,
  assertRecipientRoundTrip,
  decodeWithdrawalRecipient,
  encodeWithdrawalRecipient,
  sameRecipient,
  scriptPubKeyOfMainnetAddress,
} from '../../src/index.js';
import { defined } from '../fixtures.js';
import { REAL_WITHDRAWALS } from '../real-withdrawals.js';

function bytes(seed: number, length: number): Uint8Array {
  let state = (seed * 2654435761 + 1) >>> 0;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

describe('encodeWithdrawalRecipient on real mainnet withdrawals', () => {
  const paid = REAL_WITHDRAWALS.filter(w => w.address !== null);

  it('covers every recipient kind the contract accepts', () => {
    expect(new Set(REAL_WITHDRAWALS.map(w => w.kind))).toEqual(new Set(WITHDRAWAL_ADDRESS_KINDS));
  });

  it.each(paid.map(w => [w.id, w.kind, w] as const))(
    'request %i (%s): the payout address encodes to the exact recipient tuple the transaction used',
    (_id, _kind, w) => {
      const encoded = encodeWithdrawalRecipient(defined(w.address));
      expect(encoded.recipient).toEqual({ version: w.version, hashbytes: w.hashbytes });
      expect(encoded.scriptPubKey).toBe(w.scriptPubKey);
      expect(encoded.kind).toBe(w.kind);
    }
  );

  it.each(REAL_WITHDRAWALS.map(w => [w.id, w.kind, w] as const))(
    'request %i (%s): decoding the on-chain recipient gives the script the signers pay',
    (_id, _kind, w) => {
      const decoded = decodeWithdrawalRecipient({ version: w.version, hashbytes: w.hashbytes });
      expect(decoded.scriptPubKey).toBe(w.scriptPubKey);
      expect(decoded.kind).toBe(w.kind);
      if (w.address) expect(decoded.address).toBe(w.address);
      expect(
        assertRecipientRoundTrip(decoded.address, { version: w.version, hashbytes: w.hashbytes })
      ).toEqual(decoded);
    }
  );

  it('uses the tweaked output key as hashbytes for taproot', () => {
    const w = defined(REAL_WITHDRAWALS.find(r => r.kind === 'p2tr' && r.address));
    expect(w.scriptPubKey).toBe(`5120${w.hashbytes}`);
    expect(encodeWithdrawalRecipient(defined(w.address)).recipient.hashbytes).toBe(w.hashbytes);
  });

  it('encodes plain P2SH addresses as version 0x01, as every real P2SH withdrawal did', () => {
    const p2sh = REAL_WITHDRAWALS.filter(w => w.kind === 'p2sh');
    expect(p2sh.length).toBeGreaterThanOrEqual(3);
    for (const w of p2sh) expect(w.version).toBe('01');
  });
});

describe('decodeWithdrawalRecipient', () => {
  const hash20 = '4902d93a2b21adc36225c6479aa0555a9e35bf9f';
  const hash32 = '2b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c';

  it('maps versions 0x01, 0x02 and 0x03 to the same P2SH script, as the signers do', () => {
    const scripts = ['01', '02', '03'].map(
      version => decodeWithdrawalRecipient({ version, hashbytes: hash20 }).scriptPubKey
    );
    expect(new Set(scripts)).toEqual(new Set([`a914${hash20}87`]));
  });

  it('treats an empty version buffer as P2PKH, as the signers do', () => {
    expect(decodeWithdrawalRecipient({ version: '', hashbytes: hash20 }).scriptPubKey).toBe(
      `76a914${hash20}88ac`
    );
  });

  it('accepts 0x prefixes and upper case', () => {
    expect(
      decodeWithdrawalRecipient({ version: '0x06', hashbytes: `0x${hash32.toUpperCase()}` }).kind
    ).toBe('p2tr');
  });

  it.each([
    [{ version: '07', hashbytes: hash32 }, /version 7 is not accepted/],
    [{ version: 'ff', hashbytes: hash32 }, /version 255 is not accepted/],
    [{ version: '04', hashbytes: hash32 }, /needs 20 hash bytes, got 32/],
    [{ version: '00', hashbytes: hash32 }, /needs 20 hash bytes, got 32/],
    [{ version: '05', hashbytes: hash20 }, /needs 32 hash bytes, got 20/],
    [{ version: '06', hashbytes: hash20 }, /needs 32 hash bytes, got 20/],
    [{ version: '0400', hashbytes: hash20 }, /at most one byte/],
    [{ version: '04', hashbytes: 'zz' }, /not hex/],
    [{ version: '4', hashbytes: hash20 }, /not hex/],
  ])('rejects %j', (recipient, message) => {
    expect(() => decodeWithdrawalRecipient(recipient)).toThrow(message);
  });
});

describe('encodeWithdrawalRecipient refusals', () => {
  const testnet = btc.Address(TESTNET);

  it.each([
    ['testnet P2WPKH', testnet.encode({ type: 'wpkh', hash: bytes(1, 20) }), /testnet or regtest/],
    ['testnet P2TR', testnet.encode({ type: 'tr', pubkey: bytes(2, 32) }), /testnet or regtest/],
    ['testnet P2PKH', testnet.encode({ type: 'pkh', hash: bytes(3, 20) }), /testnet/],
    ['testnet P2SH', testnet.encode({ type: 'sh', hash: bytes(4, 20) }), /testnet/],
    [
      'regtest P2WPKH',
      bech32.encode('bcrt', [0, ...bech32.toWords(bytes(5, 20))]),
      /testnet or regtest/,
    ],
    [
      'witness version 2',
      bech32m.encode('bc', [2, ...bech32m.toWords(bytes(6, 32))]),
      /witness version 2/,
    ],
    [
      'witness version 16',
      bech32m.encode('bc', [16, ...bech32m.toWords(bytes(7, 32))]),
      /witness version 16/,
    ],
    [
      'v0 program encoded with bech32m',
      bech32m.encode('bc', [0, ...bech32m.toWords(bytes(8, 20))]),
      /not a valid mainnet/,
    ],
    [
      'v1 program encoded with bech32',
      bech32.encode('bc', [1, ...bech32.toWords(bytes(9, 32))]),
      /not a valid mainnet/,
    ],
    [
      'v0 program of 24 bytes',
      bech32.encode('bc', [0, ...bech32.toWords(bytes(10, 24))]),
      /not a valid mainnet/,
    ],
    ['bad bech32 checksum', 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap87', /checksum or length/],
    ['bad base58 checksum', '3P8A35s9V37SqKgsQ9bPxQgdzsou3U2UNZ', /not a valid mainnet/],
    ['mixed case bech32', 'bc1Q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86', /not a valid mainnet/],
    ['empty', '', /empty/],
    ['surrounding spaces', ' bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86', /spaces/],
    ['Stacks address', 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6', /not a valid mainnet/],
    ['EVM address', '0xb5660bca47faae88a0c286ca8eec920bbae1d7cf', /not a valid mainnet/],
  ])('rejects a %s address', (_name, address, message) => {
    expect(() => encodeWithdrawalRecipient(address)).toThrow(WithdrawalAddressError);
    expect(() => encodeWithdrawalRecipient(address)).toThrow(message);
  });

  it('accepts an all upper-case bech32 address and returns it in lower case', () => {
    const lower = 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86';
    const encoded = encodeWithdrawalRecipient(lower.toUpperCase());
    expect(encoded.address).toBe(lower);
    expect(encoded.recipient.version).toBe('04');
  });
});

describe('round trip over generated keys and scripts', () => {
  const mainnet = btc.Address(MAINNET);
  const cases = Array.from({ length: 16 }, (_, i) => i).flatMap(i => [
    { address: mainnet.encode({ type: 'pkh', hash: bytes(i, 20) }), kind: 'p2pkh', version: '00' },
    {
      address: mainnet.encode({ type: 'sh', hash: bytes(i + 100, 20) }),
      kind: 'p2sh',
      version: '01',
    },
    {
      address: mainnet.encode({ type: 'wpkh', hash: bytes(i + 200, 20) }),
      kind: 'p2wpkh',
      version: '04',
    },
    {
      address: mainnet.encode({ type: 'wsh', hash: bytes(i + 300, 32) }),
      kind: 'p2wsh',
      version: '05',
    },
    {
      address: defined(
        btc.p2tr(btc.utils.pubSchnorr(bytes(i + 400, 32)), undefined, MAINNET).address
      ),
      kind: 'p2tr',
      version: '06',
    },
  ]);

  it('refuses a taproot output key that is not on the curve', () => {
    const offCurve = Array.from({ length: 40 }, (_, i) => bytes(i + 900, 32)).find(key => {
      try {
        btc.OutScript.decode(btc.OutScript.encode({ type: 'tr', pubkey: key }));
        return false;
      } catch {
        return true;
      }
    });
    const address = mainnet.encode({ type: 'tr', pubkey: defined(offCurve) });
    expect(() => encodeWithdrawalRecipient(address)).toThrow(/not a valid curve point/);
  });

  it.each(cases)('$kind $address', ({ address, kind, version }) => {
    const encoded = encodeWithdrawalRecipient(address);
    expect(encoded.kind).toBe(kind);
    expect(encoded.recipient.version).toBe(version);
    expect(encoded.address).toBe(address);
    expect(encoded.scriptPubKey).toBe(scriptPubKeyOfMainnetAddress(address));
    const decoded = decodeWithdrawalRecipient(encoded.recipient);
    expect(decoded.address).toBe(address);
    expect(hex.encode(btc.OutScript.encode(mainnet.decode(decoded.address)))).toBe(
      encoded.scriptPubKey
    );
  });
});

describe('assertRecipientRoundTrip', () => {
  const address = 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86';
  const good = encodeWithdrawalRecipient(address).recipient;

  it('passes for the encoding of the address', () => {
    expect(assertRecipientRoundTrip(address, good).address).toBe(address);
  });

  it('refuses a recipient for another address', () => {
    const other = { ...good, hashbytes: good.hashbytes.replace(/^../, '00') };
    expect(() => assertRecipientRoundTrip(address, other)).toThrow(/not the encoding/);
  });

  it('refuses a recipient with the right hash but another version', () => {
    expect(() => assertRecipientRoundTrip(address, { ...good, version: '05' })).toThrow();
    expect(() => assertRecipientRoundTrip(address, { ...good, version: '00' })).toThrow(
      /not the encoding/
    );
  });

  it('refuses P2SH versions 0x02 and 0x03 even though the signers pay the same script', () => {
    const p2sh = '3P8A35s9V37SqKgsQ9bPxQgdzsou3U2UNY';
    const recipient = encodeWithdrawalRecipient(p2sh).recipient;
    expect(() => assertRecipientRoundTrip(p2sh, { ...recipient, version: '02' })).toThrow(
      /not the encoding/
    );
  });

  it('compares recipients regardless of prefix and case', () => {
    expect(
      sameRecipient(good, { version: '0x04', hashbytes: `0x${good.hashbytes.toUpperCase()}` })
    ).toBe(true);
  });
});
