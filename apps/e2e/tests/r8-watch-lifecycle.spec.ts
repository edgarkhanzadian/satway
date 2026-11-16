import { buildDepositAddress } from '@satway/core';

import { PROGRESS } from '../src/app/satway-app.js';
import { API_ORIGIN, APP_ORIGIN } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily, notifierRun } from '../src/scenario/checks.js';
import { FAILED_TO_LOAD, startDeposit } from '../src/scenario/journeys.js';
import type { ApiWorker } from '../src/worker/worker.js';
import { outpointKey } from '../src/world/bitcoin.js';
import { field, json, notFound, parseJson } from '../src/world/http.js';
import { bitcoinKey, stacksAddressOf } from '../src/world/keys.js';
import type { World } from '../src/world/world.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STATUS = /^\/v0\/status$/;

async function anotherUsersWatch(world: World, api: ApiWorker) {
  const owner = bitcoinKey(world.rng);
  const deposit = buildDepositAddress({
    stacksAddress: stacksAddressOf(owner),
    reclaimPublicKey: owner.xOnly,
    signersPublicKey: world.signer.xOnly,
    maxSignerFeeSats: 80_000,
    reclaimLockBlocks: 950,
  });
  const swap = world.liveSwapFor(deposit.address);
  const response = await api.dispatch(
    new Request(`${API_ORIGIN}/deposits`, {
      method: 'POST',
      headers: { origin: APP_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        depositScript: deposit.depositScript,
        reclaimScript: deposit.reclaimScript,
        swapDepositAddress: swap.depositAddress,
      }),
    })
  );
  expect(response.status).toBe(201);
  return { ...deposit, swapDepositAddress: swap.depositAddress };
}

