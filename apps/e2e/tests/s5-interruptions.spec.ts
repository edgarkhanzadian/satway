import { PROGRESS, type PortageApp, type StartedDeposit } from '../src/app/portage-app.js';
import type { Wallets } from '../src/browser/harness.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily } from '../src/scenario/checks.js';
import {
  SEND_COPY,
  expectNoSendOffered,
  payOut,
  resumeIn,
  savedLabel,
  startAwaitingFunds,
  startDeposit,
} from '../src/scenario/journeys.js';
import type { PayoutResult, World } from '../src/world/world.js';

const RECEIPTS = 'portage.receipts.v1';

function sends(wallets: Wallets): number {
  return wallets.evm.behaviour.calls('eth_sendTransaction').length;
}

async function toDone(app: PortageApp, world: World, payout: PayoutResult | null) {
  const paid = payout ?? (await payOut(app, world));
  if (world.bitcoin.transaction(paid.outpoint.txid)?.height == null) {
    await app.waitForProgress(PROGRESS.payoutUnconfirmed);
    world.mine(1);
  }
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(paid.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();
  return paid;
}

interface ReloadPoint {
  name: string;
  run(input: {
    app: PortageApp;
    world: World;
    wallets: Wallets;
  }): Promise<{ started: StartedDeposit; payout: PayoutResult | null }>;
}

const POINTS: ReloadPoint[] = [
  {
    name: 'after Continue',
    async run({ app }) {
      const started = await startDeposit(app);
      await resumeIn(app, started, { reload: true });
      await app.waitForProgress(PROGRESS.awaitingFunds);
      await app.sendFromWallet();
      return { started, payout: null };
    },
  },
  {
    name: 'while the wallet prompt is open',
    async run({ app, world, wallets }) {
      const started = await startAwaitingFunds(app);
      const late = wallets.evm.behaviour.late('eth_sendTransaction');
      await app.clickSend();
      await expect(app.page.getByRole('button', { name: 'Confirm in your wallet…' })).toBeVisible();
      await expect.poll(() => wallets.evm.behaviour.calls('eth_sendTransaction').length).toBe(1);
      await resumeIn(app, started, { reload: true });
      await expect(app.page.getByText(SEND_COPY.attemptingHeadline)).toBeVisible();
      await expectNoSendOffered(app);
      late.release();
      await expect.poll(() => world.evm.transactions.size).toBe(1);
      await app.waitForProgress(PROGRESS.swapping);
      await expectNoSendOffered(app);
      return { started, payout: null };
    },
  },
  {
    name: 'during the swap',
    async run({ app }) {
      const started = await startAwaitingFunds(app);
      await app.sendFromWallet();
      await app.waitForProgress(PROGRESS.swapping);
      await resumeIn(app, started, { reload: true });
      await app.waitForProgress(PROGRESS.swapping);
      await expectNoSendOffered(app);
      return { started, payout: null };
    },
  },
  {
    name: 'after the payout',
    async run({ app, world }) {
      const started = await startAwaitingFunds(app);
      await app.sendFromWallet();
      const payout = await payOut(app, world);
      await app.waitForProgress(PROGRESS.payoutUnconfirmed);
      await resumeIn(app, started, { reload: true });
      await app.waitForProgress(PROGRESS.payoutUnconfirmed);
      return { started, payout };
    },
  },
  {
    name: 'while minting',
    async run({ app, world }) {
      const started = await startAwaitingFunds(app);
      await app.sendFromWallet();
      const payout = await payOut(app, world);
      await app.waitForProgress(PROGRESS.payoutUnconfirmed);
      world.mine(1);
      await app.waitForProgress(PROGRESS.minting);
      await resumeIn(app, started, { reload: true });
      await app.waitForProgress(PROGRESS.minting);
      return { started, payout };
    },
  },
];

test.describe('S5. interruptions', () => {
  test('a reload after the quote loses only the unsaved form: nothing was saved or created', async ({
    app,
    world,
    wallets,
  }) => {
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    await app.page.reload();
    await app.open();
    expect((await app.storage())[RECEIPTS]).toBeUndefined();
    expect(world.oneClick.swaps.size).toBe(0);
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await expect(app.amountInput).toHaveValue('');
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    await app.continue();
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await app.sendFromWallet();
    await toDone(app, world, null);
    expect(sends(wallets)).toBe(1);
    expect(world.oneClick.swaps.size).toBe(1);
  });

  for (const point of POINTS) {
    test(`a reload ${point.name}: Recover -> Follow reaches Done with one send and one Emily registration`, async ({
      app,
      world,
      wallets,
    }) => {
      const { started, payout } = await point.run({ app, world, wallets });
      const paid = await toDone(app, world, payout);
      expect(sends(wallets)).toBe(1);
      expect(world.evm.transactions.size).toBe(1);
      expectRegisteredWithEmily(world, started.receipt, paid.outpoint, 'page');
    });
  }

  test('browser back and forward reload the page: the deposit is recovered from Recover with no second send', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    await app.sendFromWallet();
    await app.page.goBack();
    expect(app.page.url()).toBe('about:blank');
    await app.page.goForward();
    await app.open();
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toHaveCount(0);
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.resumeSaved(savedLabel(started));
    await app.waitForProgress(PROGRESS.swapping);
    await expectNoSendOffered(app);
    await toDone(app, world, null);
    expect(sends(wallets)).toBe(1);
  });

  test('switching to Recover and back mid-flow shows a fresh form; the deposit stays in Recover and nothing is duplicated', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    await app.sendFromWallet();
    await app.openRecover();
    await app.page.getByRole('button', { name: 'Deposit' }).click();
    await expect(
      app.page.getByRole('heading', { name: 'Deposit to sBTC from another chain' })
    ).toBeVisible();
    await app.openRecover();
    expect(await app.savedReceiptLabels()).toEqual([expect.stringContaining(savedLabel(started))]);
    await app.pickSavedReceipt(savedLabel(started));
    await app.followDeposit();
    await app.waitForProgress(PROGRESS.swapping);
    await expectNoSendOffered(app);
    const payout = await toDone(app, world, null);
    expect(sends(wallets)).toBe(1);
    expectRegisteredWithEmily(world, started.receipt, payout.outpoint, 'page');
  });

  test.fail(
    'APP ISSUE: switching to the Recover tab and back during a deposit drops the deposit from view and shows an empty form (correct: the Deposit tab keeps showing the deposit in progress)',
    async ({ app }) => {
      await startAwaitingFunds(app);
      await app.openRecover();
      await app.page.getByRole('button', { name: 'Deposit' }).click();
      await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible({
        timeout: 2_000,
      });
    }
  );

  test('two deposits followed alternately in one tab never show each other’s data', async ({
    app,
    world,
  }) => {
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    const a = await app.continue();
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await app.fillDeposit({ amount: '60' });
    await app.getQuote();
    const b = await app.continue();
    const swapA = a.receipt.quoteResponse.quote.depositAddress;
    const swapB = b.receipt.quoteResponse.quote.depositAddress;
    expect(swapA).not.toBe(swapB);
    world.reportDeposit({ depositAddress: swapA });

    async function follow(target: StartedDeposit, other: StartedDeposit, progress: string) {
      await app.resumeSaved(savedLabel(target));
      await app.waitForProgress(progress);
      const body = await app.page.locator('main').innerText();
      expect(other.receipt.depositAddress).toBe(target.receipt.depositAddress);
      expect(body).not.toContain(other.receipt.quoteResponse.quote.depositAddress);
      expect(body).not.toContain(
        `${other.receipt.quoteResponse.quote.amountInFormatted} USDC on base`
      );
    }

    for (let round = 0; round < 2; round++) {
      await follow(a, b, PROGRESS.swapping);
      await app.expectRouteAt('Swap to BTC', 'In progress');
      await follow(b, a, PROGRESS.awaitingFunds);
      await app.expectRouteAt('Your chain', 'In progress');
      await expect(app.sendButton).toBeVisible();
    }
  });
});
