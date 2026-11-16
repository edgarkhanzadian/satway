import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily } from '../src/scenario/checks.js';
import { expectNoSendOffered, finishJourney } from '../src/scenario/journeys.js';

const ONLY_COPY =
  'This browser could not keep a copy of the receipt, so the file that was just downloaded is the only copy. Keep it: it is what lets you recover your BTC if anything goes wrong.';
const NO_STORAGE =
  'Sending from your wallet is turned off because this browser cannot save a record of the payment, which is what stops it being sent twice. Send it manually using the details above.';
const STORAGE_BLOCKED =
  'Connecting a Stacks wallet needs this site to store data in your browser, and this browser is blocking that (private browsing, or site data turned off for this site).';
const CANNOT_SAVE =
  'This browser could not save a record of the payment, so the wallet was not asked to send. Send it manually using the details above, or allow this site to store data and reload.';

async function blockStorage(app: SatwayApp, name: 'localStorage' | 'sessionStorage') {
  await app.page.addInitScript(store => {
    Object.defineProperty(window, store, {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  }, name);
}

async function failEveryWrite(app: SatwayApp): Promise<void> {
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

async function quotaFull(app: SatwayApp): Promise<void> {
  await app.page.evaluate(() => Reflect.set(window, '__e2eQuotaFull', true));
}

async function payManuallyToDone(
  app: SatwayApp,
  world: Parameters<typeof finishJourney>[1],
  started: Awaited<ReturnType<SatwayApp['continue']>>
) {
  world.reportDeposit();
  await app.waitForProgress(PROGRESS.swapping);
  const payout = await finishJourney(app, world);
  expectRegisteredWithEmily(world, started.receipt, payout.outpoint, 'page');
}

test.describe('S3. browser storage is unavailable or full', () => {
  test('with localStorage blocked, the Stacks wallet panel says up front that the wallet connection needs browser storage and how to proceed, instead of failing inside the wallet library', async ({
    app,
    harness,
  }) => {
    await blockStorage(app, 'localStorage');
    await app.open();
    await expect(app.to.getByRole('alert')).toHaveText(STORAGE_BLOCKED);
    await expect(
      app.to.getByText(/^Allow site data for this page, or open it outside private browsing/)
    ).toBeVisible();
    await expect(app.to.getByRole('button', { name: 'Connect Stacks wallet' })).toHaveCount(0);
    await expect(app.page.getByText('The operation is insecure.')).toHaveCount(0);
    expect(harness.pageErrors).toEqual([]);
    await app.openYourDeposits();
    await expect(app.page.getByLabel('Receipt file')).toBeEnabled();
    await expect(
      app.page.getByText(
        'This browser’s storage is unavailable, so it cannot remember your deposits here. Load a receipt file below to check one.'
      )
    ).toBeVisible();
    await app.openTab('Withdraw');
    await expect(
      app.page.getByText(
        'This browser’s storage is unavailable, so it cannot remember your withdrawals here. Load a receipt file below to check one.'
      )
    ).toBeVisible();
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

  test('a hidden deposit whose receipt could not be kept is not replaced by a new one without a warning', async ({
    app,
  }) => {
    await failEveryWrite(app);
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    await quotaFull(app);
    const first = await app.continue();
    await expect(app.page.getByText(ONLY_COPY)).toBeVisible();
    await app.page.getByRole('button', { name: 'Hide', exact: true }).click();
    async function continueWhileHidden(): Promise<void> {
      await app.fillDeposit({ amount: '60' });
      await app.getQuote();
      const downloaded = app.page.waitForEvent('download');
      await app.page.getByRole('button', { name: 'Continue' }).click();
      await downloaded;
    }
    await continueWhileHidden();
    await expect(app.page.getByRole('alert')).toHaveText(
      'This browser could not keep a copy of the hidden deposit’s receipt. If you follow another deposit, only the receipt file that was downloaded can bring this one back. Keep that file.'
    );
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toHaveCount(0);
    await app.page.getByRole('button', { name: 'Keep following this one' }).click();
    await app.page.getByRole('button', { name: 'Show progress', exact: true }).click();
    await expect(app.page.getByText(first.receipt.depositAddress, { exact: true })).toBeVisible();
    await app.page.getByRole('button', { name: 'Hide', exact: true }).click();
    await continueWhileHidden();
    await app.page.getByRole('button', { name: 'Follow the other deposit' }).click();
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await expect(app.page.getByText(first.receipt.depositAddress, { exact: true })).toHaveCount(0);
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
