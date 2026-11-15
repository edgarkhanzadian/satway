import { readFile } from 'node:fs/promises';

import { PROGRESS } from '../src/app/portage-app.js';
import { receiptFileSchema } from '../src/app/receipt.js';
import { expect, test } from '../src/fixtures.js';
import { expectReceiptMatchesWorld } from '../src/scenario/checks.js';
import { startAwaitingFunds } from '../src/scenario/journeys.js';
import { reclaimFromRecover } from '../src/scenario/reclaim.js';
import { openReceiptInRecover, toReclaimable } from '../src/scenario/states.js';
import { TOKENS } from '../src/world/oneclick.js';

const REVOKE_AFTER_MS = 60_000;

test.describe('Q6. WebKit', () => {
  test('the receipt download starts, its file is a valid receipt, and downloading again after the URL is revoked still works @webkit', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    const first = await readFile(started.receiptPath, 'utf8');
    const parsed = receiptFileSchema.parse(JSON.parse(first));
    expectReceiptMatchesWorld(parsed, {
      world,
      wallets,
      refundTo: wallets.evm.address,
      assetId: TOKENS.usdcBase.assetId,
    });
    const stored: unknown = JSON.parse((await app.storage())['portage.receipts.v1'] ?? '[]');
    expect(stored).toEqual([JSON.parse(first)]);

    await app.fastForward(REVOKE_AFTER_MS + 1_000);
    await app.waitForProgress(PROGRESS.awaitingFunds);
    const again = app.page.waitForEvent('download');
    await app.page.getByRole('button', { name: 'Download receipt again' }).click();
    const download = await again;
    expect(download.suggestedFilename()).toBe(started.fileName);
    expect(await download.failure()).toBeNull();
    expect(await readFile(await download.path(), 'utf8')).toBe(first);
  });

  test('a reclaim after the timelock @webkit', async ({ app, world, wallets }) => {
    const { started, payout } = await toReclaimable(app, world);
    await openReceiptInRecover(app, started);
    await reclaimFromRecover(app, wallets.stacks.account.paymentAddress);
    await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
    expect(world.bitcoin.rejected).toEqual([]);
    expect(world.bitcoin.isSpent(payout.outpoint)).toBe(true);
  });
});
