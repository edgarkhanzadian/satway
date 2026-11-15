import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { erc20TransferData } from '../src/scenario/checks.js';
import { SEND_COPY, expectNoSendOffered, finishJourney } from '../src/scenario/journeys.js';
import { startPairing } from '../src/scenario/walletconnect.js';
import {
  WALLETCONNECT_WALLET_NAME,
  WalletConnectWallet,
} from '../src/wallets/walletconnect-wallet.js';
import { TOKENS } from '../src/world/oneclick.js';
import type { World } from '../src/world/world.js';

const CONNECTED = `${WALLETCONNECT_WALLET_NAME} (WalletConnect) connected`;
const SEND_LABEL = `Send from ${WALLETCONNECT_WALLET_NAME} (WalletConnect)`;

async function pairAndQuote(
  app: SatwayApp,
  world: World,
  solanaAddress: string,
  evmChainIds: number[]
): Promise<WalletConnectWallet> {
  await app.open();
  await app.connectStacksWallet();
  const uri = await startPairing(app);
  const wallet = new WalletConnectWallet(world, solanaAddress);
  wallet.approve(uri, { evmChainIds, solana: true });
  await expect(app.from.getByText(CONNECTED)).toBeVisible();
  await expect(app.assetSelect).toHaveValue(TOKENS.usdcBase.assetId);
  await expect(app.refundInput).toHaveValue(wallet.evmAddress);
  await app.fillDeposit({ amount: '100' });
  await app.getQuote();
  await app.continue();
  await app.waitForProgress(PROGRESS.awaitingFunds);
  await expect(app.sendButton).toHaveText(SEND_LABEL);
  return wallet;
}

test.describe('W2. the wallet side of WalletConnect, played in Node through the fake relay', () => {
  test.use({
    walletConnect: 'fake-relay',
    walletSetup: { evm: false, solana: false, stacks: true },
  });

  test('a session with Base and Solana: the send goes out as a session request and the world sees the deposit', async ({
    app,
    world,
    wallets,
  }) => {
    const wallet = await pairAndQuote(app, world, wallets.solana.address, [1, 8453]);
    await expect(app.from.getByText('EVM', { exact: true })).toBeVisible();
    await expect(app.from.getByText('Solana', { exact: true })).toBeVisible();
    expect(wallet.settleReplies).toEqual([
      expect.objectContaining({ jsonrpc: '2.0', result: true }),
    ]);

    await app.sendFromWallet();
    const swap = world.swap();
    expect(
      wallet.requests.map(r => ({ chainId: r.chainId, method: r.method, params: r.params }))
    ).toEqual([
      {
        chainId: 'eip155:8453',
        method: 'eth_sendTransaction',
        params: [
          {
            from: wallet.evmAddress,
            to: TOKENS.usdcBase.contractAddress,
            value: '0x0',
            data: erc20TransferData(swap.depositAddress, swap.amountIn),
          },
        ],
      },
    ]);
    expect([...world.evm.transactions.values()].map(t => t.chainId)).toEqual([8453]);
    expect(swap.status).toBe('PROCESSING');
    await finishJourney(app, world);
  });

  test('a session without the deposit’s chain: the app refuses with its "did not approve" message and sends nothing', async ({
    app,
    world,
    wallets,
  }) => {
    const wallet = await pairAndQuote(app, world, wallets.solana.address, [1]);
    await app.clickSend();
    await expect(app.sendError).toHaveText(
      'Your WalletConnect wallet did not approve Base for this session. Disconnect, connect again and approve Base, or send the funds yourself.'
    );
    expect(wallet.requests.filter(r => r.method === 'eth_sendTransaction')).toEqual([]);
    expect(world.evm.transactions.size).toBe(0);
    expect(await app.sendRecords()).toEqual([]);
  });

  test('the wallet sends but its reply is lost: the page keeps an uncertain record and offers no second send', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(/^\{time: \d+, level: 50, msg: Internal JSON-RPC error\.\}$/);
    const wallet = await pairAndQuote(app, world, wallets.solana.address, [8453]);
    wallet.behaviour.loseReply('eth_sendTransaction', {
      code: -32603,
      message: 'Internal JSON-RPC error.',
    });
    await app.clickSend();
    await expect(app.page.getByText(SEND_COPY.uncertainHeadline, { exact: true })).toBeVisible();
    await expect(app.page.getByText(SEND_COPY.checkWallet)).toBeVisible();
    await expectNoSendOffered(app);
    expect(world.evm.transactions.size).toBe(1);
    expect(wallet.behaviour.lostReplies).toHaveLength(1);
    expect(await app.sendRecords()).toEqual([expect.objectContaining({ state: 'uncertain' })]);
    await app.waitForProgress(PROGRESS.swapping);
    await expectNoSendOffered(app);
  });
});
