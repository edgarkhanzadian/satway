import { SBTC_DEPLOYER } from './hiro.js';
import { type Reply, json, notFound } from './http.js';

const DATA_VAR = `/v2/data_var/${SBTC_DEPLOYER}/sbtc-registry/current-aggregate-pubkey`;

export class AlexStacksNode {
  private readonly aggregateKey: () => string;
  readonly reads: string[] = [];
  keyOverride: string | null = null;

  constructor(aggregateKey: () => string) {
    this.aggregateKey = aggregateKey;
  }

  serve(method: string, path: string, query: URLSearchParams): Reply {
    if (method === 'GET' && path === DATA_VAR) {
      this.reads.push(query.toString());
      const key = this.keyOverride ?? this.aggregateKey();
      return json({ data: `0x0200000021${key}` });
    }
    return notFound('Not found');
  }
}
