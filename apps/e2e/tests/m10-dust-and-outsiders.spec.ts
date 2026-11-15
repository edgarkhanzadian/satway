import { PROGRESS, type PortageApp } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily } from '../src/scenario/checks.js';
import { FAILED_TO_LOAD, payOut, startAwaitingFunds } from '../src/scenario/journeys.js';
import type { Outpoint } from '../src/world/bitcoin.js';
import { field, json, parseJson } from '../src/world/http.js';
import type { World } from '../src/world/world.js';

const DUST = 546;
const BELOW =
  'Below the sBTC minimum, so it cannot be minted; it can be reclaimed after the timelock if it is worth more than the fee.';
const BY_AMOUNT =
  'Matched by its amount, because the swap provider has not reported its transaction yet.';

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

async function expectPayoutShown(app: PortageApp, amount: number, o: Outpoint, byAmount = false) {
  await expect(app.definition('Bitcoin payout')).toHaveText(
    `${sats(amount)} ${where(o)}${byAmount ? `. ${BY_AMOUNT}` : ''}`
  );
}

async function expectTooSmall(app: PortageApp, o: Outpoint) {
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
    expect(await api.runScheduled()).toEqual({
      watched: 1,
      notified: [],
      finished: [receipt.depositAddress],
      errors: [],
    });
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
      expect(await api.runScheduled()).toEqual({
        watched: 1,
        notified: [],
        finished: [],
        errors: [],
      });
      expect(api.watched()).toEqual([receipt.depositAddress]);
    }
    await app.page.close();

    world.reportDeposit();
    const payout = world.completeSwap();
    expect(await api.runScheduled()).toEqual({
      watched: 1,
      notified: [{ address: receipt.depositAddress, txid: payout.outpoint.txid, vout: 0 }],
      finished: [receipt.depositAddress],
      errors: [],
    });
    expect(api.watched()).toEqual([]);
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'notifier');
    expect(emilyPostsFor(world)).toEqual([payout.outpoint.txid]);
  });

  test('(c) thirty dust payments bury the payout: found by the 1Click hash without reading history', async ({
    app,
    world,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    const payout = await payOut(app, world);
    for (let i = 0; i < 30; i++) world.payTo(receipt.depositAddress, DUST);
    world.mine(1);
    const before = world.log.length;
    await app.waitForProgress(PROGRESS.minting);
    await expectPayoutShown(app, payout.amountSats, payout.outpoint);
    const read = world.log
      .slice(before)
      .filter(e => e.caller === 'page' && e.service === 'mempool');
    const paths = read.map(e => new URL(e.url).pathname);
    expect(paths).toContain(`/api/tx/${payout.outpoint.txid}`);
    expect(paths.filter(p => p.includes('/txs/chain'))).toEqual([]);
    expect(emilyPostsFor(world)).toEqual([payout.outpoint.txid]);
    await expect(
      app.page.locator('dt:text-is("Too small to mint") ~ dd').filter({ hasText: BELOW })
    ).toHaveCount(30);
  });

  test('(c) thirty dust payments bury the payout: with the status call failing it is found by paging history', async ({
    app,
    world,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    const { receipt } = await startAwaitingFunds(app);
    const payout = await payOut(app, world);
    for (let i = 0; i < 30; i++) world.payTo(receipt.depositAddress, DUST);
    world.mine(1);
    world.addFault({
      service: 'oneclick',
      path: /^\/v0\/status$/,
      outcome: json({ message: 'down' }, 500),
    });
    const before = world.log.length;
    await app.waitForProgress(PROGRESS.minting);
    await expectPayoutShown(app, payout.amountSats, payout.outpoint, true);
    const paths = world.log
      .slice(before)
      .filter(e => e.caller === 'page' && e.service === 'mempool')
      .map(e => new URL(e.url).pathname);
    expect(paths).not.toContain(`/api/tx/${payout.outpoint.txid}`);
    expect(paths).toContain(`/api/address/${receipt.depositAddress}/txs/chain`);
    expect(paths.some(p => p.startsWith(`/api/address/${receipt.depositAddress}/txs/chain/`))).toBe(
      true
    );
    expect(emilyPostsFor(world)).toEqual([payout.outpoint.txid]);
  });

  test('(d) two plausible payouts and no hash: both are registered, then the hash picks the right one', async ({
    app,
    world,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    const payout = await payOut(app, world, { reportHash: false });
    const twin = world.payTo(receipt.depositAddress, payout.amountSats);
    const ambiguous = `2 payments that could each be this deposit arrived at your deposit address, and the swap provider has not said which one is yours. Each is being registered with the sBTC signers; they are listed below.`;
    await app.waitForProgress(ambiguous);
    await app.expectRouteAt('Bitcoin deposit', 'In progress');
    const possible = app.page
      .locator('dt:text-is("Possible payouts") ~ dd')
      .filter({ hasText: /^[\d,]+ sats in [0-9a-f]{64}, output \d+$/ });
    await expect(possible).toHaveCount(2);
    await expect(possible.filter({ hasText: payout.outpoint.txid })).toHaveText(
      `${sats(payout.amountSats)} ${where(payout.outpoint)}`
    );
    await expect(possible.filter({ hasText: twin.outpoint.txid })).toHaveText(
      `${sats(payout.amountSats)} ${where(twin.outpoint)}`
    );
    expect(new Set(emilyPostsFor(world))).toEqual(
      new Set([payout.outpoint.txid, twin.outpoint.txid])
    );
    expect(world.emily.get(twin.outpoint.txid, 0)?.status).toBe('pending');

    world.oneClick.revealPayout(payout.swap);
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    await expectPayoutShown(app, payout.amountSats, payout.outpoint);
    await expect(app.definition('Other payments')).toHaveText(
      `Another payment of ${sats(payout.amountSats)} also arrived at this address ${where(twin.outpoint)}. It is registered with the sBTC signers too (status: pending).`
    );
    await expect(possible).toHaveCount(0);
    expect(emilyPostsFor(world)).toHaveLength(2);
  });

  test('(e) an outsider payment in the payout range and the real one with its hash: the real one is selected', async ({
    app,
    world,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    world.reportDeposit();
    await app.waitForProgress(PROGRESS.swapping);
    const outsider = world.payTo(receipt.depositAddress, world.swap().amountOut + 1_000);
    world.mine(1);
    const payout = world.completeSwap();
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    await expectPayoutShown(app, payout.amountSats, payout.outpoint);
    await expect(app.definition('Other payments')).toContainText(
      `Another payment of ${sats(world.swap().amountOut + 1_000)} also arrived at this address ${where(outsider.outpoint)}.`
    );
    world.mine(1);
    await app.waitForProgress(PROGRESS.minting);
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');
    world.signers.mint(payout.outpoint);
    await app.waitForProgress(PROGRESS.done);
    await app.expectComplete();
  });
});
