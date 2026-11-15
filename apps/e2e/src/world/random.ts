import { base58, hex } from '@scure/base';
import { createHash } from 'node:crypto';

export class Rng {
  private counter = 0;
  private readonly seed: string;

  constructor(seed: string) {
    this.seed = seed;
  }

  bytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      this.counter += 1;
      const block = createHash('sha256').update(`${this.seed}:${this.counter}`).digest();
      const take = Math.min(block.length, length - filled);
      out.set(block.subarray(0, take), filled);
      filled += take;
    }
    return out;
  }

  hex(length: number): string {
    return hex.encode(this.bytes(length));
  }

  base58(length: number): string {
    return base58.encode(this.bytes(length));
  }

  uuid(): string {
    const h = this.hex(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  evmAddress(): string {
    return `0x${this.hex(20)}`;
  }
}
