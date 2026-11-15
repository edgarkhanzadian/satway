import { PROGRESS, type PortageApp, type StartedDeposit } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  NET_FAILED,
  savedLabel,
  startAwaitingFunds,
  toPayoutConfirmed,
} from '../src/scenario/journeys.js';
import {
  RECLAIM_COPY,
  expectNoReclaimOffered,
  expectReclaimPsbt,
  reclaimControls,
  reclaimFromRecover,
} from '../src/scenario/reclaim.js';
import { outpointKey } from '../src/world/bitcoin.js';
import type { PayoutResult, World } from '../src/world/world.js';

const FEE_SATS = Math.ceil(126 * 4);

async function toReclaimable(
  app: PortageApp,
  world: World
): Promise<{ started: StartedDeposit; payout: PayoutResult }> {
  const started = await startAwaitingFunds(app);
  const payout = await toPayoutConfirmed(app, world);
  await expect(app.definition('Reclaim available')).toHaveText(
    'in about 949 Bitcoin blocks, if the deposit is never minted'
  );
  world.mine(947);
  await app.tick();
  await expect(app.definition('Reclaim available')).toHaveText(
    'in about 2 Bitcoin blocks, if the deposit is never minted'
  );
  await expect(app.progress(PROGRESS.minting)).toBeVisible();
  world.mine(1);
  await app.tick();
  await expect(app.definition('Reclaim available')).toHaveText(
    'in about 1 Bitcoin blocks, if the deposit is never minted'
  );
  world.mine(1);
  await app.waitForProgress(RECLAIM_COPY.signersMayMint);
  await expect(app.definition('Reclaim available')).toHaveText('now, from the Recover tab');
  await expect(app.stop('Bitcoin deposit')).toHaveAttribute('data-status', 'failed');
  await expect(app.stop('Bitcoin deposit')).toContainText('Stopped here');
  expect(world.emily.get(payout.outpoint.txid, 0)?.status).toBe('pending');
  return { started, payout };
}

async function openInRecover(app: PortageApp, started: StartedDeposit): Promise<void> {
  await app.openRecover();
  await app.uploadReceipt(started.receiptPath);
  await expect(
    app.page.getByText(started.receipt.reclaimKeyAddress, { exact: true })
  ).toBeVisible();
}

