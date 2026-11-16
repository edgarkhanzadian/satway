import { expect, test } from '../src/fixtures.js';
import {
  WITHDRAW_SATS,
  openWithdraw,
  quoteWithdrawal,
  toDelivered,
} from '../src/scenario/withdrawal.js';

const DECLINED = 'You declined the request in your wallet, so nothing was signed or sent.';

test.describe('X2. a withdrawal that is refused before anything is signed or sent', () => {
  test('only assets on EVM chains are offered as destinations', async ({ app, world, wallets }) => {
    const withdraw = await openWithdraw(app, world, wallets);
    await expect(withdraw.assetSelect.locator('option')).toHaveText(['USDC on base', 'ETH on eth']);
  });

  test('the wallet rejects the request: nothing is saved or sent, and signing again works', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await quoteWithdrawal(withdraw);
    await withdraw.continueToConfirm();
    wallets.stacks.behaviour.reject('stx_callContract');
    await withdraw.signButton.click();
    await expect(app.page.getByRole('alert')).toHaveText(DECLINED);
    expect(world.withdrawals.stacks.txs.size).toBe(0);
    const storage = await app.storage();
    expect(JSON.parse(storage['satway.withdrawals.v1'] ?? '[]')).toEqual([]);
    expect(storage['satway.withdrawals.active.v1']).toBeUndefined();

    const started = await withdraw.sign();
    expect(started.receipt.stacksTxid).toBe(world.withdrawals.stacks.latestCall().txid);
    expect(wallets.stacks.behaviour.calls('stx_callContract')).toHaveLength(2);
    await toDelivered(withdraw, world);
  });

  test('the sBTC balance does not cover the amount plus the fee cap: no live quote, no wallet', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, {
      destinationWallet: 'evm',
      fund: 51_000,
    });
    await expect(app.page.getByText('Your balance is 51,000 sats.')).toBeVisible();
    await quoteWithdrawal(withdraw);
    await expect(
      app.page.getByText(
        'Your balance of 51,000 sats does not cover the 53,000 sats this locks (the amount plus the fee cap).'
      )
    ).toBeVisible();
    await app.page.getByRole('button', { name: 'Continue' }).click();
    await expect(app.page.getByRole('alert')).toHaveText(
      'Your sBTC balance is 51,000 sats, but this withdrawal locks 53,000 sats: the amount plus the signers’ fee cap. Withdraw 2,000 sats less.'
    );
    expect(world.oneClick.quotes.filter(q => !q.dry)).toHaveLength(0);
    expect(wallets.stacks.behaviour.calls('stx_callContract')).toHaveLength(0);
  });

  test('below the 10,000-sat minimum: refused before any quote', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await withdraw.fill({ amount: '9999' });
    await app.page.getByRole('button', { name: 'Get quote' }).click();
    await expect(app.page.getByRole('alert')).toHaveText(
      'Amount is too small. Withdraw at least 10000 sats.'
    );
    expect(world.oneClick.quotes).toHaveLength(0);
    await withdraw.fill({ amount: '0.5' });
    await expect(app.page.getByRole('button', { name: 'Get quote' })).toBeDisabled();
  });

  test('a destination address with a typo is refused before any quote', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets);
    await withdraw.fill({
      amount: String(WITHDRAW_SATS),
      recipient: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD',
    });
    await app.page.getByRole('button', { name: 'Get quote' }).click();
    await expect(app.page.getByRole('alert')).toContainText('capitalisation error');
    await withdraw.fill({
      amount: String(WITHDRAW_SATS),
      recipient: 'So11111111111111111111111111111111111111112',
    });
    await app.page.getByRole('button', { name: 'Get quote' }).click();
    await expect(app.page.getByRole('alert')).toContainText('not an EVM address');
    expect(world.oneClick.quotes).toHaveLength(0);
  });

  test('a recipient that would burn the delivery is refused before any quote', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets);
    const getQuote = app.page.getByRole('button', { name: 'Get quote' });
    await withdraw.fill({
      asset: 'USDC on base',
      amount: String(WITHDRAW_SATS),
      recipient: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    });
    await getQuote.click();
    await expect(app.page.getByRole('alert')).toHaveText(
      'This is the contract of the token you receive, not a wallet. Funds sent there are lost. Enter an address you control.'
    );
    for (const recipient of [
      '0x0000000000000000000000000000000000000001',
      '0x000000000000000000000000000000000000dEaD',
    ]) {
      await withdraw.fill({ amount: String(WITHDRAW_SATS), recipient });
      await getQuote.click();
      await expect(app.page.getByRole('alert')).toHaveText(
        'This is a reserved system or burn address, not a wallet. Funds sent there are lost.'
      );
    }
    expect(world.oneClick.quotes).toHaveLength(0);
  });

  test('the live quote is worse than the preview: the confirm step says so before signing', async ({
    app,
    world,
    wallets,
  }) => {
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    const preview = await quoteWithdrawal(withdraw);
    world.withdrawals.liveQuoteFactor = 0.9;
    world.withdrawals.feeEstimate = 10;
    await withdraw.continueToConfirm();
    const warnings = app.page.getByRole('alert');
    await expect(warnings).toHaveCount(3);
    await expect(warnings.nth(0)).toContainText(/^You now receive about [\d.]+ USDC, down from/);
    await expect(warnings.nth(0)).toContainText(preview.receive.replace(' on base', ''));
    await expect(warnings.nth(1)).toContainText(/^The guaranteed minimum is now/);
    await expect(warnings.nth(2)).toHaveText(
      'Bitcoin fees went up: the signers’ fee cap is now 7,600 sats, up from 3,000.'
    );
    expect(wallets.stacks.behaviour.calls('stx_callContract')).toHaveLength(0);
    const live = world.withdrawals.latestSwap();
    await expect(app.definition('At least').last()).toContainText(
      (Number(live.minAmountOut) / 1e6).toString()
    );
    await app.page.getByRole('button', { name: 'Cancel' }).click();
    await expect(warnings).toHaveCount(0);
    expect(wallets.stacks.behaviour.calls('stx_callContract')).toHaveLength(0);
    await withdraw.continueToConfirm();
    const started = await withdraw.sign();
    expect(started.receipt.maxFeeSats).toBe(7_600);
  });
});
