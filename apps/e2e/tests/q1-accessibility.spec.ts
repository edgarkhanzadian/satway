import AxeBuilder from '@axe-core/playwright';

import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  THEMES,
  expectNamedControls,
  expectPageStructure,
  expectRouteExposed,
  expectVisibleFocus,
  tabWalk,
  useTheme,
} from '../src/quality/page-checks.js';
import {
  FAILED_TO_LOAD,
  NET_FAILED,
  REFUSED,
  SEND_COPY,
  payOut,
  startAwaitingFunds,
} from '../src/scenario/journeys.js';
import { reclaimControls } from '../src/scenario/reclaim.js';
import { openReceiptInYourDeposits, toReclaimable } from '../src/scenario/states.js';
import { json } from '../src/world/http.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const BLOCKING = new Set(['serious', 'critical']);
const WARNING =
  'This deposit is smaller than the 80000-sat cap on the signers’ fee. That is normally fine, but in a Bitcoin fee spike a small deposit could be mostly consumed by fees.';

interface Finding {
  state: string;
  theme: string;
  rule: string;
  impact: string;
  targets: string[];
}

async function axeFindings(app: SatwayApp, state: string): Promise<Finding[]> {
  const blocking: Finding[] = [];
  const incomplete: Finding[] = [];
  for (const theme of THEMES) {
    await useTheme(app.page, theme);
    const result = await new AxeBuilder({ page: app.page }).withTags(WCAG_TAGS).analyze();
    for (const v of result.violations) {
      const finding = {
        state,
        theme,
        rule: v.id,
        impact: v.impact ?? 'unknown',
        targets: v.nodes.map(n => n.target.join(' ')),
      };
      if (BLOCKING.has(finding.impact)) blocking.push(finding);
    }
    for (const v of result.incomplete)
      incomplete.push({
        state,
        theme,
        rule: v.id,
        impact: v.impact ?? 'unknown',
        targets: v.nodes.map(n => n.target.join(' ')),
      });
  }
  await useTheme(app.page, 'light');
  await test.info().attach(`axe-needs-review-${state}.json`, {
    contentType: 'application/json',
    body: JSON.stringify(incomplete, null, 2),
  });
  return blocking;
}

async function audit(
  app: SatwayApp,
  state: string,
  options: { tracking: boolean; focus?: boolean }
): Promise<void> {
  await app.harnessIdle();
  expect(await axeFindings(app, state), `serious/critical axe violations in "${state}"`).toEqual(
    []
  );
  await expectPageStructure(app.page);
  await expectNamedControls(app.page);
  await expectRouteExposed(app.page, options.tracking);
  if (options.focus !== false) expectVisibleFocus(await tabWalk(app.page));
}

test.describe('Q1. accessibility of every main state, light and dark', () => {
  test('landing, wallets connected, the quote with its warning, and every route stage to Done', async ({
    app,
    world,
  }) => {
    await app.open();
    await audit(app, 'landing', { tracking: false });
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await audit(app, 'wallets connected', { tracking: false });

    await app.fillDeposit({ amount: '50' });
    await app.getQuote();
    await expect(app.page.getByText(WARNING)).toBeVisible();
    await audit(app, 'quote with warning', { tracking: false });

    await app.continue();
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await expect(app.sendButton).toBeVisible();
    await expect(app.progress(PROGRESS.awaitingFunds)).toHaveAttribute('role', 'status');
    await audit(app, 'awaiting funds with the send button', { tracking: true });

    await app.sendFromWallet();
    await app.waitForProgress(PROGRESS.swapping);
    await audit(app, 'swapping', { tracking: true });
    const payout = await payOut(app, world);
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    await audit(app, 'payout unconfirmed', { tracking: true });
    world.mine(1);
    await app.waitForProgress(PROGRESS.minting);
    await audit(app, 'minting', { tracking: true });
    world.signers.mint(payout.outpoint);
    await app.waitForProgress(PROGRESS.done);
    await audit(app, 'done', { tracking: true });
  });

  test('the uncertain send record', async ({ app, wallets }) => {
    await startAwaitingFunds(app);
    wallets.evm.behaviour.loseReply('eth_sendTransaction', {
      code: -32603,
      message: 'Internal JSON-RPC error.',
    });
    await app.clickSend();
    const record = app.page.getByText(SEND_COPY.uncertainHeadline, { exact: true });
    await expect(record).toBeVisible();
    await expect(app.page.getByRole('status').filter({ has: record })).toHaveCount(1);
    await audit(app, 'uncertain send', { tracking: true });
  });

  test('refunded', async ({ app, world }) => {
    await startAwaitingFunds(app);
    await app.sendFromWallet();
    await app.waitForProgress(PROGRESS.swapping);
    world.oneClick.refund(world.swap(), 'Price moved beyond the slippage');
    await app.waitForProgress(
      'The swap did not complete and your funds were sent back to your refund address.'
    );
    await audit(app, 'refunded', { tracking: true });
  });

  test('reclaimable, and Your deposits with the output picker', async ({ app, world }) => {
    const { started } = await toReclaimable(app, world);
    await audit(app, 'reclaimable', { tracking: true });
    await openReceiptInYourDeposits(app, started);
    await expect(reclaimControls(app).output).toBeVisible();
    await audit(app, 'your deposits with the output picker', { tracking: true });
  });

  test('registration notices: refused (alert) and unreachable (status)', async ({
    app,
    world,
    harness,
  }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD, NET_FAILED);
    await startAwaitingFunds(app);
    await app.sendFromWallet();
    world.addFault({
      service: 'emily',
      method: 'POST',
      path: /^\/deposit$/,
      callers: ['page'],
      outcome: json({ message: 'deposit amount is below the minimum' }, 400),
      times: 1,
    });
    await payOut(app, world);
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    await expect(
      app.page.getByRole('alert').filter({ hasText: 'they refused the registration' })
    ).toBeVisible();
    await audit(app, 'registration refused', { tracking: true });

    world.addFault({
      service: 'emily',
      method: 'POST',
      path: /^\/deposit$/,
      callers: ['page'],
      outcome: 'network-error',
    });
    await app.tick();
    await expect(
      app.page.getByRole('status').filter({ hasText: 'could not be reached' })
    ).toBeVisible();
    await audit(app, 'registration unreachable', { tracking: true });
  });

  test('error states: asset list, quote, refresh', async ({ app, world, harness }) => {
    harness.allowConsoleErrors(REFUSED, FAILED_TO_LOAD, NET_FAILED);
    harness.backendDown();
    await app.open();
    await app.connectStacksWallet();
    await expect(app.page.getByRole('alert')).toContainText('Could not load the asset list');
    await audit(app, 'asset list error', { tracking: false });
    harness.backendUp();
    await app.openTab('Withdraw');
    await app.page.getByRole('button', { name: 'Deposit' }).click();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    world.addFault({ service: 'hiro', outcome: 'network-error', times: 1 });
    await app.page.getByRole('button', { name: 'Get quote' }).click();
    await expect(app.page.getByRole('alert')).toBeVisible();
    await audit(app, 'quote error', { tracking: false });
    await app.getQuote();
    await app.continue();
    await app.waitForProgress(PROGRESS.awaitingFunds);
    world.addFault({ service: 'mempool', path: /^\/api\/address\//, outcome: 'network-error' });
    await app.tick();
    await expect(app.page.getByText(/^Could not refresh: /)).toBeVisible();
    await audit(app, 'refresh error', { tracking: true });
  });
});
