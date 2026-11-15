import { expect, test } from '../src/fixtures.js';
import { field } from '../src/world/http.js';

function sendTx(from: string, to: string) {
  return { method: 'eth_sendTransaction', params: [{ from, to, value: '0x2386f26fc10000' }] };
}

function hashOf(reply: unknown): string {
  const value = field(reply, 'value');
  if (typeof value !== 'string') throw new Error(`No hash in ${JSON.stringify(reply)}`);
  return value;
}

test.describe('harness self-checks: the EVM wallet and chain', () => {
  test('a transaction stays pending until mined, and only a mined, successful one credits 1Click', async ({
    world,
    wallets,
  }) => {
    world.evm.autoMine = false;
    const to = world.rng.evmAddress();
    const hash = hashOf(await wallets.evm.handle(sendTx(wallets.evm.address, to)));
    expect(world.evm.receipt(hash)).toBeNull();
    expect(field(world.evm.byHash(hash), 'blockNumber')).toBeNull();
    expect(world.oneClick.arrivals).toEqual([]);
    expect(
      await wallets.evm.handle({ method: 'eth_getTransactionReceipt', params: [hash] })
    ).toEqual({ ok: true, value: null });

    world.evm.mine();
    expect(field(world.evm.receipt(hash), 'status')).toBe('0x1');
    expect(world.oneClick.arrivals).toHaveLength(1);

    world.evm.revertNext = 1;
    const reverted = hashOf(await wallets.evm.handle(sendTx(wallets.evm.address, to)));
    world.evm.mine();
    expect(field(world.evm.receipt(reverted), 'status')).toBe('0x0');
    expect(world.oneClick.arrivals).toHaveLength(1);
  });

  test('a lost reply still broadcasts: an error reply and a reply that never comes', async ({
    world,
    wallets,
  }) => {
    const to = world.rng.evmAddress();
    wallets.evm.behaviour.loseReply('eth_sendTransaction', {
      code: -32603,
      message: 'Internal JSON-RPC error.',
    });
    expect(await wallets.evm.handle(sendTx(wallets.evm.address, to))).toEqual({
      ok: false,
      error: { code: -32603, message: 'Internal JSON-RPC error.' },
    });
    expect(world.evm.transactions.size).toBe(1);
    expect(world.oneClick.arrivals).toHaveLength(1);

    wallets.evm.behaviour.loseReply('eth_sendTransaction', 'hang');
    let settled = false;
    async function send(): Promise<void> {
      await wallets.evm.handle(sendTx(wallets.evm.address, to));
      settled = true;
    }
    void send();
    await expect.poll(() => wallets.evm.behaviour.lostReplies.length).toBe(2);
    expect(settled).toBe(false);
    expect(world.evm.transactions.size).toBe(2);
    expect(wallets.evm.behaviour.lostReplies.map(l => l.reply.ok)).toEqual([true, true]);
  });

  test('chain switching can be refused or silently ignored', async ({ wallets }) => {
    wallets.evm.behaviour.reject('wallet_switchEthereumChain', { code: 4001 });
    const switchTo = { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] };
    expect(await wallets.evm.handle(switchTo)).toEqual({
      ok: false,
      error: { code: 4001, message: 'User rejected the request.' },
    });
    expect(wallets.evm.chainId).toBe(1);
    wallets.evm.switchMode = 'ignore';
    expect(await wallets.evm.handle(switchTo)).toEqual({ ok: true, value: null });
    expect(wallets.evm.chainId).toBe(1);
    wallets.evm.switchMode = 'switch';
    expect(await wallets.evm.handle(switchTo)).toEqual({ ok: true, value: null });
    expect(wallets.evm.chainId).toBe(8453);
  });

  test('accountsChanged and chainChanged reach listeners on the injected provider', async ({
    app,
    wallets,
  }) => {
    await app.open();
    await app.page.evaluate(() => {
      const seen: unknown[] = [];
      Reflect.set(window, 'seenEvmEvents', seen);
      window.addEventListener('eip6963:announceProvider', event => {
        const provider: unknown = Reflect.get(Reflect.get(event, 'detail'), 'provider');
        const on: unknown = Reflect.get(Object(provider), 'on');
        if (typeof on !== 'function') return;
        Reflect.apply(on, provider, [
          'accountsChanged',
          (v: unknown) => seen.push(['accounts', v]),
        ]);
        Reflect.apply(on, provider, ['chainChanged', (v: unknown) => seen.push(['chain', v])]);
      });
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    });
    const next = await wallets.evm.changeAccount();
    await wallets.evm.changeChain(8453);
    expect(await app.page.evaluate((): unknown => Reflect.get(window, 'seenEvmEvents'))).toEqual([
      ['accounts', [next]],
      ['chain', '0x2105'],
    ]);
    expect(await wallets.evm.handle({ method: 'eth_accounts' })).toEqual({
      ok: true,
      value: [next],
    });
  });
});
