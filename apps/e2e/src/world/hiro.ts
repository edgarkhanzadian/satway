import { type Reply, json, notFound, parseJson, stringField } from './http.js';

export const SBTC_DEPLOYER = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4';
const REGISTRY_READ = `/v2/contracts/call-read/${SBTC_DEPLOYER}/sbtc-registry/get-current-aggregate-pubkey`;

export class Hiro {
  private readonly aggregateKey: () => string;
  readonly reads: unknown[] = [];
  keyOverride: string | null = null;

  constructor(aggregateKey: () => string) {
    this.aggregateKey = aggregateKey;
  }

  serve(method: string, path: string, body: string): Reply {
    if (method === 'POST' && path === REGISTRY_READ) {
      const parsed = parseJson(body);
      this.reads.push(parsed);
      if (typeof stringField(parsed, 'sender') !== 'string')
        return json({ error: 'Failed to deserialize request body' }, 400);
      const key = this.keyOverride ?? this.aggregateKey();
      return json({ okay: true, result: `0x0200000021${key}` });
    }
    return notFound('Not found');
  }
}
