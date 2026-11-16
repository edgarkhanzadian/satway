import { PROGRESS } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { SEND_COPY, startAwaitingFunds } from '../src/scenario/journeys.js';
import { USER_REJECTED } from '../src/wallets/behaviour.js';

test.describe('M3. the user rejects the payment in the wallet', () => {
  test('EIP-1193 user rejection (4001): nothing is recorded, the button returns and a retry pays once', async ({
    app,
    world,
    wallets,
  }) => {
    await startAwaitingFunds(app);
    wallets.evm.behaviour.reject('eth_sendTransaction', { code: USER_REJECTED });
    await app.clickSend();
    await expect(app.sendError).toHaveText(SEND_COPY.rejected);
    await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');
    await expect(app.sendButton).toBeEnabled();
    expect(await app.sendRecords()).toEqual([]);
    expect(world.evm.transactions.size).toBe(0);
    expect(world.swap().status).toBe('PENDING_DEPOSIT');
    await app.tick();
    await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');

    await app.sendFromWallet();
    await expect(app.sendError).toHaveCount(0);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(2);
    expect(world.evm.transactions.size).toBe(1);
    expect(world.oneClick.arrivals).toHaveLength(1);
    expect(await app.sendRecords()).toEqual([
      expect.objectContaining({ state: 'sent', via: 'wallet' }),
    ]);
    await app.waitForProgress(PROGRESS.swapping);
  });

  test('Hide and Show while the wallet prompt is open keep the rejection, and ask the wallet once', async ({
    app,
    wallets,
  }) => {
    await startAwaitingFunds(app);
    const late = wallets.evm.behaviour.late('eth_sendTransaction', {
      reject: { code: USER_REJECTED },
    });
    await app.clickSend();
    await expect.poll(() => wallets.evm.behaviour.calls('eth_sendTransaction').length).toBe(1);
    await app.page.getByRole('button', { name: 'Hide', exact: true }).click();
    late.release();
    await app.harnessIdle();
    await app.page.getByRole('button', { name: 'Show progress', exact: true }).click();
    await expect(app.sendError).toHaveText(SEND_COPY.rejected);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(1);
    expect(await app.sendRecords()).toEqual([]);
  });
});
