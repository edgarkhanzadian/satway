import { PROGRESS, type SatwayApp, type StartedDeposit } from '../src/app/satway-app.js';
import type { Wallets } from '../src/browser/harness.js';
import { expect, test } from '../src/fixtures.js';
import {
  FAILED_TO_LOAD,
  SEND_COPY,
  expectNoSendOffered,
  startDeposit,
} from '../src/scenario/journeys.js';
import { json } from '../src/world/http.js';
import type { FaultOutcome, World } from '../src/world/world.js';

const STATUS = /^\/v0\/status$/;

async function expectManualDetails(app: SatwayApp, started: StartedDeposit): Promise<void> {
  const quote = started.receipt.quoteResponse.quote;
  await expect(app.page.getByText('Send exactly this:', { exact: true })).toBeVisible();
  await expect(
    app.page.getByText(`${quote.amountInFormatted} USDC on base`, { exact: true })
  ).toBeVisible();
  await expect(app.page.getByText(quote.depositAddress, { exact: true })).toBeVisible();
}

function expectWalletNeverAskedToSend(wallets: Wallets, world: World): void {
  expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toEqual([]);
  expect(wallets.evm.behaviour.calls('eth_chainId')).toEqual([]);
  expect(world.evm.transactions.size).toBe(0);
}

test.describe('M1. the swap status is unknown, so the wallet button is not offered', () => {
  test('before the first status reply arrives, then the reply says PENDING_DEPOSIT', async ({
    app,
    world,
    api,
    wallets,
  }) => {
    const held = world.hold({ service: 'oneclick', path: STATUS, callers: ['worker'], skip: 1 });
    const started = await startDeposit(app);

    await expect(app.page.getByText(SEND_COPY.checking, { exact: true })).toBeVisible();
    await expect(app.progress('Checking…')).toBeVisible();
    await expectNoSendOffered(app);
    await expectManualDetails(app, started);
    expect(api.depositPosts().map(r => r.status)).toEqual([201]);
    expect(world.requestsTo('oneclick', { path: '/v0/status' }).map(e => e.status)).toEqual([200]);
    expect(world.parked).toBe(1);

    held.release();
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');
    await expect(app.page.getByText(SEND_COPY.checking)).toHaveCount(0);
    expect(world.requestsTo('oneclick', { path: '/v0/status' }).map(e => e.status)).toEqual([
      200, 200,
    ]);
    expect(api.requests.filter(r => r.path === '/status').map(r => r.status)).toEqual([200]);
    expectWalletNeverAskedToSend(wallets, world);
  });

  const failures: { name: string; outcome: FaultOutcome; upstream: number | 'network-error' }[] = [
    {
      name: 'the swap provider answers 500',
      outcome: json({ message: 'Internal server error' }, 500),
      upstream: 500,
    },
    {
      name: 'the swap provider cannot be reached',
      outcome: 'network-error',
      upstream: 'network-error',
    },
  ];

  for (const failure of failures) {
    test(`when ${failure.name}, then recovers to PENDING_DEPOSIT`, async ({
      app,
      world,
      api,
      wallets,
      harness,
    }) => {
      harness.allowConsoleErrors(FAILED_TO_LOAD);
      world.addFault({ service: 'oneclick', path: STATUS, outcome: failure.outcome });
      const started = await startDeposit(app);
      await app.waitForProgress(PROGRESS.awaitingFunds);

      for (let i = 0; i < 2; i++) {
        await expect(app.page.getByText(SEND_COPY.unknown, { exact: true })).toBeVisible();
        await expectNoSendOffered(app);
        await expectManualDetails(app, started);
        await app.tick();
      }
      const statusCalls = world.requestsTo('oneclick', { path: '/v0/status' });
      expect(statusCalls.length).toBeGreaterThanOrEqual(3);
      expect(new Set(statusCalls.map(e => e.status))).toEqual(new Set([failure.upstream]));
      expect(new Set(api.requests.filter(r => r.path === '/status').map(r => r.status))).toEqual(
        new Set([500])
      );

      world.clearFaults();
      await app.until(() =>
        expect(app.sendButton).toHaveText('Send from Test EVM Wallet', { timeout: 750 })
      );
      await expect(app.page.getByText(SEND_COPY.unknown)).toHaveCount(0);
      await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
      expectWalletNeverAskedToSend(wallets, world);
      expect(await app.sendRecords()).toEqual([]);
    });
  }
});
