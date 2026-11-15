import { bech32, bech32m, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { MAINNET } from 'sbtc';

export type WithdrawalAddressKind = 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr';

export const WITHDRAWAL_ADDRESS_KINDS: readonly WithdrawalAddressKind[] = Object.freeze([
  'p2pkh',
  'p2sh',
  'p2wpkh',
  'p2wsh',
  'p2tr',
]);

export interface WithdrawalRecipient {
  version: string;
  hashbytes: string;
}

export interface DecodedWithdrawalRecipient {
  kind: WithdrawalAddressKind;
  scriptPubKey: string;
  address: string;
}

export interface EncodedWithdrawalRecipient extends DecodedWithdrawalRecipient {
  recipient: WithdrawalRecipient;
}

export class WithdrawalAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalAddressError';
  }
}

const VERSION_OF_KIND: Readonly<Record<WithdrawalAddressKind, string>> = Object.freeze({
  p2pkh: '00',
  p2sh: '01',
  p2wpkh: '04',
  p2wsh: '05',
  p2tr: '06',
});

const HEX = /^(?:[0-9a-f]{2})*$/;

function cleanHex(value: string, what: string): string {
  const clean = value.trim().toLowerCase().replace(/^0x/, '');
  if (!HEX.test(clean)) throw new WithdrawalAddressError(`${what} is not hex`);
  return clean;
}

function bech32Version(address: string): number | null {
  for (const codec of [bech32m, bech32]) {
    const decoded = codec.decodeUnsafe(address.toLowerCase(), 120);
    if (decoded) return decoded.words[0] ?? null;
  }
  return null;
}

function explainUndecodable(address: string): string {
  const lower = address.toLowerCase();
  if (lower.startsWith('tb1') || lower.startsWith('bcrt1')) {
    return 'This is a testnet or regtest Bitcoin address. Only mainnet addresses are supported.';
  }
  if (lower.startsWith('bc1')) {
    const version = bech32Version(address);
    if (version !== null && version >= 2) {
      return `This address uses witness version ${version}, which the sBTC withdrawal contract cannot pay to. Use a P2WPKH, P2WSH, P2TR, P2SH or P2PKH address.`;
    }
    return 'This is not a valid mainnet Bitcoin address: the bech32 checksum or length is wrong.';
  }
  if (/^[mn2]/.test(address)) {
    return 'This is a testnet Bitcoin address. Only mainnet addresses are supported.';
  }
  return 'This is not a valid mainnet Bitcoin address.';
}

function decodeAddress(address: string): ReturnType<ReturnType<typeof btc.Address>['decode']> {
  try {
    return btc.Address(MAINNET).decode(address);
  } catch {
    throw new WithdrawalAddressError(explainUndecodable(address));
  }
}

function canonicalAddress(input: string): {
  address: string;
  kind: WithdrawalAddressKind;
  hash: Uint8Array;
} {
  if (input !== input.trim() || input.length === 0) {
    throw new WithdrawalAddressError('The Bitcoin address is empty or has surrounding spaces.');
  }
  const decoded = decodeAddress(input);
  let kind: WithdrawalAddressKind;
  let hash: Uint8Array;
  switch (decoded.type) {
    case 'pkh':
      kind = 'p2pkh';
      hash = decoded.hash;
      break;
    case 'sh':
      kind = 'p2sh';
      hash = decoded.hash;
      break;
    case 'wpkh':
      kind = 'p2wpkh';
      hash = decoded.hash;
      break;
    case 'wsh':
      kind = 'p2wsh';
      hash = decoded.hash;
      break;
    case 'tr':
      kind = 'p2tr';
      hash = decoded.pubkey;
      break;
    default:
      throw new WithdrawalAddressError(
        'This address type cannot receive an sBTC withdrawal. Use a P2WPKH, P2WSH, P2TR, P2SH or P2PKH address.'
      );
  }
  const address = btc.Address(MAINNET).encode(decoded);
  if (address !== input && address !== input.toLowerCase()) {
    throw new WithdrawalAddressError('The Bitcoin address is not in its standard form.');
  }
  return { address, kind, hash };
}

