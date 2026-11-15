import { PROGRESS } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import { finishJourney, startAwaitingFunds } from '../src/scenario/journeys.js';

const INCOMPLETE =
  'Less than the quoted amount arrived. Send the rest before the deadline, or it will be refunded.';

test.describe('R2. less than the quoted amount arrives (INCOMPLETE_DEPOSIT)', () => {
  test('the page asks for the rest, offers no wallet send, and proceeds when the rest arrives', async ({
    app,
    world,
    wallets,
  }) => {
    const { receipt } = await startAwaitingFunds(app, {
      connectEvm: false,
      refundTo: world.rng.evmAddress(),
    });
    expect(receipt.quoteResponse.quote.amountInFormatted).toBe('100.0');
    world.reportDeposit({ amount: 40_000_000n });
    await app.waitForProgress(INCOMPLETE);
    await app.expectRouteAt('Your chain', 'In progress');
    await expect(app.page.getByText('60.0 USDC on base', { exact: true })).toBeVisible();
    await expect(app.sendButton).toHaveCount(0);
    expect(world.swap().status).toBe('INCOMPLETE_DEPOSIT');

    world.reportDeposit({ amount: 60_000_000n });
    expect(world.swap().status).toBe('PROCESSING');
    await app.waitForProgress(PROGRESS.swapping);
    await expect(app.page.getByText(INCOMPLETE)).toHaveCount(0);
    await finishJourney(app, world);
    expect(wallets.evm.behaviour.requests).toEqual([]);
  });

  test('after a short deposit the send box asks for exactly the remainder 1Click reports, not the full quoted amount', async ({
    app,
    world,
  }) => {
    await startAwaitingFunds(app, { connectEvm: false, refundTo: world.rng.evmAddress() });
    world.reportDeposit({ amount: 40_000_000n });
    await app.waitForProgress(INCOMPLETE);
    await expect(
      app.page.getByText('Part of the amount arrived. Send exactly the rest, from your own wallet:')
    ).toBeVisible();
    await expect(app.page.getByText('60.0 USDC on base', { exact: true })).toBeVisible({
      timeout: 500,
    });
    await expect(app.page.getByText('100.0 USDC on base', { exact: true })).toHaveCount(0);
  });

  test('when 1Click does not say how much arrived, the page says so instead of showing a wrong remainder', async ({
    app,
    world,
  }) => {
    world.oneClick.reportDeposited = false;
    await startAwaitingFunds(app, { connectEvm: false, refundTo: world.rng.evmAddress() });
    world.reportDeposit({ amount: 40_000_000n });
    await app.waitForProgress(INCOMPLETE);
    await expect(
      app.page.getByText(
        'Part of the amount arrived, but the swap provider did not say how much. From your own wallet, send only what is missing from the quoted total:'
      )
    ).toBeVisible();
    await expect(app.page.getByText('100.0 USDC on base', { exact: true })).toBeVisible();
    await expect(app.page.getByText('60.0 USDC on base', { exact: true })).toHaveCount(0);
    await expect(app.sendButton).toHaveCount(0);
  });
});
