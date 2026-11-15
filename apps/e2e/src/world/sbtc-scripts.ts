import { hex } from '@scure/base';

export interface ParsedDepositScript {
  maxFee: number;
  recipient: string;
  signerKey: string;
}

export function parseDepositScript(script: string): ParsedDepositScript | null {
  const match = /^1e([0-9a-f]{16})((?:05|06)[0-9a-f]{42})7520([0-9a-f]{64})ac$/.exec(script);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { maxFee: Number(BigInt(`0x${match[1]}`)), recipient: match[2], signerKey: match[3] };
}

export function parseReclaimScript(script: string): { lockTime: number; key: string } | null {
  const match = /^(0[1-4])([0-9a-f]+)b275(?:20([0-9a-f]{64})ac)$/.exec(script);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const length = parseInt(match[1], 16);
  if (match[2].length !== length * 2) return null;
  const le = hex.decode(match[2]);
  let lockTime = 0;
  le.forEach((byte, i) => {
    lockTime += byte * 256 ** i;
  });
  return { lockTime, key: match[3] };
}
