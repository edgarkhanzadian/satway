import { SOLANA_MAINNET_CAIP2, UPSTREAM } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';
import { field } from '../src/world/http.js';

test.describe('harness self-checks: world faults', () => {
  test('a held request is answered normally only after its gate is released', async ({ world }) => {
    const fetchFn = world.fetchFor('test');
    const held = world.hold({ service: 'mempool', path: /\/blocks\/tip\/height$/ });
    const order: string[] = [];
    async function firstCall(): Promise<string> {
      const response = await fetchFn(`${UPSTREAM.mempool}/api/blocks/tip/height`);
      order.push('first');
      return response.text();
    }
    const first = firstCall();
    const second = await fetchFn(`${UPSTREAM.mempool}/api/blocks/tip/height`);
    order.push('second');
    expect(world.parked).toBe(1);
    world.mine(1);
    held.release();
    expect(await first).toBe(String(world.bitcoin.tip.height));
    expect(await second.text()).toBe(String(world.bitcoin.tip.height - 1));
    expect(order).toEqual(['second', 'first']);
    expect(world.parked).toBe(0);
  });

  test('a Solana fault can target one JSON-RPC method', async ({ world }) => {
    world.addFault({
      service: 'solana',
      rpcMethod: 'getBlockHeight',
      outcome: { status: 503, headers: {}, body: 'down' },
    });
    const fetchFn = world.fetchFor('test');
    const url = `${UPSTREAM.solanaRpc}/v1/?chainId=${SOLANA_MAINNET_CAIP2}&projectId=e2e`;
    function call(method: string) {
      return fetchFn(url, {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
      });
    }
    expect((await call('getBlockHeight')).status).toBe(503);
    const height: unknown = await (await call('getLatestBlockhash')).json();
    expect(field(field(field(height, 'result'), 'value'), 'blockhash')).toEqual(expect.any(String));
    expect(world.requestsTo('solana', { rpcMethod: 'getBlockHeight' })).toHaveLength(1);
  });
});
