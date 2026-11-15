import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { activeFocus, startFocusAtTop, tabWalk } from '../src/quality/page-checks.js';
import { RECLAIM_COPY } from '../src/scenario/reclaim.js';
import { toReclaimable } from '../src/scenario/states.js';
import { EVM_WALLET_NAME } from '../src/wallets/evm-wallet.js';
import { STACKS_WALLET_NAME } from '../src/wallets/stacks-wallet.js';
import type { World } from '../src/world/world.js';

async function tabTo(
  app: SatwayApp,
  name: RegExp,
  options: { max?: number } = {}
): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < (options.max ?? 40); i++) {
    await app.page.keyboard.press('Tab');
    const stop = await activeFocus(app.page);
    seen.push(stop?.name ?? '(nothing)');
    if (stop && name.test(stop.name)) return seen;
  }
  throw new Error(`Tab never reached ${String(name)}; it went through: ${seen.join(' | ')}`);
}

async function press(app: SatwayApp, key: string): Promise<void> {
  await app.page.keyboard.press(key);
}

async function connectStacksByKeyboard(app: SatwayApp): Promise<void> {
  await startFocusAtTop(app.page);
  await tabTo(app, /^Connect Stacks wallet$/);
  await press(app, 'Enter');
  const modal = app.page.locator('connect-modal');
  const wallet = modal
    .getByRole('listitem')
    .filter({ hasText: STACKS_WALLET_NAME })
    .getByRole('button', { name: 'Connect' });
  await expect(wallet).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await press(app, 'Tab');
    if (await wallet.evaluate(el => el.matches(':focus'))) break;
  }
  await expect(wallet).toBeFocused();
  await press(app, 'Enter');
  await expect(app.to.getByText('Connected', { exact: true })).toBeVisible();
  await expect(modal).toHaveCount(0);
}

async function toDoneFromWorld(app: SatwayApp, world: World): Promise<void> {
  await app.waitForProgress(PROGRESS.swapping);
  const payout = world.completeSwap();
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(payout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();
}

test.describe('Q2. keyboard only', () => {
  test('the landing focus order is sensible and Tab leaves the page instead of being trapped', async ({
    app,
  }) => {
    await app.open();
    await expect(app.from.getByRole('button', { name: new RegExp(EVM_WALLET_NAME) })).toBeVisible();
    const stops = await tabWalk(app.page);
    expect(stops.map(s => s.name)).toEqual([
      'Deposit',
      'Withdraw',
      'Recover',
      `${EVM_WALLET_NAME}For Ethereum, Base, Arbitrum and other EVM chains`,
      'Test Solana WalletFor Solana',
      'WalletConnectScan with a mobile wallet',
      'Connect Stacks wallet',
    ]);
  });

  test('a full USDC-on-Base deposit to Done, including the Stacks wallet modal', async ({
    app,
    world,
    wallets,
  }) => {
    await app.open();
    await expect(app.from.getByRole('button', { name: new RegExp(EVM_WALLET_NAME) })).toBeVisible();
    await connectStacksByKeyboard(app);
    await tabTo(app, new RegExp(`^${EVM_WALLET_NAME}`));
    await press(app, 'Enter');
    await expect(app.from.getByText(`${EVM_WALLET_NAME} connected`)).toBeVisible();

    const order = await tabTo(app, /^Amount/);
    expect(order.at(-2)).toMatch(/^You send/);
    await app.page.keyboard.type('100');
    await tabTo(app, /^Get quote$/);
    await press(app, 'Enter');
    await expect(app.definition('You receive about')).toBeVisible();
    expect((await activeFocus(app.page))?.name).toBe('Get quote');
    await tabTo(app, /^Continue$/, { max: 2 });
    const downloaded = app.page.waitForEvent('download');
    await press(app, 'Enter');
    await downloaded;
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await app.waitForProgress(PROGRESS.awaitingFunds);

    await startFocusAtTop(app.page);
    await tabTo(app, /^Send from Test EVM Wallet$/);
    await press(app, 'Enter');
    await expect(app.progress('Sent from your wallet.')).toBeVisible();
    await expect(app.sendButton).toHaveCount(0);
    await press(app, 'Tab');
    expect((await activeFocus(app.page))?.name).toBe('Download receipt again');
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(1);
    await toDoneFromWorld(app, world);
    await startFocusAtTop(app.page);
    await tabTo(app, /^Start another$/);
    await press(app, 'Enter');
    await expect(
      app.page.getByRole('heading', { name: 'Deposit to sBTC from another chain' })
    ).toBeVisible();
  });

  test('pressing "Get quote" with the keyboard keeps focus on the button while it works and after the quote arrives', async ({
    app,
  }) => {
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.page.getByRole('button', { name: 'Get quote' }).focus();
    await press(app, 'Enter');
    await expect(app.definition('You receive about')).toBeVisible();
    expect((await activeFocus(app.page))?.name).toBe('Get quote');
  });

  test('when the send button disappears after a keyboard send, focus moves to the payment status that replaced it', async ({
    app,
  }) => {
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    await app.continue();
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await app.sendButton.focus();
    await press(app, 'Enter');
    await expect(app.progress('Sent from your wallet.')).toBeVisible();
    expect((await activeFocus(app.page))?.name).toMatch(/^Sent from your wallet\. Transaction /);
  });

  test('a full reclaim, from a fresh page, with the keyboard only', async ({
    app,
    world,
    wallets,
  }) => {
    const { payout } = await toReclaimable(app, world);
    await app.page.reload();
    await app.open();
    await connectStacksByKeyboard(app);
    await startFocusAtTop(app.page);
    await tabTo(app, /^Recover$/);
    await press(app, 'Enter');
    await expect(
      app.page.getByRole('heading', { name: 'Check or recover a deposit' })
    ).toBeVisible();
    await tabTo(app, /^Or pick one remembered by this browser/);
    await app.page.keyboard.type('1');
    await expect(app.progress(RECLAIM_COPY.signersMayMint)).toBeVisible();
    await tabTo(app, /^Output to reclaim/);
    await tabTo(app, /^Send the reclaimed BTC to/, { max: 2 });
    await app.page.keyboard.type(wallets.stacks.account.paymentAddress);
    await tabTo(app, /^Reclaim BTC$/, { max: 2 });
    await press(app, 'Enter');
    await expect(app.page.getByRole('button', { name: 'Sign and send' })).toBeVisible();
    await tabTo(app, /^Sign and send$/, { max: 2 });
    await press(app, 'Enter');
    await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
    expect(world.bitcoin.isSpent(payout.outpoint)).toBe(true);
    expect(wallets.stacks.behaviour.calls('signPsbt')).toHaveLength(1);
  });
});
