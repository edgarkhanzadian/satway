import { PROGRESS, type SatwayApp, type StartedDeposit } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  FAILED_TO_LOAD,
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
  reviewReclaim,
} from '../src/scenario/reclaim.js';
import { outpointKey } from '../src/world/bitcoin.js';
import { json } from '../src/world/http.js';
import type { PayoutResult, World } from '../src/world/world.js';

const FEE_SATS = Math.ceil(126 * 4);

async function toReclaimable(
  app: SatwayApp,
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

async function openInRecover(app: SatwayApp, started: StartedDeposit): Promise<void> {
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

  test('after the user reclaims, a still-pending Emily record does not make the page say the signers took the deposit in: stage reclaimed, terminal', async ({
    app,
    world,
    wallets,
  }) => {
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
  });

  test('the fee-rate endpoint is down: a clear error, nothing is signed or broadcast, and a retry works', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    const { started, payout } = await toReclaimable(app, world);
    await openInRecover(app, started);
    world.addFault({
      service: 'mempool',
      path: /^\/api\/v1\/fees\/recommended$/,
      outcome: json({ halfHourFee: 4 }, 503),
    });
    await reclaimFromRecover(app, wallets.stacks.account.paymentAddress);
    await expect(app.sendError).toHaveText(
      /^Could not read the current Bitcoin fee rate \(.+\), so no reclaim was built and nothing was signed or sent\. Try again in a moment\.$/
    );
    expect(wallets.stacks.behaviour.calls('signPsbt')).toEqual([]);
    expect(world.bitcoin.broadcasts).toEqual([]);
    world.clearFaults();
    await reclaimControls(app).button.click();
    await reclaimControls(app).confirm.click();
    await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
    expect(wallets.stacks.behaviour.calls('signPsbt')).toHaveLength(1);
    expect(world.bitcoin.isSpent(payout.outpoint)).toBe(true);
  });

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
    await expect(reclaimControls(app).confirm).toBeEnabled();

    await reclaimControls(app).confirm.click();
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

  test('the fee rate, the fee and what is left are shown before the wallet is asked to sign', async ({
    app,
    world,
    wallets,
  }) => {
    const { started, payout } = await toReclaimable(app, world);
    await openInRecover(app, started);
    const to = wallets.stacks.account.paymentAddress;
    const review = await reviewReclaim(app, to);
    expect(review).toEqual({
      feeRate: '4 sat/vB',
      fee: `${FEE_SATS.toLocaleString('en-US')} sats`,
      receive: `${(payout.amountSats - FEE_SATS).toLocaleString('en-US')} sats at ${to}`,
    });
    expect(wallets.stacks.behaviour.calls('signPsbt')).toEqual([]);
    await app.page.getByRole('button', { name: 'Cancel' }).click();
    await expect(reclaimControls(app).confirm).toHaveCount(0);
    expect(wallets.stacks.behaviour.calls('signPsbt')).toEqual([]);

    await reclaimControls(app).button.click();
    await reclaimControls(app).confirm.click();
    await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
    expectReclaimPsbt(wallets.stacks, {
      outpoint: payout.outpoint,
      amountSats: payout.amountSats,
      to,
      feeSats: FEE_SATS,
    });
  });

  test('a fee rate above the cap is refused before anything is built or signed', async ({
    app,
    world,
    wallets,
  }) => {
    const { started, payout } = await toReclaimable(app, world);
    await openInRecover(app, started);
    world.bitcoin.feeRates.halfHourFee = 501;
    await reclaimFromRecover(app, wallets.stacks.account.paymentAddress);
    await expect(app.sendError).toHaveText(
      'The current Bitcoin fee rate is 501 sat/vB, above the 500 sat/vB this page pays for a reclaim, so no reclaim was built and nothing was signed or sent. Your BTC stays reclaimable: try again when fees are lower.'
    );
    await expect(reclaimControls(app).confirm).toHaveCount(0);
    expect(wallets.stacks.behaviour.calls('signPsbt')).toEqual([]);
    expect(world.bitcoin.broadcasts).toEqual([]);
    expect(world.bitcoin.isSpent(payout.outpoint)).toBe(false);

    world.bitcoin.feeRates.halfHourFee = 500;
    await reclaimFromRecover(app, wallets.stacks.account.paymentAddress);
    await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
  });

  test('the fee-rate endpoint cannot be reached: the reclaim stops before signing and says why', async ({
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
    await expect(app.sendError).toHaveText(
      'Could not read the current Bitcoin fee rate (Failed to fetch), so no reclaim was built and nothing was signed or sent. Try again in a moment.'
    );
    expect(wallets.stacks.behaviour.calls('signPsbt')).toEqual([]);
    expect(world.bitcoin.broadcasts).toEqual([]);
    expect(world.requestsTo('mempool', { path: '/api/v1/fees/recommended' })).toHaveLength(1);
  });
});
