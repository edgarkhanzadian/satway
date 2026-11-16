import type { SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { openWithdraw, quoteWithdrawal } from '../src/scenario/withdrawal.js';
import {
  STACKS_CONNECT_USER_CANCELED,
  USER_REJECTED,
  XVERSE_USER_REJECTION,
} from '../src/wallets/behaviour.js';
import { STACKS_WALLET_NAMES } from '../src/wallets/stacks-wallet.js';

const DECLINED = 'You declined the request in your wallet, so nothing was signed or sent.';
const UNANSWERED = 'Did your wallet send the withdrawal?';
const CLOSED = 'The wallet was closed without connecting. Connect again when you are ready.';

async function tryToConnect(app: SatwayApp): Promise<void> {
  await app.to.getByRole('button', { name: 'Connect Stacks wallet' }).click();
  await app.page
    .locator('connect-modal')
    .getByRole('listitem')
    .filter({ hasText: STACKS_WALLET_NAMES })
    .getByRole('button', { name: 'Connect' })
    .click();
}

test.describe('X9. declines from Stacks wallets', () => {
  test.describe('with Xverse', () => {
    test.use({ walletSetup: { evm: true, stacks: true, stacksAs: 'xverse' } });

    test('Xverse’s -32000 is a decline: nothing is saved or sent, and signing again works', async ({
      app,
      world,
      wallets,
    }) => {
      const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
      await quoteWithdrawal(withdraw);
      await withdraw.continueToConfirm();
      wallets.stacks.behaviour.reject('stx_callContract', {
        code: XVERSE_USER_REJECTION,
        message: 'User rejected request',
      });
      await withdraw.signButton.click();
      await expect(app.page.getByRole('alert')).toHaveText(DECLINED);
      await expect(app.page.getByRole('heading', { name: UNANSWERED })).toHaveCount(0);
      expect(world.withdrawals.stacks.txs.size).toBe(0);
      const storage = await app.storage();
      expect(JSON.parse(storage['satway.withdrawals.v1'] ?? '[]')).toEqual([]);
      expect(storage['satway.withdrawals.active.v1']).toBeUndefined();
      const started = await withdraw.sign();
      expect(started.receipt.stacksTxid).toBe(world.withdrawals.stacks.latestCall().txid);
    });

    test('declining in Xverse while connecting shows the wallet’s answer, and connecting again works', async ({
      app,
      wallets,
    }) => {
      await app.open();
      wallets.stacks.behaviour.reject('getAddresses', {
        code: XVERSE_USER_REJECTION,
        message: 'User rejected request',
      });
      await tryToConnect(app);
      await expect(app.to.getByRole('alert')).toHaveText('User rejected request');
      await app.connectStacksWallet();
    });
  });

  test.describe('with another Stacks wallet', () => {
    test('-32000 from a wallet that is not Xverse is a generic error: the page asks what happened', async ({
      app,
      world,
      wallets,
    }) => {
      const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
      await quoteWithdrawal(withdraw);
      await withdraw.continueToConfirm();
      wallets.stacks.behaviour.reject('stx_callContract', {
        code: XVERSE_USER_REJECTION,
        message: 'Server error',
      });
      await withdraw.signButton.click();
      await expect(app.page.getByRole('heading', { name: UNANSWERED })).toBeVisible();
      await expect(
        app.page.getByRole('button', { name: 'Nothing was sent. Discard it' })
      ).toBeVisible();
    });

    test('closing the modal (-31001) or declining (4001) the connection says so', async ({
      app,
      wallets,
    }) => {
      await app.open();
      for (const code of [STACKS_CONNECT_USER_CANCELED, USER_REJECTED]) {
        wallets.stacks.behaviour.reject('getAddresses', { code, message: 'User rejected request' });
        await tryToConnect(app);
        await expect(app.to.getByRole('alert')).toHaveText(CLOSED);
      }
      await app.connectStacksWallet();
    });
  });
});
