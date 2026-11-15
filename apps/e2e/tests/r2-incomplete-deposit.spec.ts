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
    const quote = receipt.quoteResponse.quote;
    world.reportDeposit({ amount: 40_000_000n });
    await app.waitForProgress(INCOMPLETE);
    await app.expectRouteAt('Your chain', 'In progress');
    await expect(
      app.page.getByText(`${quote.amountInFormatted} USDC on base`, { exact: true })
    ).toBeVisible();
    await expect(app.sendButton).toHaveCount(0);
    expect(world.swap().status).toBe('INCOMPLETE_DEPOSIT');

    world.reportDeposit({ amount: 60_000_000n });
    expect(world.swap().status).toBe('PROCESSING');
    await app.waitForProgress(PROGRESS.swapping);
    await expect(app.page.getByText(INCOMPLETE)).toHaveCount(0);
    await finishJourney(app, world);
    expect(wallets.evm.behaviour.requests).toEqual([]);
  });

  test.fail(
    'APP ISSUE: after a short deposit the send box still says "Send exactly" the full quoted amount instead of the remainder (correct: show what is still owed)',
    async ({ app, world }) => {
      await startAwaitingFunds(app, { connectEvm: false, refundTo: world.rng.evmAddress() });
      world.reportDeposit({ amount: 40_000_000n });
      await app.waitForProgress(INCOMPLETE);
      await expect(app.page.getByText('60.0 USDC on base', { exact: true })).toBeVisible({
        timeout: 500,
      });
      await expect(app.page.getByText('100.0 USDC on base', { exact: true })).toHaveCount(0);
    }
  );
});
