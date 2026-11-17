import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily, notifierRun } from '../src/scenario/checks.js';
import { FAILED_TO_LOAD, payOut, startAwaitingFunds } from '../src/scenario/journeys.js';
import type { Outpoint } from '../src/world/bitcoin.js';
import { field, json, parseJson } from '../src/world/http.js';
import type { World } from '../src/world/world.js';

const DUST = 546;
const BELOW =
  'Below the sBTC minimum, so it cannot be minted; it can be reclaimed after the timelock if it is worth more than the fee.';

function sats(n: number): string {
  return `${n.toLocaleString('en-US')} sats`;
}

function where(o: Outpoint): string {
  return `in ${o.txid}, output ${o.vout}`;
}

function emilyPostsFor(world: World): string[] {
  return world
    .requestsTo('emily', { method: 'POST', path: '/deposit' })
    .map(e =>
      String(field(e.requestBody === undefined ? null : parseJson(e.requestBody), 'bitcoinTxid'))
    );
}

async function expectPayoutShown(app: SatwayApp, amount: number, o: Outpoint) {
  await expect(app.definition('Bitcoin payout')).toHaveText(`${sats(amount)} ${where(o)}`);
}

function listedPayouts(app: SatwayApp) {
  return app.page
    .locator('dt:text-is("Bitcoin payouts") ~ dd')
    .filter({ hasText: /^[\d,]+ sats in [0-9a-f]{64}, output \d+\. / });
}

const TWO_PAYMENTS =
  '2 payments arrived at your deposit address. Each is handled on its own and listed below.';

async function expectTooSmall(app: SatwayApp, o: Outpoint) {
  await expect(
    app.page.locator('dt:text-is("Too small to mint") ~ dd').filter({ hasText: o.txid })
  ).toHaveText(`${sats(DUST)} ${where(o)}. ${BELOW}`);
}

