import type { Download } from '@playwright/test';

import type { SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { field } from '../src/world/http.js';
import type { World } from '../src/world/world.js';

const RECEIPTS = 'satway.receipts.v1';

function lowerLiveQuote(world: World, factor: number): void {
  world.oneClick.tamper = (response, { dry }) => {
    const quote = field(response, 'quote');
    if (dry || typeof quote !== 'object' || quote === null) return;
    for (const key of ['amountOut', 'minAmountOut'] as const) {
      Reflect.set(quote, key, String(Math.floor(Number(field(quote, key)) * factor)));
    }
  };
}

function sats(n: number): string {
  return `${n.toLocaleString('en-US')} sats`;
}

async function quoted(app: SatwayApp): Promise<Download[]> {
  const downloads: Download[] = [];
  app.page.on('download', d => downloads.push(d));
  await app.open();
  await app.connectStacksWallet();
  await app.connectEvmWallet();
  await app.fillDeposit({ amount: '100' });
  return downloads;
}

test.describe('H. the live quote at Continue is worse than the preview', () => {
  test('the new amounts are shown and nothing starts until the user confirms them', async ({
    app,
    world,
    api,
  }) => {
    const downloads = await quoted(app);
    const preview = await app.getQuote();
    lowerLiveQuote(world, 0.95);
    await app.page.getByRole('button', { name: 'Continue' }).click();
    await expect(app.progress(/^The price moved since your quote/)).toBeVisible();
    const live = world.oneClick.latestQuote(false);
    const expected = Number(live.amountOut);
    const minimum = Number(live.minAmountOut);
    await expect(
      app.progress(
        `The price moved since your quote. You would now receive about ${sats(expected)} as sBTC, at least ${sats(minimum)}, instead of about ${sats(preview.expectedSats)}, at least ${sats(preview.minimumSats)}. Continue only if the new amounts are acceptable.`
      )
    ).toBeVisible();
    await app.harnessIdle();
    expect(downloads).toEqual([]);
    expect((await app.storage())[RECEIPTS]).toBeUndefined();
    expect(api.depositPosts()).toEqual([]);
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toHaveCount(0);

    const started = app.page.waitForEvent('download');
    await app.page.getByRole('button', { name: 'Continue with the new amounts' }).click();
    await started;
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await expect(app.definition('Quoted to receive')).toHaveText(
      `about ${sats(expected)} as sBTC, at least ${sats(minimum)} before the signers’ Bitcoin fee`
    );
    expect(api.depositPosts()).toHaveLength(1);

    await app.openRecover();
    await app.pickSavedReceipt('100.0 USDC');
    await expect(app.definition('Quoted to receive')).toHaveText(
      `about ${sats(expected)} as sBTC, at least ${sats(minimum)} before the signers’ Bitcoin fee`
    );
  });

  test('cancelling leaves the new quote unused: nothing is saved, downloaded or registered', async ({
    app,
    world,
    api,
  }) => {
    const downloads = await quoted(app);
    await app.getQuote();
    lowerLiveQuote(world, 0.9);
    await app.page.getByRole('button', { name: 'Continue' }).click();
    await app.page.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await app.harnessIdle();
    expect(downloads).toEqual([]);
    expect((await app.storage())[RECEIPTS]).toBeUndefined();
    expect(api.depositPosts()).toEqual([]);
    expect(world.oneClick.swaps.size).toBe(1);
    expect([...world.oneClick.swaps.values()][0]?.status).toBe('PENDING_DEPOSIT');
  });

  test('a small move within the slippage starts the deposit without asking', async ({
    app,
    world,
  }) => {
    await quoted(app);
    await app.getQuote();
    lowerLiveQuote(world, 0.995);
    await app.continue();
    await expect(app.page.getByText(/^The price moved/)).toHaveCount(0);
  });
});
