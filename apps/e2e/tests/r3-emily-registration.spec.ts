import { PROGRESS, type PortageApp } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily, notifierRun } from '../src/scenario/checks.js';
import {
  FAILED_TO_LOAD,
  NET_FAILED,
  payOut,
  startAwaitingFunds,
} from '../src/scenario/journeys.js';
import { outpointKey } from '../src/world/bitcoin.js';
import { type Reply, json } from '../src/world/http.js';
import type { World } from '../src/world/world.js';

const EMILY_POST = { service: 'emily', method: 'POST', path: /^\/deposit$/ } as const;

const TRANSIENT_HEAD =
  'The sBTC signers have not been told about your Bitcoin payment yet, because their service could not be reached. This page keeps retrying.';
const REFUSED_HEAD =
  'The sBTC signers have not been told about your Bitcoin payment yet: they refused the registration. Reason:';
const REFUSED_TAIL =
  'Your BTC is safe at the deposit address and can be reclaimed after the timelock. This page keeps trying while it is open, and loading the receipt again later retries.';

function emilyPosts(world: World) {
  return world.requestsTo('emily', { method: 'POST', path: '/deposit' });
}

function registrationNotice(app: PortageApp) {
  return app.page.locator('p').filter({ hasText: 'The sBTC signers have not been told' });
}

test.describe('R3. registering the payout with Emily', () => {
  const transients: { name: string; outcome: Reply | 'network-error'; reason: string }[] = [
    {
      name: 'Emily answers 503 once',
      outcome: json({ message: 'Service Unavailable' }, 503),
      reason: 'HTTP 503 from https://sbtc-emily.com/deposit: {"message":"Service Unavailable"}',
    },
    { name: 'Emily cannot be reached once', outcome: 'network-error', reason: 'Failed to fetch' },
  ];

  for (const t of transients) {
    test(`${t.name}: a "retrying" notice, then exactly one successful registration`, async ({
      app,
      world,
      harness,
    }) => {
      harness.allowConsoleErrors(FAILED_TO_LOAD, NET_FAILED);
      const { receipt } = await startAwaitingFunds(app);
      world.addFault({ ...EMILY_POST, callers: ['page'], outcome: t.outcome, times: 1 });
      const payout = await payOut(app, world);
      await app.waitForProgress(PROGRESS.payoutUnconfirmed);
      await expect(registrationNotice(app)).toHaveText(
        `${TRANSIENT_HEAD} ${outpointKey(payout.outpoint)}: ${t.reason}`
      );
      await expect(registrationNotice(app)).toHaveAttribute('role', 'status');
      expect(world.emily.get(payout.outpoint.txid, 0)).toBeNull();

      await app.tick();
      await expect(registrationNotice(app)).toHaveCount(0);
      expect(emilyPosts(world).map(p => p.status)).toEqual([
        t.outcome === 'network-error' ? 'network-error' : 503,
        201,
      ]);
      expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page', {
        failedAttemptsFirst: 1,
      });
      world.mine(1);
      await app.waitForProgress(PROGRESS.minting);
    });
  }

  test('Emily refuses (400): a "refused" notice with the reason, retried, and the notifier keeps the watch', async ({
    app,
    world,
    api,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    const { receipt } = await startAwaitingFunds(app);
    world.addFault({
      ...EMILY_POST,
      outcome: json({ message: 'deposit amount is below the minimum' }, 400),
    });
    const payout = await payOut(app, world);
    const op = outpointKey(payout.outpoint);
    const reason = `HTTP 400 from https://sbtc-emily.com/deposit: {"message":"deposit amount is below the minimum"}`;
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    const notice = registrationNotice(app);
    await expect(notice).toHaveText(`${REFUSED_HEAD} ${op}: ${reason}. ${REFUSED_TAIL}`);
    await expect(notice).toHaveAttribute('role', 'alert');
    const first = emilyPosts(world).length;
    await app.tick();
    await app.tick();
    expect(emilyPosts(world).length).toBeGreaterThanOrEqual(first + 2);
    expect(new Set(emilyPosts(world).map(p => p.status))).toEqual(new Set([400]));
    await expect(notice).toBeVisible();

    const report = await api.runScheduled();
    expect(report).toEqual(
      notifierRun({
        watched: 1,
        errors: [
          {
            address: receipt.depositAddress,
            outpoint: op,
            message: `Registering ${op} with the sBTC API failed: ${reason}`,
          },
        ],
      })
    );
    expect(api.watched()).toEqual([receipt.depositAddress]);
    expect(world.emily.get(payout.outpoint.txid, 0)).toBeNull();

    world.clearFaults();
    expect(await api.runScheduled()).toEqual(
      notifierRun({
        watched: 1,
        notified: [{ address: receipt.depositAddress, txid: payout.outpoint.txid, vout: 0 }],
        finished: [receipt.depositAddress],
      })
    );
  });

  test('the Bitcoin API serves the wrong raw transaction: nothing reaches Emily and the notice says why', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startAwaitingFunds(app);
    world.reportDeposit();
    await app.waitForProgress(PROGRESS.swapping);
    const [evidence] = world.evidence;
    if (!evidence) throw new Error('No evidence deposit');
    const decoy = world.bitcoin.transaction(evidence.deposit.txid);
    if (!decoy) throw new Error('No evidence transaction');
    const payout = world.completeSwap();
    world.bitcoin.hexOverrides.set(payout.outpoint.txid, decoy.hex);
    const op = outpointKey(payout.outpoint);
    const reason = `Transaction data for ${op} has txid ${decoy.txid} instead`;
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    await expect(registrationNotice(app)).toHaveText(
      `${REFUSED_HEAD} ${op}: ${reason}. ${REFUSED_TAIL}`
    );
    expect(emilyPosts(world)).toEqual([]);
    expect(
      world.requestsTo('mempool', { caller: 'page', path: `/api/tx/${payout.outpoint.txid}/hex` })
        .length
    ).toBeGreaterThan(0);

    expect(await api.runScheduled()).toMatchObject({
      notified: [],
      finished: [],
      errors: [
        {
          address: receipt.depositAddress,
          outpoint: op,
          message: `Registering ${op} with the sBTC API failed: ${reason}`,
        },
      ],
    });
    expect(emilyPosts(world)).toEqual([]);
  });
});