test.describe('M10. dust and outsiders on the public Bitcoin deposit address', () => {
  test('(a) dust after the real payout: the payout is followed and registered, dust is listed as too small', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    const payout = await payOut(app, world);
    const dust = world.payTo(receipt.depositAddress, DUST);
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    await expectPayoutShown(app, payout.amountSats, payout.outpoint);
    await expectTooSmall(app, dust.outpoint);
    world.mine(1);
    await app.waitForProgress(PROGRESS.minting);
    await expectTooSmall(app, dust.outpoint);
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');
    expect(emilyPostsFor(world)).toEqual([payout.outpoint.txid]);
    expect(await api.runScheduled()).toEqual(
      notifierRun({ watched: 1, finished: [receipt.depositAddress] })
    );
    expect(emilyPostsFor(world)).toEqual([payout.outpoint.txid]);
  });

  test('(b) dust before the payout: still awaiting, the watch survives notifier runs, then the payout ends it', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    const dust = world.payTo(receipt.depositAddress, DUST);
    world.mine(1);
    await app.tick();
    await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
    await expectTooSmall(app, dust.outpoint);
    await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');
    for (let run = 0; run < 2; run++) {
      expect(await api.runScheduled()).toEqual(notifierRun({ watched: 1 }));
      expect(api.watched()).toEqual([receipt.depositAddress]);
    }
    await app.page.close();

    world.reportDeposit();
    const payout = world.completeSwap();
    world.mine(1);
    expect(await api.runScheduled()).toEqual(
      notifierRun({
        watched: 1,
        notified: [{ address: receipt.depositAddress, txid: payout.outpoint.txid, vout: 0 }],
        finished: [receipt.depositAddress],
      })
    );
    expect(api.watched()).toEqual([]);
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'notifier');
    expect(emilyPostsFor(world)).toEqual([payout.outpoint.txid]);
  });

  for (const statusDown of [false, true]) {
    test(`(c) thirty dust payments bury the payout${statusDown ? ', with the status call failing' : ''}: it is found by paging the address history`, async ({
      app,
      world,
      harness,
    }) => {
      harness.allowConsoleErrors(FAILED_TO_LOAD);
      const { receipt } = await startAwaitingFunds(app);
      const payout = await payOut(app, world);
      for (let i = 0; i < 30; i++) world.payTo(receipt.depositAddress, DUST);
      world.mine(1);
      if (statusDown) {
        world.addFault({
          service: 'oneclick',
          path: /^\/v0\/status$/,
          outcome: json({ message: 'down' }, 500),
        });
      }
      const before = world.log.length;
      await app.waitForProgress(PROGRESS.minting);
      await expectPayoutShown(app, payout.amountSats, payout.outpoint);
      const paths = world.log
        .slice(before)
        .filter(e => e.caller === 'page' && e.service === 'mempool')
        .map(e => new URL(e.url).pathname);
      expect(paths).not.toContain(`/api/tx/${payout.outpoint.txid}`);
      expect(paths).toContain(`/api/address/${receipt.depositAddress}/txs/chain`);
      expect(
        paths.some(p => p.startsWith(`/api/address/${receipt.depositAddress}/txs/chain/`))
      ).toBe(true);
      expect(emilyPostsFor(world)).toEqual([payout.outpoint.txid]);
      await expect(
        app.page.locator('dt:text-is("Too small to mint") ~ dd').filter({ hasText: BELOW })
      ).toHaveCount(30);
    });
  }

  test('(d) two payments and no hash: both are this deposit’s, both are registered, and it is done only when both are minted', async ({
    app,
    world,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    const payout = await payOut(app, world, { reportHash: false });
    const twin = world.payTo(receipt.depositAddress, payout.amountSats);
    await app.waitForProgress(`${TWO_PAYMENTS} ${PROGRESS.payoutUnconfirmed}`);
    await app.expectRouteAt('Bitcoin deposit', 'In progress');
    await expect(listedPayouts(app)).toHaveCount(2);
    await expect(listedPayouts(app).filter({ hasText: payout.outpoint.txid })).toHaveText(
      `${sats(payout.amountSats)} ${where(payout.outpoint)}. It is registered with the sBTC signers (status: pending).`
    );
    expect(new Set(emilyPostsFor(world))).toEqual(
      new Set([payout.outpoint.txid, twin.outpoint.txid])
    );
    expect(world.emily.get(twin.outpoint.txid, 0)?.status).toBe('pending');

    world.oneClick.revealPayout(payout.swap);
    world.mine(1);
    world.signers.mint(payout.outpoint);
    await app.waitForProgress(`${TWO_PAYMENTS} ${PROGRESS.done}`);
    await expect(app.page.getByRole('heading', { name: 'Deposit complete' })).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
    await expect(listedPayouts(app).filter({ hasText: payout.outpoint.txid })).toContainText(
      'sBTC has been minted for it.'
    );
    world.signers.mint(twin.outpoint);
    await app.waitForProgress(
      'sBTC has been minted for each of the 2 payments that arrived at your deposit address.'
    );
    await expect(app.page.getByRole('heading', { name: 'Deposit complete' })).toBeVisible();
    expect(emilyPostsFor(world)).toHaveLength(2);
  });

  test('(e) an outsider payment arrives first: it is listed and registered beside the real payout', async ({
    app,
    world,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    world.reportDeposit();
    await app.waitForProgress(PROGRESS.swapping);
    const outsider = world.payTo(receipt.depositAddress, world.swap().amountOut + 1_000);
    world.mine(1);
    const payout = world.completeSwap();
    await app.waitForProgress(`${TWO_PAYMENTS} ${PROGRESS.payoutUnconfirmed}`);
    await expect(listedPayouts(app)).toHaveCount(2);
    await expect(listedPayouts(app).first()).toContainText(outsider.outpoint.txid);
    await expect(app.page.getByText(/does not pay your deposit address/)).toHaveCount(0);
    world.mine(1);
    await app.waitForProgress(`${TWO_PAYMENTS} ${PROGRESS.minting}`);
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');
    world.signers.mint(outsider.outpoint);
    world.signers.mint(payout.outpoint);
    await app.waitForProgress(
      'sBTC has been minted for each of the 2 payments that arrived at your deposit address.'
    );
    await expect(app.page.getByRole('heading', { name: 'Deposit complete' })).toBeVisible();
  });

  test('(f) the swap provider names a payout that does not pay the deposit address: a warning, and nothing is adopted', async ({
    app,
    world,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    world.reportDeposit();
    await app.waitForProgress(PROGRESS.swapping);
    const elsewhere = world.payTo('bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys', 40_000);
    world.oneClick.succeed(world.swap(), elsewhere.tx.txid, 40_000);
    await app.waitForProgress(PROGRESS.awaitingPayout);
    await expect(
      app.page.getByText(/^The swap provider reports its Bitcoin payout in transaction/)
    ).toContainText(
      `transaction ${elsewhere.tx.txid}, which does not pay your deposit address. This page follows only payments to your deposit address. If none arrives, contact the swap provider with your swap deposit address.`
    );
    await expect(app.definition('Bitcoin payout')).toHaveCount(0);
    expect(emilyPostsFor(world)).toEqual([]);
    expect(receipt.depositAddress).not.toBe('bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys');
  });
});
