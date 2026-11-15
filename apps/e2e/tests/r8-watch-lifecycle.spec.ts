import { buildDepositAddress } from '@portage/core';

import { API_ORIGIN, APP_ORIGIN } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily } from '../src/scenario/checks.js';
import { startDeposit } from '../src/scenario/journeys.js';
import type { ApiWorker } from '../src/worker/worker.js';
import { outpointKey } from '../src/world/bitcoin.js';
import { field, json } from '../src/world/http.js';
import { bitcoinKey, stacksAddressOf } from '../src/world/keys.js';
import type { World } from '../src/world/world.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTHING = { notified: [], finished: [], errors: [] };

async function anotherUsersWatch(world: World, api: ApiWorker) {
  const owner = bitcoinKey(world.rng);
  const deposit = buildDepositAddress({
    stacksAddress: stacksAddressOf(owner),
    reclaimPublicKey: owner.xOnly,
    signersPublicKey: world.signer.xOnly,
    maxSignerFeeSats: 80_000,
    reclaimLockBlocks: 950,
  });
  const response = await api.dispatch(
    new Request(`${API_ORIGIN}/deposits`, {
      method: 'POST',
      headers: { origin: APP_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({
        depositScript: deposit.depositScript,
        reclaimScript: deposit.reclaimScript,
      }),
    })
  );
  expect(response.status).toBe(201);
  return deposit;
}

function sortedReport(report: unknown): unknown {
  const out: Record<string, unknown> = {};
  for (const key of ['watched', 'notified', 'finished', 'errors']) {
    const value = field(report, key);
    const list: unknown[] | null = Array.isArray(value) ? value : null;
    out[key] = list
      ? [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : value;
  }
  return out;
}

test.describe('R8. the Worker watch for a deposit whose tab was closed', () => {
  test('closed right after Continue: an empty chain keeps the watch, the payout ends it', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startDeposit(app);
    await app.page.close();
    const watch = api.watch(receipt.depositAddress);
    expect(field(watch, 'registrations')).toEqual([
      expect.objectContaining({
        swapDepositAddress: receipt.quoteResponse.quote.depositAddress,
        priorOutpoints: [],
      }),
    ]);
    for (let run = 0; run < 2; run++) {
      expect(await api.runScheduled()).toEqual({ watched: 1, ...NOTHING });
      expect(api.watched()).toEqual([receipt.depositAddress]);
    }
    expect(world.requestsTo('emily', { method: 'POST' })).toEqual([]);

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
    expect(await api.runScheduled()).toEqual({ watched: 0, ...NOTHING });
  });

  test('an abandoned watch expires after 14 days on the world clock', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startDeposit(app);
    await app.page.close();
    const key = `dep:${receipt.depositAddress}`;
    expect(Math.abs((api.kv.expiresInMs(key) ?? 0) - 14 * DAY_MS)).toBeLessThan(10_000);
    world.advanceClock(13 * DAY_MS);
    expect(await api.runScheduled()).toEqual({ watched: 1, ...NOTHING });
    world.advanceClock(DAY_MS + 60_000);
    expect(await api.runScheduled()).toEqual({ watched: 0, ...NOTHING });
    expect(api.kv.operations).toContain(`expired ${key}`);
    expect(api.watched()).toEqual([]);
  });

  test('a failing registration for one address does not block another address', async ({
    app,
    world,
    api,
  }) => {
    const { receipt } = await startDeposit(app);
    await app.page.close();
    const other = await anotherUsersWatch(world, api);
    world.reportDeposit();
    const payout = world.completeSwap();
    const theirs = world.payTo(other.address, 50_000);
    world.addFault({
      service: 'emily',
      method: 'POST',
      bodyIncludes: payout.outpoint.txid,
      outcome: json({ message: 'Service Unavailable' }, 503),
    });
    const ours = outpointKey(payout.outpoint);
    expect(sortedReport(await api.runScheduled())).toEqual(
      sortedReport({
        watched: 2,
        notified: [{ address: other.address, txid: theirs.outpoint.txid, vout: 0 }],
        finished: [other.address],
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
    expect(await api.runScheduled()).toEqual({
      watched: 1,
      notified: [{ address: receipt.depositAddress, txid: payout.outpoint.txid, vout: 0 }],
      finished: [receipt.depositAddress],
      errors: [],
    });
  });

  test.fail(
    'APP ISSUE: when one of two fresh outputs on an address fails to register, the notifier still ends the watch, so the failed one is never retried (correct: keep watching until it is registered)',
    async ({ app, world, api }) => {
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
    }
  );
});
