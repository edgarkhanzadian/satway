import { REPLACED_PAYOUT_NOTE } from '@satway/core';

import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily, notifierRun } from '../src/scenario/checks.js';
import {
  FAILED_TO_LOAD,
  payOut,
  savedLabel,
  startAwaitingFunds,
  startDeposit,
} from '../src/scenario/journeys.js';
import type { ApiWorker } from '../src/worker/worker.js';
import { outpointKey } from '../src/world/bitcoin.js';
import type { OneClick, Swap } from '../src/world/oneclick.js';
import type { PayoutResult, World } from '../src/world/world.js';

const ARRIVED_EARLY = 'A payment arrived at this address before your swap paid out.';

async function expectOnePayment(app: SatwayApp): Promise<void> {
  await expect(app.page.getByText(/payments arrived/)).toHaveCount(0);
  await expect(app.page.getByText(/other payments? at your deposit address/)).toHaveCount(0);
}

function replace(world: World, payout: PayoutResult, rename: boolean): PayoutResult {
  return world.replacePayout(payout, {
    rename,
    changeFirst: true,
    amountSats: payout.amountSats - 300,
  });
}

async function mintToDone(app: SatwayApp, world: World, payout: PayoutResult): Promise<void> {
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(payout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();
  await expectOnePayment(app);
}

function registeredOf(api: ApiWorker, address: string): unknown {
  const watch = api.watch(address);
  return watch && typeof watch === 'object' && 'registered' in watch ? watch.registered : null;
}

test.describe('R11. the Bitcoin payout is replaced before it confirms', () => {
  test('(a) page open, 1Click keeps naming the replaced payout: the replacement is registered, minted and the deposit completes', async ({
    app,
    world,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    const started = await startAwaitingFunds(app);
    const { receipt } = started;
    await app.sendFromWallet();
    const original = await payOut(app, world);
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    expectRegisteredWithEmily(world, receipt, original.outpoint, 'page');

    const replacement = replace(world, original, false);
    expect(world.swap().destinationTxHashes).toEqual([original.tx.txid]);
    expect(replacement.outpoint.vout).toBe(1);
    await app.tick();
    await expect(app.progress(ARRIVED_EARLY)).toBeVisible();
    await app.waitForProgress(REPLACED_PAYOUT_NOTE);
    await expect(app.progress(PROGRESS.payoutUnconfirmed)).toBeVisible();
    expectRegisteredWithEmily(world, receipt, replacement.outpoint, 'page');
    await expectOnePayment(app);
    await expect(app.page.locator('code', { hasText: replacement.tx.txid }).first()).toBeVisible();
    await expect(app.page.locator('code', { hasText: original.tx.txid })).toHaveCount(0);

    await mintToDone(app, world, replacement);
    await expect(app.progress(REPLACED_PAYOUT_NOTE)).toBeVisible();
    expect(world.emily.get(original.outpoint.txid, 0)?.status).toBe('pending');

    await app.openYourDeposits();
    const entry = app.savedEntry(savedLabel(started));
    await expect(entry).toContainText('Waiting for the BTC payout');
    await entry.getByRole('button', { name: 'Check again' }).click();
    await expect(entry).toContainText('sBTC minted');
  });

  test('(b) page closed: the Worker registers the replacement and ends the watch only once it confirms', async ({
    app,
    world,
    api,
  }) => {
    const started = await startDeposit(app);
    const { receipt } = started;
    await app.page.close();
    world.reportDeposit();
    const original = world.completeSwap();
    expect(await api.runScheduled()).toEqual(
      notifierRun({
        watched: 1,
        notified: [{ address: receipt.depositAddress, txid: original.outpoint.txid, vout: 0 }],
      })
    );

    const replacement = replace(world, original, true);
    expect(await api.runScheduled()).toEqual(
      notifierRun({
        watched: 1,
        notified: [{ address: receipt.depositAddress, txid: replacement.outpoint.txid, vout: 1 }],
      })
    );
    expect(registeredOf(api, receipt.depositAddress)).toEqual(
      [outpointKey(original.outpoint), outpointKey(replacement.outpoint)].sort()
    );
    expectRegisteredWithEmily(world, receipt, replacement.outpoint, 'notifier');
    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 1 }));

    world.mine(1);
    expect(await api.runScheduled()).toEqual(
      notifierRun({ watched: 1, finished: [receipt.depositAddress] })
    );
    expect(api.watched()).toEqual([]);
    world.signers.mint(replacement.outpoint);

    const later = await app.newTab();
    await later.open();
    await later.openYourDeposits();
    await expect(later.savedEntry(savedLabel(started))).toContainText('sBTC minted');
    await later.pickSavedReceipt(savedLabel(started));
    await expect(later.progress(PROGRESS.done)).toBeVisible();
    await expect(later.progress(REPLACED_PAYOUT_NOTE)).toHaveCount(0);
    await expectOnePayment(later);
  });

  test('(c) 1Click names the first payout, then its replacement: the page follows the replacement to done', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    await app.sendFromWallet();
    const original = await payOut(app, world);
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);

    const replacement = replace(world, original, true);
    expect(world.swap().destinationTxHashes).toEqual([replacement.tx.txid]);
    await app.tick();
    await expect(app.progress(PROGRESS.payoutUnconfirmed)).toBeVisible();
    await expect(app.progress(REPLACED_PAYOUT_NOTE)).toHaveCount(0);
    expectRegisteredWithEmily(world, receipt, replacement.outpoint, 'page');
    await expectOnePayment(app);

    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 1 }));
    expect(api.watched()).toEqual([receipt.depositAddress]);
    await mintToDone(app, world, replacement);
    expect(await api.runScheduled()).toEqual(
      notifierRun({ watched: 1, finished: [receipt.depositAddress] })
    );
  });

  test('(d) 1Click names only the replacement, after reporting success: no stuck wait and no second payment', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    await app.sendFromWallet();
    const original = await payOut(app, world, { reportHash: false });
    expect(world.swap().destinationTxHashes).toEqual([]);
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    expectRegisteredWithEmily(world, receipt, original.outpoint, 'page');
    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 1 }));

    const replacement = replace(world, original, true);
    await app.tick();
    await expect(app.progress(PROGRESS.payoutUnconfirmed)).toBeVisible();
    expectRegisteredWithEmily(world, receipt, replacement.outpoint, 'page');
    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 1 }));

    world.oneClick.revealPayout(world.swap());
    expect(world.swap().destinationTxHashes).toEqual([replacement.tx.txid]);
    await mintToDone(app, world, replacement);
    await expect(app.progress(REPLACED_PAYOUT_NOTE)).toHaveCount(0);
    expect(await api.runScheduled()).toEqual(
      notifierRun({ watched: 1, finished: [receipt.depositAddress] })
    );
  });

  const ENDS: { name: string; end(oneClick: OneClick, swap: Swap): void; message: string }[] = [
    {
      name: 'refunded',
      end: (oneClick, swap) => oneClick.refund(swap, 'The payout could not be delivered'),
      message: 'The swap did not complete and your funds were sent back to your refund address.',
    },
    {
      name: 'failed',
      end: (oneClick, swap) => oneClick.fail(swap),
      message:
        'The swap failed. Contact the swap provider with your swap deposit address to recover the funds.',
    },
  ];

  for (const stop of ENDS) {
    test(`(e) the payout is evicted and never replaced, then the swap is ${stop.name}: that is shown, polling and the watch end`, async ({
      app,
      world,
      api,
    }) => {
      const started = await startAwaitingFunds(app);
      const { receipt } = started;
      await app.sendFromWallet();
      await app.waitForProgress(PROGRESS.swapping);
      const swap = world.swap();
      const paid = world.payTo(receipt.depositAddress, swap.amountOut);
      await app.waitForProgress(PROGRESS.payoutUnconfirmed);
      expectRegisteredWithEmily(world, receipt, paid.outpoint, 'page');
      expect(await api.runScheduled()).toEqual(notifierRun({ watched: 1 }));

      world.treasury.evict(paid.tx.txid);
      await app.waitForProgress(PROGRESS.swapping);
      await expectOnePayment(app);
      await expect(app.page.locator('code', { hasText: paid.tx.txid })).toHaveCount(0);

      stop.end(world.oneClick, swap);
      await app.waitForProgress(stop.message);
      await expect(app.page.getByText(/payment arrived|payments arrived/)).toHaveCount(0);
      const reads = world.requestsTo('mempool', { caller: 'page' }).length;
      await app.tick();
      expect(world.requestsTo('mempool', { caller: 'page' })).toHaveLength(reads);
      expect(await api.runScheduled()).toEqual(
        notifierRun({ watched: 1, finished: [receipt.depositAddress] })
      );
      expect(api.watched()).toEqual([]);

      await app.openYourDeposits();
      await expect(app.savedEntry(savedLabel(started))).toContainText(
        stop.name === 'refunded' ? 'Refunded by the swap provider' : 'The swap failed'
      );
    });
  }
});
