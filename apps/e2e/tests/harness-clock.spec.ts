import { handle } from '@satway/api';
import { buildDepositAddress } from '@satway/core';

import { API_ORIGIN, APP_ORIGIN } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';
import { notifierRun } from '../src/scenario/checks.js';
import { workerClockActive } from '../src/worker/worker.js';
import { realNow } from '../src/world/clock.js';
import { field } from '../src/world/http.js';
import { bitcoinKey, stacksAddressOf } from '../src/world/keys.js';
import { BTC_ASSET_ID, TOKENS } from '../src/world/oneclick.js';
import type { World } from '../src/world/world.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function post(path: string, body: unknown): Request {
  return new Request(`${API_ORIGIN}${path}`, {
    method: 'POST',
    headers: { origin: APP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function someDeposit(world: World) {
  const owner = bitcoinKey(world.rng);
  return buildDepositAddress({
    stacksAddress: stacksAddressOf(owner),
    reclaimPublicKey: owner.xOnly,
    signersPublicKey: world.signer.xOnly,
    maxSignerFeeSats: 80_000,
    reclaimLockBlocks: 950,
  });
}

test.describe('harness self-checks: the Worker runs on the world clock', () => {
  test('a registration made days ahead is stamped with world time and its KV TTL really expires', async ({
    world,
    api,
  }) => {
    world.advanceClock(3 * DAY_MS);
    const deposit = someDeposit(world);
    const swap = world.liveSwapFor(deposit.address);
    const response = await api.dispatch(
      post('/deposits', {
        depositScript: deposit.depositScript,
        reclaimScript: deposit.reclaimScript,
        swapDepositAddress: swap.depositAddress,
      })
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      address: deposit.address,
      deadline: field(field(swap.quote.response, 'quoteRequest'), 'deadline'),
    });
    expect(workerClockActive()).toBe(false);
    expect(Math.abs(Date.now() - realNow())).toBeLessThan(1_000);

    const watch = api.watch(deposit.address);
    const createdAt = Date.parse(String(field(watch, 'createdAt')));
    expect(Math.abs(createdAt - world.now().getTime())).toBeLessThan(5_000);
    expect(Math.abs(createdAt - realNow() - 3 * DAY_MS)).toBeLessThan(5_000);
    const [key = ''] = api.registrationKeys(deposit.address);
    const ttl = api.kv.expiresInMs(key) ?? 0;
    expect(Math.abs(ttl - 14 * DAY_MS)).toBeLessThan(5_000);

    world.advanceClock(14 * DAY_MS - 60_000);
    expect(api.watched()).toEqual([deposit.address]);
    world.advanceClock(2 * 60_000);
    expect(api.watched()).toEqual([]);
    expect(await api.runScheduled()).toEqual(notifierRun({ watched: 0 }));
  });

  test('a quote deadline set by a page clock hours ahead is accepted; the real clock would refuse it', async ({
    world,
    api,
  }) => {
    world.advanceClock(4 * 60 * 60 * 1000);
    const deposit = someDeposit(world);
    const body = {
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: TOKENS.usdcBase.assetId,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: BTC_ASSET_ID,
      amount: '100000000',
      refundTo: '0x2222222222222222222222222222222222222222',
      refundType: 'ORIGIN_CHAIN',
      recipient: deposit.address,
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(world.now().getTime() + 120 * 60_000).toISOString(),
    };
    const onRealClock = await handle(post('/quote', body), api.env, world.fetchFor('worker'));
    expect(onRealClock.status).toBe(400);
    expect(await onRealClock.json()).toEqual({
      message: '"deadline" must be in the future and at most 180 minutes away',
    });

    const onWorldClock = await api.dispatch(post('/quote', body));
    expect(onWorldClock.status).toBe(200);
    expect(world.oneClick.quotes).toHaveLength(1);
  });
});
