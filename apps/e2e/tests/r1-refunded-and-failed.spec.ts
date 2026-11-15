import { PROGRESS } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import { startAwaitingFunds } from '../src/scenario/journeys.js';
import type { OneClick, Swap } from '../src/world/oneclick.js';

interface Stop {
  name: string;
  end(oneClick: OneClick, swap: Swap): void;
  message: string;
}

const STOPS: Stop[] = [
  {
    name: 'the swap is refunded by 1Click',
    end: (oneClick, swap) => oneClick.refund(swap, 'Price moved beyond the slippage'),
    message: 'The swap did not complete and your funds were sent back to your refund address.',
  },
  {
    name: 'the swap fails at 1Click',
    end: (oneClick, swap) => oneClick.fail(swap),
    message:
      'The swap failed. Contact the swap provider with your swap deposit address to recover the funds.',
  },
];

test.describe('R1. the swap stops at 1Click', () => {
  for (const stop of STOPS) {
    test(`${stop.name}: the route marks the stop, no reclaim is offered and polling ends`, async ({
      app,
      world,
      api,
    }) => {
      const { receipt } = await startAwaitingFunds(app);
      await app.sendFromWallet();
      await app.waitForProgress(PROGRESS.swapping);
      stop.end(world.oneClick, world.swap());
      await app.waitForProgress(stop.message);

      const swapStop = app.stop('Swap to BTC');
      await expect(swapStop).toHaveAttribute('aria-current', 'step');
      await expect(swapStop).toHaveAttribute('data-status', 'failed');
      await expect(swapStop).toContainText('Stopped here');
      await expect(app.stop('Your chain')).toHaveAttribute('data-status', 'done');
      await expect(app.stop('Bitcoin deposit')).toHaveAttribute('data-status', 'pending');
      await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
      await expect(app.page.getByRole('button', { name: 'Start another' })).toBeVisible();
      await expect(app.definition('Reclaim available')).toHaveCount(0);
      await expect(app.sendButton).toHaveCount(0);

      const calls = api.requests.filter(r => r.path === '/status').length;
      const mempoolReads = world.requestsTo('mempool', { caller: 'page' }).length;
      for (let i = 0; i < 3; i++) await app.tick();
      expect(api.requests.filter(r => r.path === '/status')).toHaveLength(calls);
      expect(world.requestsTo('mempool', { caller: 'page' })).toHaveLength(mempoolReads);
      await expect(app.progress(stop.message)).toBeVisible();

      await app.openRecover();
      await app.pickSavedReceipt(`${receipt.quoteResponse.quote.amountInFormatted} USDC`);
      await expect(app.progress(stop.message)).toBeVisible();
      await expect(app.page.getByRole('button', { name: 'Reclaim BTC' })).toHaveCount(0);
      await expect(app.page.getByLabel('Output to reclaim')).toHaveCount(0);
      await expect(app.page.getByRole('button', { name: 'Follow this deposit' })).toHaveCount(0);
      expect(world.bitcoin.broadcasts).toEqual([]);
    });
  }
});