function sortedReport(report: unknown): unknown {
  const out: Record<string, unknown> = {};
  for (const key of ['watched', 'notified', 'finished', 'expired', 'errors']) {
    const value = field(report, key);
    const list: unknown[] | null = Array.isArray(value) ? value : null;
    out[key] = list
      ? [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : value;
  }
  return out;
}

function deadlineOf(api: ApiWorker, address: string): number {
  return Date.parse(String(field(api.watch(address), 'deadline')));
}

test.describe('R8. the Worker watch for a deposit whose tab was closed', () => {
  test('closed right after Continue: an empty chain keeps the watch, the payout ends it', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startDeposit(app);
    await app.page.close();
    expect(api.watch(receipt.depositAddress)).toEqual({
      depositScript: receipt.depositScript,
      reclaimScript: receipt.reclaimScript,
      createdAt: expect.any(String),
      swapDepositAddress: receipt.quoteResponse.quote.depositAddress,
      deadline: receipt.quoteResponse.quoteRequest.deadline,
      registered: [],
    });
    expect(api.kv.metadataOf(`dep:${receipt.depositAddress}`)).toBeUndefined();
    for (let run = 0; run < 2; run++) {
      expect(await api.runScheduled()).toEqual(notifierRun({ watched: 1 }));
      expect(api.watched()).toEqual([receipt.depositAddress]);
    }
    expect(world.requestsTo('emily', { method: 'POST' })).toEqual([]);

    world.reportDeposit();
    const payout = world.completeSwap();
    expect(await api.runScheduled()).toEqual(
      notifierRun({
        watched: 1,
        notified: [{ address: receipt.depositAddress, txid: payout.outpoint.txid, vout: 0 }],
        finished: [receipt.depositAddress],
      })
    );
    expect(api.watched()).toEqual([]);
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'notifier');
    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 0 }));
  });

  test('an abandoned watch ends 24 hours after the quote deadline; the 14-day KV TTL stays as the backstop', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startDeposit(app);
    await app.page.close();
    const key = `dep:${receipt.depositAddress}`;
    expect(Math.abs((api.kv.expiresInMs(key) ?? 0) - 14 * DAY_MS)).toBeLessThan(10_000);
    const deadline = deadlineOf(api, receipt.depositAddress);
    expect(deadline).toBe(Date.parse(String(receipt.quoteResponse.quoteRequest.deadline)));

    world.advanceClock(deadline + DAY_MS - world.now().getTime() - 60_000);
    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 1 }));
    expect(api.watched()).toEqual([receipt.depositAddress]);

    world.advanceClock(2 * 60_000);
    expect(await api.runScheduled()).toEqual(
      notifierRun({ watched: 1, expired: [receipt.depositAddress] })
    );
    expect(api.kv.operations).toContain(`delete ${key}`);
    expect(api.kv.operations).not.toContain(`expired ${key}`);
    expect(api.watched()).toEqual([]);
    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 0 }));
  });

  test('a failing registration for one address does not block another address', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startDeposit(app);
    await app.page.close();
    const ownSwap = receipt.quoteResponse.quote.depositAddress;
    const other = await anotherUsersWatch(world, api);
    world.reportDeposit({ depositAddress: ownSwap });
    const payout = world.completeSwap({ depositAddress: ownSwap });
    world.reportDeposit({ depositAddress: other.swapDepositAddress });
    const theirs = world.completeSwap({ depositAddress: other.swapDepositAddress });
    world.addFault({
      service: 'emily',
      method: 'POST',
      bodyIncludes: payout.outpoint.txid,
      outcome: json({ message: 'Service Unavailable' }, 503),
    });
    const ours = outpointKey(payout.outpoint);
    const report = await api.runScheduled();
    expect(report).toEqual(
      notifierRun({
        watched: 2,
        notified: [expect.anything()],
        finished: [expect.anything()],
        errors: [expect.anything()],
      })
    );
    expect(sortedReport(report)).toEqual(
      sortedReport({
        watched: 2,
        notified: [{ address: other.address, txid: theirs.outpoint.txid, vout: 0 }],
        finished: [other.address],
        expired: [],
        errors: [
          {
            address: receipt.depositAddress,
            outpoint: ours,
            message: `Registering ${ours} with the sBTC API failed: HTTP 503 from https://sbtc-emily.com/deposit: {"message":"Service Unavailable"}`,
          },
        ],
      })
    );
    expect(api.watched()).toEqual([receipt.depositAddress]);
    expect(world.emily.get(theirs.outpoint.txid, 0)?.status).toBe('pending');

    world.clearFaults();
    expect(await api.runScheduled()).toEqual(
      notifierRun({
        watched: 1,
        notified: [{ address: receipt.depositAddress, txid: payout.outpoint.txid, vout: 0 }],
        finished: [receipt.depositAddress],
      })
    );
  });

  test('1Click does not know the new swap yet: the first registration is refused, the page retries and the watch lands in KV', async ({
    app,
    world,
    api,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD);
    world.addFault({
      service: 'oneclick',
      method: 'GET',
      path: STATUS,
      callers: ['worker'],
      times: 1,
      outcome: notFound('Deposit address not found'),
      label: 'status lags behind the quote',
    });
    const { receipt } = await startDeposit(app);
    expect(
      api.depositPosts().map(r => [r.status, field(parseJson(r.responseBody), 'code')])
    ).toEqual([[400, 'unknown-swap']]);
    expect(api.watched()).toEqual([]);
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await app.waitForProgress(PROGRESS.awaitingFunds);

    await app.fastForward(2_000);
    await expect.poll(() => api.depositPosts().map(r => r.status)).toEqual([400, 201]);
    expect(api.watched()).toEqual([receipt.depositAddress]);
    expect(field(api.watch(receipt.depositAddress), 'swapDepositAddress')).toBe(
      receipt.quoteResponse.quote.depositAddress
    );
    await app.fastForward(30_000);
    expect(api.depositPosts()).toHaveLength(2);

    await app.page.close();
    world.reportDeposit();
    const payout = world.completeSwap();
    expect(await api.runScheduled()).toEqual(
      notifierRun({
        watched: 1,
        notified: [{ address: receipt.depositAddress, txid: payout.outpoint.txid, vout: 0 }],
        finished: [receipt.depositAddress],
      })
    );
    expectRegisteredWithEmily(world, receipt, payout.outpoint, 'notifier');
  });

  test('when one of two fresh outputs on an address fails to register, the notifier keeps watching and registers it on the next run', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startDeposit(app);
    await app.page.close();
    world.reportDeposit();
    const payout = world.completeSwap();
    const outsider = world.payTo(receipt.depositAddress, 50_000);
    world.addFault({
      service: 'emily',
      method: 'POST',
      bodyIncludes: payout.outpoint.txid,
      outcome: json({ message: 'Service Unavailable' }, 503),
    });
    const report = await api.runScheduled();
    expect(field(report, 'notified')).toEqual([
      { address: receipt.depositAddress, txid: outsider.outpoint.txid, vout: 0 },
    ]);
    expect(field(report, 'errors')).toEqual([
      expect.objectContaining({ outpoint: outpointKey(payout.outpoint) }),
    ]);
    expect(api.watched()).toEqual([receipt.depositAddress]);
    world.clearFaults();
    await api.runScheduled();
    expect(world.emily.get(payout.outpoint.txid, 0)?.status).toBe('pending');
  });
});