export function scriptPubKeyOfMainnetAddress(address: string): string {
  return hex.encode(btc.OutScript.encode(decodeAddress(address)));
}

export function encodeWithdrawalRecipient(address: string): EncodedWithdrawalRecipient {
  const parsed = canonicalAddress(address);
  const recipient = { version: VERSION_OF_KIND[parsed.kind], hashbytes: hex.encode(parsed.hash) };
  const decoded = decodeWithdrawalRecipient(recipient);
  if (decoded.kind !== parsed.kind || decoded.address !== parsed.address) {
    throw new WithdrawalAddressError(
      'The withdrawal recipient does not round-trip to the address.'
    );
  }
  return { ...decoded, recipient };
}

function scriptFor(version: number, hash: string): { kind: WithdrawalAddressKind; script: string } {
  const bytes = hash.length / 2;
  if (version <= 4 && bytes !== 20) {
    throw new WithdrawalAddressError(
      `Withdrawal recipient version ${version} needs 20 hash bytes, got ${bytes}`
    );
  }
  if (version >= 5 && bytes !== 32) {
    throw new WithdrawalAddressError(
      `Withdrawal recipient version ${version} needs 32 hash bytes, got ${bytes}`
    );
  }
  switch (version) {
    case 0:
      return { kind: 'p2pkh', script: `76a914${hash}88ac` };
    case 1:
    case 2:
    case 3:
      return { kind: 'p2sh', script: `a914${hash}87` };
    case 4:
      return { kind: 'p2wpkh', script: `0014${hash}` };
    case 5:
      return { kind: 'p2wsh', script: `0020${hash}` };
    case 6:
      return { kind: 'p2tr', script: `5120${hash}` };
    default:
      throw new WithdrawalAddressError(
        `Withdrawal recipient version ${version} is not accepted by the sBTC withdrawal contract`
      );
  }
}

export function decodeWithdrawalRecipient(
  recipient: WithdrawalRecipient
): DecodedWithdrawalRecipient {
  const versionHex = cleanHex(recipient.version, 'Recipient version');
  const hash = cleanHex(recipient.hashbytes, 'Recipient hashbytes');
  if (versionHex.length > 2) {
    throw new WithdrawalAddressError('Recipient version must be at most one byte');
  }
  const version = versionHex === '' ? 0 : parseInt(versionHex, 16);
  const { kind, script } = scriptFor(version, hash);
  let decoded: ReturnType<typeof btc.OutScript.decode>;
  try {
    decoded = btc.OutScript.decode(hex.decode(script));
  } catch {
    throw new WithdrawalAddressError(
      kind === 'p2tr'
        ? 'The taproot output key is not a valid curve point, so BTC sent to it could never be spent.'
        : 'The withdrawal recipient does not form a standard output script.'
    );
  }
  const address = btc.Address(MAINNET).encode(decoded);
  return { kind, scriptPubKey: script, address };
}

export function sameRecipient(a: WithdrawalRecipient, b: WithdrawalRecipient): boolean {
  return (
    cleanHex(a.version, 'Recipient version') === cleanHex(b.version, 'Recipient version') &&
    cleanHex(a.hashbytes, 'Recipient hashbytes') === cleanHex(b.hashbytes, 'Recipient hashbytes')
  );
}

export function assertRecipientRoundTrip(
  address: string,
  recipient: WithdrawalRecipient
): DecodedWithdrawalRecipient {
  const expectedScript = scriptPubKeyOfMainnetAddress(address);
  const encoded = encodeWithdrawalRecipient(address);
  const decoded = decodeWithdrawalRecipient(recipient);
  if (!sameRecipient(encoded.recipient, recipient)) {
    throw new WithdrawalAddressError(
      `The withdrawal recipient is not the encoding of ${encoded.address}; refusing to sign`
    );
  }
  if (decoded.scriptPubKey !== expectedScript || encoded.scriptPubKey !== expectedScript) {
    throw new WithdrawalAddressError(
      `The withdrawal recipient would pay a different script than ${encoded.address}; refusing to sign`
    );
  }
  return decoded;
}
