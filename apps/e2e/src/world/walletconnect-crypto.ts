import { x25519 } from '@noble/curves/ed25519';
import { hex } from '@scure/base';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;

export interface Envelope {
  type: number;
  senderPublicKey: string | null;
  iv: Uint8Array;
  sealed: Uint8Array;
}

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export function topicOf(symKey: string): string {
  return createHash('sha256').update(hex.decode(symKey)).digest('hex');
}

export function newKeyPair(): KeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  return {
    privateKey: hex.encode(privateKey),
    publicKey: hex.encode(x25519.getPublicKey(privateKey)),
  };
}

export function deriveSymKey(privateKey: string, peerPublicKey: string): string {
  const shared = x25519.getSharedSecret(hex.decode(privateKey), hex.decode(peerPublicKey));
  const derived = hkdfSync('sha256', shared, new Uint8Array(0), new Uint8Array(0), KEY_LENGTH);
  return hex.encode(new Uint8Array(derived));
}

export function readEnvelope(message: string): Envelope {
  const bytes = new Uint8Array(Buffer.from(message, 'base64'));
  const type = bytes[0];
  if (type === undefined) throw new Error('An empty WalletConnect envelope');
  if (type === 1) {
    return {
      type,
      senderPublicKey: hex.encode(bytes.slice(1, 1 + KEY_LENGTH)),
      iv: bytes.slice(1 + KEY_LENGTH, 1 + KEY_LENGTH + IV_LENGTH),
      sealed: bytes.slice(1 + KEY_LENGTH + IV_LENGTH),
    };
  }
  return {
    type,
    senderPublicKey: null,
    iv: bytes.slice(1, 1 + IV_LENGTH),
    sealed: bytes.slice(1 + IV_LENGTH),
  };
}

export function open(symKey: string, message: string): string {
  const envelope = readEnvelope(message);
  const decipher = createDecipheriv('chacha20-poly1305', hex.decode(symKey), envelope.iv, {
    authTagLength: TAG_LENGTH,
  });
  const body = envelope.sealed.slice(0, envelope.sealed.length - TAG_LENGTH);
  decipher.setAuthTag(envelope.sealed.slice(envelope.sealed.length - TAG_LENGTH));
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function seal(
  symKey: string,
  payload: string,
  options: { senderPublicKey?: string } = {}
): string {
  const iv = new Uint8Array(randomBytes(IV_LENGTH));
  const cipher = createCipheriv('chacha20-poly1305', hex.decode(symKey), iv, {
    authTagLength: TAG_LENGTH,
  });
  const sealed = Buffer.concat([
    cipher.update(payload, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const head =
    options.senderPublicKey === undefined
      ? Buffer.from([0])
      : Buffer.concat([Buffer.from([1]), Buffer.from(hex.decode(options.senderPublicKey))]);
  return Buffer.concat([head, iv, sealed]).toString('base64');
}
