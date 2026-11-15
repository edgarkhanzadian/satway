import { PROGRESS, type PortageApp } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily, notifierRun } from '../src/scenario/checks.js';
import {
  REFUSED,
  SEND_COPY,
  expectNoSendOffered,
  finishJourney,
  startAwaitingFunds,
} from '../src/scenario/journeys.js';
import { TOKENS } from '../src/world/oneclick.js';

const RECEIPTS = 'portage.receipts.v1';
const QUOTE = /^\/quote$/;
const FAILED_TO_FETCH = 'Failed to fetch';

async function readyToQuote(app: PortageApp): Promise<void> {
  await app.open();
  await app.connectStacksWallet();
  await app.connectEvmWallet();
  await app.fillDeposit({ amount: '100' });
}

test.describe('S1. our backend (the Worker) is down', () => {
  test('at page load: the asset list cannot load, the app says so and stays usable, and reopening the form retries', async ({
    app,
    harness,
  }) => {
    harness.allowConsoleErrors(REFUSED);
    harness.backendDown();
    await app.open();
    await app.connectStacksWallet();
    await expect(app.page.getByRole('alert')).toHaveText(
      `Could not load the asset list: ${FAILED_TO_FETCH}`
    );
    await expect(app.assetSelect.locator('option')).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: 'Get quote' })).toBeDisabled();
    await app.connectEvmWallet();
    await expect(app.page.getByRole('button', { name: 'Get quote' })).toBeDisabled();

    await app.openRecover();
    await expect(app.page.getByLabel('Receipt file')).toBeEnabled();

    harness.backendUp();
    await app.page.getByRole('button', { name: 'Deposit' }).click();
    await expect(app.assetSelect).toHaveValue(TOKENS.usdcBase.assetId);
    await expect(app.page.getByRole('alert')).toHaveCount(0);
    await app.fillDeposit({ amount: '100' });
    const preview = await app.getQuote();
    expect(preview.expectedSats).toBeGreaterThan(0);
  });

  test('at page load: the asset list cannot load, and "Load the asset list again" retries in place once the backend is back', async ({
    app,
    harness,
  }) => {
    harness.allowConsoleErrors(REFUSED);
    harness.backendDown();
    await app.open();
    await app.connectStacksWallet();
    await expect(app.page.getByRole('alert')).toHaveText(
      `Could not load the asset list: ${FAILED_TO_FETCH}`
    );
    const retry = app.page.getByRole('button', { name: 'Load the asset list again' });
    await retry.click();
    await expect(app.page.getByRole('alert')).toHaveText(
      `Could not load the asset list: ${FAILED_TO_FETCH}`
    );
    harness.backendUp();
    await retry.click();
    await expect(app.assetSelect).toHaveValue(TOKENS.usdcBase.assetId);
    await expect(app.page.getByRole('alert')).toHaveCount(0);
    await expect(retry).toHaveCount(0);
  });

  test('at "Get quote": the quote fails with the app’s message, nothing can be continued, and it works once the backend is back', async ({
    app,
    harness,
    world,
  }) => {
    harness.allowConsoleErrors(REFUSED);
    await readyToQuote(app);
    harness.backendDown({ path: QUOTE });
    await app.page.getByRole('button', { name: 'Get quote' }).click();
    await expect(app.page.getByRole('alert')).toHaveText(FAILED_TO_FETCH);
    await expect(app.definition('You receive about')).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: 'Get quote' })).toBeEnabled();
    expect(world.requestsTo('oneclick', { path: '/v0/quote' })).toEqual([]);

    harness.backendUp();
    await app.getQuote();
    await expect(app.page.getByRole('alert')).toHaveCount(0);
    expect(world.oneClick.swaps.size).toBe(0);
  });

  test('at "Continue": nothing is saved, downloaded, registered or created, and Continue works once the backend is back', async ({
    app,
    harness,
    world,
    api,
  }) => {
    harness.allowConsoleErrors(REFUSED);
    await readyToQuote(app);
    await app.getQuote();
    const downloads: string[] = [];
    app.page.on('download', d => downloads.push(d.suggestedFilename()));
    harness.backendDown({ path: QUOTE });
    await app.page.getByRole('button', { name: 'Continue' }).click();
    await expect(app.page.getByRole('alert')).toHaveText(FAILED_TO_FETCH);
    await harness.idle();
    expect(downloads).toEqual([]);
    expect((await app.storage())[RECEIPTS]).toBeUndefined();
    expect(world.oneClick.swaps.size).toBe(0);
    expect(api.depositPosts()).toEqual([]);
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: 'Continue' })).toBeEnabled();

    harness.backendUp();
    const started = await app.continue();
    expect(downloads).toEqual([started.fileName]);
    expect(world.oneClick.swaps.size).toBe(1);
    expect(api.watched()).toEqual([started.receipt.depositAddress]);
  });

  test('POST /deposits fails: the deposit goes ahead and the open tab registers the payout itself', async ({
    app,
    harness,
    world,
    api,
  }) => {
    harness.allowConsoleErrors(REFUSED);
    harness.backendDown({ method: 'POST', path: /^\/deposits$/ });
    const started = await startAwaitingFunds(app);
    expect(api.depositPosts()).toEqual([]);
    expect(api.watched()).toEqual([]);
    await expect(app.page.getByRole('alert')).toHaveCount(0);
    await app.sendFromWallet();
    const payout = await finishJourney(app, world);
    expectRegisteredWithEmily(world, started.receipt, payout.outpoint, 'page');
    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 0 }));
  });

  test('during tracking: the swap status becomes unknown, no send is offered, and it recovers when the backend returns', async ({
    app,
    harness,
    world,
    wallets,
  }) => {
    harness.allowConsoleErrors(REFUSED);
    await startAwaitingFunds(app);
    await expect(app.sendButton).toBeVisible();
    harness.backendDown();
    for (let i = 0; i < 3; i++) {
      await app.tick();
      await expect(app.page.getByText(SEND_COPY.unknown, { exact: true })).toBeVisible();
      await expectNoSendOffered(app);
      await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
      await app.expectRouteAt('Your chain', 'In progress');
    }
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toEqual([]);

    harness.backendUp();
    await app.until(() => expect(app.sendButton).toBeVisible({ timeout: 750 }));
    await expect(app.page.getByText(SEND_COPY.unknown)).toHaveCount(0);
    await app.sendFromWallet();
    harness.backendDown();
    await app.tick();
    await expect(app.progress('Sent from your wallet.')).toBeVisible();
    await expectNoSendOffered(app);
    harness.backendUp();
    await finishJourney(app, world);
  });
});
