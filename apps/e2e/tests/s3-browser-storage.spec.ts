import { PROGRESS, type PortageApp } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily } from '../src/scenario/checks.js';
import { expectNoSendOffered, finishJourney } from '../src/scenario/journeys.js';

const ONLY_COPY =
  'This browser could not keep a copy of the receipt, so the file that was just downloaded is the only copy. Keep it: it is what lets you recover your BTC if anything goes wrong.';
const NO_STORAGE =
  'Sending from your wallet is turned off because this browser cannot save a record of the payment, which is what stops it being sent twice. Send it manually using the details above.';
const CANNOT_SAVE =
  'This browser could not save a record of the payment, so the wallet was not asked to send. Send it manually using the details above, or allow this site to store data and reload.';

async function blockStorage(app: PortageApp, name: 'localStorage' | 'sessionStorage') {
  await app.page.addInitScript(store => {
    Object.defineProperty(window, store, {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  }, name);
}

async function failEveryWrite(app: PortageApp): Promise<void> {
  await app.page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Reflect.set(window, '__e2eQuotaFull', false);
    Storage.prototype.setItem = function setItem(name: string, value: string) {
      if (Reflect.get(window, '__e2eQuotaFull') === true)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      Reflect.apply(original, this, [name, value]);
    };
  });
}

async function quotaFull(app: PortageApp): Promise<void> {
  await app.page.evaluate(() => Reflect.set(window, '__e2eQuotaFull', true));
}

async function payManuallyToDone(
  app: PortageApp,
  world: Parameters<typeof finishJourney>[1],
  started: Awaited<ReturnType<PortageApp['continue']>>
) {
  world.reportDeposit();
  await app.waitForProgress(PROGRESS.swapping);
  const payout = await finishJourney(app, world);
  expectRegisteredWithEmily(world, started.receipt, payout.outpoint, 'page');
}

test.describe('S3. browser storage is unavailable or full', () => {
  test.fail(
    'APP ISSUE: with localStorage blocked, the Stacks wallet cannot even be connected ("The operation is insecure."), so nothing can be done (correct: connect works, wallet sending is turned off with the notice, the receipt downloads with the "only copy" warning and a manual payment completes)',
    async ({ app, world }) => {
      await blockStorage(app, 'localStorage');
      await app.open();
      await app.to.getByRole('button', { name: 'Connect Stacks wallet' }).click();
      await expect(app.page.locator('connect-modal')).toBeVisible({ timeout: 3_000 });
      await app.page
        .locator('connect-modal')
        .getByRole('button', { name: 'Connect' })
        .first()
        .click();
      await expect(app.to.getByText('Connected', { exact: true })).toBeVisible();
      await app.connectEvmWallet();
      await app.fillDeposit({ amount: '100' });
      await app.getQuote();
      const started = await app.continue();
      await expect(app.page.getByRole('alert')).toHaveText(ONLY_COPY);
      await app.waitForProgress(PROGRESS.awaitingFunds);
      await expect(app.page.getByText(NO_STORAGE)).toBeVisible();
      await expectNoSendOffered(app);
      await payManuallyToDone(app, world, started);
    }
  );

  test('with localStorage blocked the page still loads and says why connecting failed', async ({
    app,
    harness,
  }) => {
    await blockStorage(app, 'localStorage');
    await app.open();
    await app.to.getByRole('button', { name: 'Connect Stacks wallet' }).click();
    await expect(app.to.getByRole('alert')).toHaveText('The operation is insecure.');
    expect(harness.pageErrors).toEqual([]);
    await app.openRecover();
    await expect(app.page.getByLabel('Receipt file')).toBeEnabled();
  });

  test('localStorage writes fail from the start (connect done first): sending is turned off, the receipt is the only copy, a manual payment completes', async ({
    app,
    world,
    wallets,
  }) => {
    await failEveryWrite(app);
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await quotaFull(app);
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    const started = await app.continue();
    expect(started.receipt.depositAddress).toMatch(/^bc1p/);
    await expect(app.page.getByRole('alert')).toHaveText(ONLY_COPY);
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await expect(app.page.getByText(NO_STORAGE, { exact: true })).toBeVisible();
    await expectNoSendOffered(app);
    await expect(
      app.page.getByText(started.receipt.quoteResponse.quote.depositAddress, { exact: true })
    ).toBeVisible();
    await payManuallyToDone(app, world, started);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toEqual([]);
  });

  test('the quota fills up mid-flow, after the receipt was saved: the wallet is not asked to send and the payment can be made manually', async ({
    app,
    world,
    wallets,
  }) => {
    await failEveryWrite(app);
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    const started = await app.continue();
    await expect(app.page.getByText(ONLY_COPY)).toHaveCount(0);
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await expect(app.sendButton).toBeVisible();
    await quotaFull(app);
    await app.clickSend();
    await expect(app.sendError).toHaveText(CANNOT_SAVE);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toEqual([]);
    expect(await app.sendRecords()).toEqual([]);
    await payManuallyToDone(app, world, started);
  });

  test('sessionStorage blocked: nothing depends on it, the wallet send and the whole deposit work', async ({
    app,
    world,
    harness,
  }) => {
    await blockStorage(app, 'sessionStorage');
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    await app.continue();
    await expect(app.page.getByText(ONLY_COPY)).toHaveCount(0);
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await app.sendFromWallet();
    await finishJourney(app, world);
    expect(harness.pageErrors).toEqual([]);
  });
});
