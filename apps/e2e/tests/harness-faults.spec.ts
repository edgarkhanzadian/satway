import { UPSTREAM } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';

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
});
