import { PROGRESS } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { finishJourney, startAwaitingFunds } from '../src/scenario/journeys.js';

const REVERTED =
  'Your earlier transaction reached the chain but failed, so nothing was transferred. You can send again.';

test.describe('M11. a send the wallet acknowledged is checked on chain', () => {
  test('a reverted transaction clears the record and the send button comes back', async ({
    app,
    world,
    wallets,
  }) => {
    await startAwaitingFunds(app);
    world.evm.revertNext = 1;
    await app.clickSend();
    await expect(app.progress(REVERTED)).toBeVisible();
    await expect(app.sendButton).toBeVisible();
    expect(await app.sendRecords()).toEqual([]);
    expect(world.swap().status).toBe('PENDING_DEPOSIT');

    await app.sendFromWallet();
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(2);
    await expect(app.progress('Do not send again.')).toBeVisible();
    await finishJourney(app, world);
  });

  test('a transaction that succeeded is confirmed and the send stays recorded', async ({
    app,
    wallets,
  }) => {
    await startAwaitingFunds(app);
    await app.sendFromWallet();
    await app.waitForProgress(PROGRESS.swapping);
    for (let i = 0; i < 3; i++) await app.tick();
    await expect(app.sendButton).toHaveCount(0);
    expect(await app.sendRecords()).toEqual([
      expect.objectContaining({ state: 'sent', confirmed: true }),
    ]);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(1);
  });
});
