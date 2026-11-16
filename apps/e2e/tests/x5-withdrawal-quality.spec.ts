import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

import type { SatwayApp } from '../src/app/satway-app.js';
import { WITHDRAW_PROGRESS, WithdrawPage } from '../src/app/withdraw-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  THEMES,
  activeFocus,
  expectNamedControls,
  expectPageStructure,
  expectVisibleFocus,
  startFocusAtTop,
  tabWalk,
  useTheme,
} from '../src/quality/page-checks.js';
import {
  openWithdraw,
  quoteWithdrawal,
  startWithdrawal,
  toAwaitingSigners,
  toDelivered,
} from '../src/scenario/withdrawal.js';
import { STACKS_WALLET_NAME } from '../src/wallets/stacks-wallet.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const BLOCKING = new Set(['serious', 'critical']);

async function blockingFindings(app: SatwayApp, state: string): Promise<string[]> {
  const found: string[] = [];
  for (const theme of THEMES) {
    await useTheme(app.page, theme);
    const result = await new AxeBuilder({ page: app.page }).withTags(WCAG_TAGS).analyze();
    for (const v of result.violations) {
      if (BLOCKING.has(v.impact ?? 'unknown'))
        found.push(
          `${state} (${theme}): ${v.id} at ${v.nodes.map(n => n.target.join(' ')).join(', ')}`
        );
    }
  }
  await useTheme(app.page, 'light');
  return found;
}

async function expectWithdrawalRoute(app: SatwayApp, tracking: boolean): Promise<void> {
  const route = app.page.getByRole('list', {
    name: tracking ? 'Withdrawal progress' : 'Route of a withdrawal',
  });
  await expect(route).toHaveCount(1);
  await expect(route.getByRole('listitem')).toHaveCount(4);
  await expect(route.locator('li[aria-current="step"]')).toHaveCount(tracking ? 1 : 0);
}

async function audit(app: SatwayApp, state: string, tracking: boolean): Promise<void> {
  await app.harnessIdle();
  expect(
    await blockingFindings(app, state),
    `serious/critical axe violations in "${state}"`
  ).toEqual([]);
  await expectPageStructure(app.page);
  await expectNamedControls(app.page);
  await expectWithdrawalRoute(app, tracking);
  expectVisibleFocus(await tabWalk(app.page));
}

async function tabTo(app: SatwayApp, name: RegExp, max = 40): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    await app.page.keyboard.press('Tab');
    const stop = await activeFocus(app.page);
    seen.push(stop?.name ?? '(nothing)');
    if (stop && name.test(stop.name)) return seen;
  }
  throw new Error(`Tab never reached ${String(name)}; it went through: ${seen.join(' | ')}`);
}

test.describe('X5. accessibility and keyboard use of the withdrawal', () => {
  test('every withdrawal screen passes axe in light and dark, with named controls and visible focus', async ({
    app,
    world,
    wallets,
  }) => {
    await app.open();
    await app.page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await audit(app, 'intro', false);
    const withdraw = await openWithdraw(app, world, wallets, { destinationWallet: 'evm' });
    await audit(app, 'form', false);
    await quoteWithdrawal(withdraw);
    await audit(app, 'preview', false);
    world.withdrawals.liveQuoteFactor = 0.9;
    await withdraw.continueToConfirm();
    await audit(app, 'confirm with a worse live quote', false);
    await withdraw.sign();
    await toAwaitingSigners(withdraw, world);
    await audit(app, 'awaiting signers', true);
    world.withdrawals.signersReject();
    await withdraw.waitFor(WITHDRAW_PROGRESS.rejected);
    await audit(app, 'rejected', true);
    await app.page.getByRole('button', { name: 'Start another' }).click();
    await expect(withdraw.savedWithdrawals).toHaveCount(1);
    await audit(app, 'your withdrawals with a remembered withdrawal', false);
  });

  test('your withdrawals without a Stacks wallet, with a removal prompt and a refused file, passes axe', async ({
    app,
    world,
    wallets,
  }, testInfo) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await app.page.reload();
    await withdraw.openWithdrawals();
    await expect(app.page.getByRole('button', { name: 'Connect Stacks wallet' })).toBeVisible();
    await audit(app, 'your withdrawals without a wallet', false);
    const entry = withdraw.savedWithdrawal('50,000 sats to USDC on base');
    await entry.getByRole('button', { name: 'Remove' }).click();
    await expect(entry.getByRole('button', { name: 'Keep it' })).toBeVisible();
    await audit(app, 'your withdrawals asking to remove', false);
    await entry.getByRole('button', { name: 'Keep it' }).click();
    const junk = testInfo.outputPath('junk.json');
    await writeFile(junk, 'not json');
    await withdraw.uploadReceipt(junk);
    await expect(app.page.getByRole('alert')).toBeVisible();
    await audit(app, 'your withdrawals with a refused file', false);
  });

  test('done passes axe', async ({ app, world, wallets }) => {
    const { withdraw } = await startWithdrawal(app, world, wallets);
    await toDelivered(withdraw, world);
    await audit(app, 'done', true);
  });

  test('a whole withdrawal by keyboard, from the tab to the signed request', async ({
    app,
    world,
    wallets,
  }) => {
    world.withdrawals.fundSbtc(wallets.stacks.account.stacksAddress, 200_000);
    await app.open();
    await startFocusAtTop(app.page);
    await tabTo(app, /^Withdraw$/);
    await app.page.keyboard.press('Enter');
    await expect(
      app.page.getByRole('heading', { name: 'Withdraw sBTC to another chain' })
    ).toBeVisible();
    await tabTo(app, /^Connect Stacks wallet$/);
    await app.page.keyboard.press('Enter');
    const wallet = app.page
      .locator('connect-modal')
      .getByRole('listitem')
      .filter({ hasText: STACKS_WALLET_NAME })
      .getByRole('button', { name: 'Connect' });
    await expect(wallet).toBeVisible();
    for (let i = 0; i < 30; i++) {
      await app.page.keyboard.press('Tab');
      if (await wallet.evaluate(el => el.matches(':focus'))) break;
    }
    await app.page.keyboard.press('Enter');
    await expect(app.page.getByLabel(/^Amount of sBTC/)).toBeVisible();

    await startFocusAtTop(app.page);
    const order = await tabTo(app, /^Amount of sBTC/);
    expect(order.at(-2)).toMatch(/^You receive/);
    await app.page.keyboard.type('50000');
    await tabTo(app, /^Receive at/);
    await app.page.keyboard.type(wallets.evm.address);
    await tabTo(app, /^Get quote$/);
    await app.page.keyboard.press('Enter');
    await expect(app.definition('You receive about')).toBeVisible();
    await tabTo(app, /^Continue$/, 3);
    await app.page.keyboard.press('Enter');
    const confirm = app.page.getByRole('heading', { name: 'Check the live quote before you sign' });
    await expect(confirm).toBeFocused();
    await tabTo(app, /^Sign the withdrawal in your wallet$/, 12);
    const downloaded = app.page.waitForEvent('download');
    await app.page.keyboard.press('Enter');
    await downloaded;
    await expect(app.page.getByRole('heading', { name: 'Withdrawal in progress' })).toBeFocused();
    const withdraw = new WithdrawPage(app);
    await withdraw.waitFor(WITHDRAW_PROGRESS.awaitingTx);
    expect(wallets.stacks.contractCalls).toHaveLength(1);
  });
});
