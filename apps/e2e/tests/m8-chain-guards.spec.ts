import type { Wallets } from '../src/browser/harness.js';
import { expect, test } from '../src/fixtures.js';
import { startAwaitingFunds } from '../src/scenario/journeys.js';
import type { World } from '../src/world/world.js';

interface Case {
  name: string;
  arrange(wallets: Wallets): Promise<void> | void;
  message: string;
  switchAsked: number;
}

const CASES: Case[] = [
  {
    name: 'the wallet refuses to switch to Base',
    arrange: wallets => wallets.evm.behaviour.reject('wallet_switchEthereumChain', { code: 4001 }),
    message: 'The request was rejected in your wallet, so nothing was sent.',
    switchAsked: 1,
  },
  {
    name: 'the wallet says it switched but still reports Ethereum',
    arrange(wallets) {
      wallets.evm.switchMode = 'ignore';
    },
    message: 'The wallet did not switch to the required network',
    switchAsked: 1,
  },
  {
    name: 'the wallet account changed after connecting',
    async arrange(wallets) {
      await wallets.evm.changeAccount();
    },
    message: 'The connected wallet account changed. Reconnect and try again.',
    switchAsked: 1,
  },
];

function expectNothingSent(wallets: Wallets, world: World): void {
  expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toEqual([]);
  expect(world.evm.transactions.size).toBe(0);
  expect(world.swap().status).toBe('PENDING_DEPOSIT');
}

test.describe('M8. network and account guards stop the send before the wallet is asked to pay', () => {
  for (const c of CASES) {
    test(c.name, async ({ app, world, wallets }) => {
      await startAwaitingFunds(app);
      const connectedAs = wallets.evm.address;
      await c.arrange(wallets);
      await app.clickSend();
      await expect(app.sendError).toHaveText(c.message);
      await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');
      await expect(app.sendButton).toBeEnabled();
      expect(await app.sendRecords()).toEqual([]);
      expectNothingSent(wallets, world);
      expect(wallets.evm.behaviour.calls('wallet_switchEthereumChain').map(r => r.params)).toEqual(
        Array.from({ length: c.switchAsked }, () => [{ chainId: '0x2105' }])
      );
      await expect(app.refundInput).toHaveCount(0);
      await expect(
        app.page.getByText(`will be refunded to ${connectedAs}`, { exact: false })
      ).toBeVisible();
    });
  }
});
