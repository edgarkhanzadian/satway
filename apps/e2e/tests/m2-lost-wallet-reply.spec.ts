import { PROGRESS, type SatwayApp, type StartedDeposit } from '../src/app/satway-app.js';
import type { Wallets } from '../src/browser/harness.js';
import { expect, test } from '../src/fixtures.js';
import {
  SEND_COPY,
  expectNoSendOffered,
  finishJourney,
  resumeIn,
  startAwaitingFunds,
} from '../src/scenario/journeys.js';
import { field } from '../src/world/http.js';
import type { World } from '../src/world/world.js';

const MINUTE = 60_000;

function sendCalls(wallets: Wallets): number {
  return wallets.evm.behaviour.calls('eth_sendTransaction').length;
}

async function waitUntilTheWalletIsAsked(app: SatwayApp, wallets: Wallets): Promise<void> {
  await expect(app.page.getByRole('button', { name: 'Confirm in your wallet…' })).toBeDisabled();
  await expect.poll(() => sendCalls(wallets)).toBe(1);
}

async function expectOneRecord(app: SatwayApp, started: StartedDeposit, state: string) {
  const records = await app.sendRecords();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    version: 1,
    state,
    swap: { address: started.receipt.quoteResponse.quote.depositAddress, memo: null },
  });
  return records[0];
}

async function expectAttemptingView(app: SatwayApp): Promise<void> {
  await expect(app.page.getByText(SEND_COPY.attemptingHeadline, { exact: true })).toBeVisible();
  await expect(app.page.getByText(SEND_COPY.promptOpen, { exact: true })).toBeVisible();
  await expect(app.page.getByText(SEND_COPY.checkWallet, { exact: true })).toBeVisible();
  await expect(app.confirmNothingSentButton).toHaveCount(0);
  await expectNoSendOffered(app);
}

async function settlesWhenTheProviderSeesIt(
  app: SatwayApp,
  world: World,
  started: StartedDeposit
): Promise<void> {
  expect(world.evm.pending()).toHaveLength(1);
  expect(world.swap().status).toBe('PENDING_DEPOSIT');
  world.evm.mine();
  expect(world.swap().status).toBe('PROCESSING');
  await app.waitForProgress(PROGRESS.swapping);
  expect(await expectOneRecord(app, started, 'sent')).toMatchObject({ via: 'provider' });
  await finishJourney(app, world);
}

test.describe('M2. the EVM wallet broadcast the payment but its reply was lost', () => {
  test.beforeEach(({ world }) => {
    world.evm.autoMine = false;
  });

  test('the reply is an error: uncertain everywhere, never asked twice, settled by the provider', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    wallets.evm.behaviour.loseReply('eth_sendTransaction', {
      code: -32603,
      message: 'Internal JSON-RPC error.',
    });
    await app.clickSend();
    await expect(app.page.getByText(SEND_COPY.uncertainHeadline, { exact: true })).toBeVisible();
    await expect(
      app.page.getByText('What happened: Internal JSON-RPC error.', { exact: true })
    ).toBeVisible();
    await expect(app.page.getByText(SEND_COPY.checkWallet, { exact: true })).toBeVisible();
    await expect(app.confirmNothingSentButton).toBeVisible();
    await expectNoSendOffered(app);
    expect(world.evm.transactions.size).toBe(1);
    expect(field(wallets.evm.behaviour.lostReplies[0]?.reply, 'ok')).toBe(true);
    expect(await expectOneRecord(app, started, 'uncertain')).toMatchObject({
      tx: null,
      account: wallets.evm.address,
      message: 'Internal JSON-RPC error.',
    });

    await resumeIn(app, started);
    await expect(app.page.getByText(SEND_COPY.uncertainHeadline, { exact: true })).toBeVisible();
    await expectNoSendOffered(app);

    const second = await app.newTab();
    await resumeIn(second, started);
    await expect(second.page.getByText(SEND_COPY.uncertainHeadline, { exact: true })).toBeVisible();
    await expectNoSendOffered(second);
    await second.page.close();

    await app.tick();
    await expectNoSendOffered(app);
    expect(sendCalls(wallets)).toBe(1);
    await settlesWhenTheProviderSeesIt(app, world, started);
    expect(sendCalls(wallets)).toBe(1);
    expect(world.evm.transactions.size).toBe(1);
  });

  test('the reply never comes: the confirm control waits out the 15-minute prompt window', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    wallets.evm.behaviour.loseReply('eth_sendTransaction', 'hang');
    await app.clickSend();
    await waitUntilTheWalletIsAsked(app, wallets);
    await expectNoSendOffered(app);
    expect(world.evm.transactions.size).toBe(1);
    await expectOneRecord(app, started, 'attempting');

    await resumeIn(app, started);
    await expectAttemptingView(app);
    const second = await app.newTab();
    await resumeIn(second, started);
    await expectAttemptingView(second);
    await second.page.close();

    await app.fastForward(14 * MINUTE);
    await expectAttemptingView(app);
    await app.fastForward(2 * MINUTE);
    await expect(app.confirmNothingSentButton).toBeVisible();
    await expect(app.page.getByText(SEND_COPY.promptOpen)).toHaveCount(0);
    await expectNoSendOffered(app);

    expect(sendCalls(wallets)).toBe(1);
    await settlesWhenTheProviderSeesIt(app, world, started);
    expect(sendCalls(wallets)).toBe(1);
  });

  test('nothing left the wallet: after the window, "nothing was sent" brings the button back and the retry pays once', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    wallets.evm.behaviour.hang('eth_sendTransaction');
    await app.clickSend();
    await waitUntilTheWalletIsAsked(app, wallets);
    expect(world.evm.transactions.size).toBe(0);

    await resumeIn(app, started);
    await expectAttemptingView(app);
    await app.fastForward(14 * MINUTE);
    await expectAttemptingView(app);
    await app.fastForward(2 * MINUTE);
    await app.confirmNothingSentButton.click();
    await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');
    expect(await app.sendRecords()).toEqual([]);

    world.evm.autoMine = true;
    await app.sendFromWallet();
    expect(sendCalls(wallets)).toBe(2);
    expect(world.evm.transactions.size).toBe(1);
    expect(world.oneClick.arrivals).toHaveLength(1);
    expect(world.swap().status).toBe('PROCESSING');
    expect(await expectOneRecord(app, started, 'sent')).toMatchObject({ via: 'wallet' });
    await app.waitForProgress(PROGRESS.swapping);
  });
});
