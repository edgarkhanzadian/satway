import { PROGRESS } from '../src/app/satway-app.js';
import { WITHDRAW_PROGRESS } from '../src/app/withdraw-app.js';
import { POLL_INTERVAL_MS } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';
import { REFUSED, REGISTRATION_COPY, startAwaitingFunds } from '../src/scenario/journeys.js';
import { startWithdrawal } from '../src/scenario/withdrawal.js';
import type { World } from '../src/world/world.js';

function pageReadsOf(world: World, from: number, needle: string): number {
  return world.log.slice(from).filter(e => e.caller === 'page' && e.url.includes(needle)).length;
}

test.describe('X11. tracking keeps running on the other tab', () => {
  test('a hidden deposit keeps polling and retries its registration while the Withdraw tab is open', async ({
    app,
    world,
    harness,
    api,
  }) => {
    harness.allowConsoleErrors(REFUSED);
    harness.backendDown({ method: 'POST', path: /^\/deposits$/, times: 1 });
    const started = await startAwaitingFunds(app);
    await expect(app.progress(REGISTRATION_COPY.unreachable)).toBeVisible();
    await app.page.getByRole('button', { name: 'Hide', exact: true }).click();
    await app.openTab('Withdraw');
    await app.harnessIdle();
    const before = world.log.length;
    expect(api.watched()).toEqual([]);

    await app.fastForward(POLL_INTERVAL_MS);
    expect(api.watched()).toEqual([started.receipt.depositAddress]);
    world.reportDeposit();
    await app.fastForward(POLL_INTERVAL_MS);
    expect(pageReadsOf(world, before, started.receipt.depositAddress)).toBeGreaterThan(0);

    await app.openTab('Deposit');
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toHaveCount(0);
    await app.page.getByRole('button', { name: 'Show progress', exact: true }).click();
    await expect(app.progress(PROGRESS.swapping)).toBeVisible();
    await expect(app.progress(REGISTRATION_COPY.closable)).toBeVisible();
  });

  test('an active withdrawal keeps polling while the Deposit tab is open', async ({
    app,
    world,
    wallets,
  }) => {
    const { withdraw, started } = await startWithdrawal(app, world, wallets);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    const txid = started.receipt.stacksTxid ?? 'missing';
    await app.openTab('Deposit');
    await app.harnessIdle();
    const before = world.log.length;
    world.withdrawals.confirmRequest();
    await app.fastForward(POLL_INTERVAL_MS);
    await app.fastForward(POLL_INTERVAL_MS);
    expect(pageReadsOf(world, before, txid)).toBeGreaterThan(0);

    const reads = world.log.length;
    await app.openTab('Withdraw');
    await expect(app.progress(WITHDRAW_PROGRESS.awaitingSigners)).toBeVisible();
    await app.harnessIdle();
    expect(pageReadsOf(world, reads, txid)).toBe(0);
  });
});