test.describe('R4. the mint never happens, so the user reclaims after the timelock', () => {
  test('countdown, then a reclaim of exactly the payout that the Bitcoin world accepts', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    const payout = await toPayoutConfirmed(app, world);
    await expect(app.definition('Reclaim available')).toHaveText(
      'in about 949 Bitcoin blocks, if the deposit is never minted'
    );
    await app.openRecover();
    await app.pickSavedReceipt(savedLabel(started));
    await expect(app.progress(PROGRESS.minting)).toBeVisible();
    await expectNoReclaimOffered(app);
    await app.followDeposit();
    await app.waitForProgress(PROGRESS.minting);

    world.mine(947);
    await app.tick();
    await expect(app.definition('Reclaim available')).toHaveText(
      'in about 2 Bitcoin blocks, if the deposit is never minted'
    );
    await openInRecover(app, started);
    await expectNoReclaimOffered(app);
    expect(world.bitcoin.broadcasts).toEqual([]);
    await app.followDeposit();
    world.mine(2);
    await app.waitForProgress(RECLAIM_COPY.signersMayMint);
    await expect(app.definition('Reclaim available')).toHaveText('now, from the Recover tab');

    await openInRecover(app, started);
    await expect(app.progress(RECLAIM_COPY.signersMayMint)).toBeVisible();
    const controls = reclaimControls(app);
    await expect(controls.output).toHaveValue(outpointKey(payout.outpoint));
    await expect(controls.output.locator('option:checked')).toHaveText(
      `${payout.amountSats.toLocaleString('en-US')} sats, ${outpointKey(payout.outpoint)}: reclaimable now`
    );
    const to = wallets.stacks.account.paymentAddress;
    await reclaimFromRecover(app, to);
    await expect(
      app
        .progress(/^Reclaim sent for /)
        .or(app.sendError)
        .first()
    ).toBeVisible();
    await expect(app.sendError).toHaveCount(0);
    const [broadcast] = world.bitcoin.broadcasts;
    const reclaimTx = world.bitcoin.allTransactions().find(t => t.hex === broadcast);
    if (!reclaimTx)
      throw new Error(`The world refused the reclaim: ${JSON.stringify(world.bitcoin.rejected)}`);
    await expect(
      app.progress(
        `Reclaim sent for ${outpointKey(payout.outpoint)}. Transaction ${reclaimTx.txid}.`
      )
    ).toBeVisible();
    expectReclaimPsbt(wallets.stacks, {
      outpoint: payout.outpoint,
      amountSats: payout.amountSats,
      to,
      feeSats: FEE_SATS,
    });
    expect(world.bitcoin.broadcasts).toHaveLength(1);
    expect(world.bitcoin.rejected).toEqual([]);
    expect(reclaimTx.inputs.map(i => ({ txid: i.txid, vout: i.vout }))).toEqual([payout.outpoint]);
    expect(world.bitcoin.isSpent(payout.outpoint)).toBe(true);

    world.mine(1);
    expect(world.bitcoin.transaction(reclaimTx.txid)?.height).toBe(world.bitcoin.tip.height);
    await app.uploadReceipt(started.receiptPath);
    await expect(app.page.getByText(RECLAIM_COPY.nothingLeft, { exact: true })).toBeVisible();
    await expectNoReclaimOffered(app);
  });

  test.fail(
    'APP ISSUE: after the user reclaims, a still-pending Emily record makes the page say the signers took the deposit in and keep following it (correct: stage reclaimed, terminal)',
    async ({ app, world, wallets }) => {
      const { started } = await toReclaimable(app, world);
      await openInRecover(app, started);
      await reclaimFromRecover(app, wallets.stacks.account.paymentAddress);
      await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
      world.mine(1);
      await app.uploadReceipt(started.receiptPath);
      await expect(app.page.getByText(RECLAIM_COPY.nothingLeft, { exact: true })).toBeVisible();
      await expect(app.progress(RECLAIM_COPY.reclaimed)).toBeVisible({ timeout: 1_000 });
      await expect(app.progress(PROGRESS.mintingSwept)).toHaveCount(0);
      await expect(app.page.getByRole('button', { name: 'Follow this deposit' })).toHaveCount(0);
    }
  );

  test('the user rejects the PSBT in the wallet: nothing is broadcast and a retry works', async ({
    app,
    world,
    wallets,
  }) => {
    const { started, payout } = await toReclaimable(app, world);
    await openInRecover(app, started);
    wallets.stacks.behaviour.reject('signPsbt', {
      code: 4001,
      message: 'User rejected the request.',
    });
    const to = wallets.stacks.account.paymentAddress;
    await reclaimFromRecover(app, to);
    await expect(app.sendError).toHaveText('User rejected the request.');
    expect(world.bitcoin.broadcasts).toEqual([]);
    expect(world.bitcoin.isSpent(payout.outpoint)).toBe(false);
    await expect(reclaimControls(app).button).toBeEnabled();

    await reclaimControls(app).button.click();
    await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
    expect(wallets.stacks.behaviour.calls('signPsbt')).toHaveLength(2);
    expect(world.bitcoin.broadcasts).toHaveLength(1);
    expect(world.bitcoin.isSpent(payout.outpoint)).toBe(true);
  });

  test('the signers sweep the output between "reclaimable" and the click: already spent, then minted', async ({
    app,
    world,
    wallets,
  }) => {
    const { started, payout } = await toReclaimable(app, world);
    await openInRecover(app, started);
    await expect(reclaimControls(app).output).toHaveValue(outpointKey(payout.outpoint));
    world.signers.accept(payout.outpoint);
    world.signers.sweep(payout.outpoint);
    await reclaimFromRecover(app, wallets.stacks.account.paymentAddress);
    await expect(app.sendError).toHaveText(RECLAIM_COPY.alreadySpent);
    expect(wallets.stacks.behaviour.calls('signPsbt')).toEqual([]);
    expect(world.bitcoin.broadcasts).toEqual([]);

    world.mine(1);
    world.signers.confirm(payout.outpoint);
    await app.uploadReceipt(started.receiptPath);
    await expect(app.progress(PROGRESS.done)).toBeVisible();
    await expectNoReclaimOffered(app);
  });

  test('the fee-rate endpoint is down: the reclaim stops before signing', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(NET_FAILED);
    const { started } = await toReclaimable(app, world);
    await openInRecover(app, started);
    world.addFault({
      service: 'mempool',
      path: /^\/api\/v1\/fees\/recommended$/,
      outcome: 'network-error',
    });
    await reclaimFromRecover(app, wallets.stacks.account.paymentAddress);
    await expect(app.sendError).toHaveText('Failed to fetch');
    expect(wallets.stacks.behaviour.calls('signPsbt')).toEqual([]);
    expect(world.bitcoin.broadcasts).toEqual([]);
    expect(world.requestsTo('mempool', { path: '/api/v1/fees/recommended' })).toHaveLength(1);
  });
});
