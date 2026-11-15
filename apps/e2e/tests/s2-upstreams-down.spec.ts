import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import {
  FAILED_TO_LOAD,
  NET_FAILED,
  SEND_COPY,
  expectNoSendOffered,
  finishJourney,
  startAwaitingFunds,
} from '../src/scenario/journeys.js';
import {
  expectNoReclaimOffered,
  reclaimControls,
  reclaimFromRecover,
} from '../src/scenario/reclaim.js';
import { openReceiptInRecover, toMinting, toReclaimable } from '../src/scenario/states.js';
import { outpointKey } from '../src/world/bitcoin.js';
import { json } from '../src/world/http.js';
import { TOKENS } from '../src/world/oneclick.js';
import type { FaultOutcome, Service, World } from '../src/world/world.js';

const MARKER = 'MALFORMED-PAYLOAD-MARKER-7f3a';
const COULD_NOT_REFRESH = /^Could not refresh: .+\. Retrying\.$/;
const ADDRESS = /^\/api\/address\//;
const EMILY_DEPOSIT = /^\/deposit\/[0-9a-f]{64}\/\d+$/;
const MINT_UNKNOWN_SPENT =
  'The BTC from this payout has been moved out of the deposit address. The sBTC signers’ API could not be reached, so whether they minted it is not known yet. Check again in a few minutes.';
const MINT_UNKNOWN_NOTICE =
  /^The sBTC signers’ API could not be reached, so this page cannot tell whether your Bitcoin payment has been registered or minted\./;

interface Failure {
  name: string;
  outcome: FaultOutcome;
}

const FAILURES: Failure[] = [
  { name: '5xx', outcome: json({ message: 'upstream exploded' }, 503) },
  { name: 'a network error', outcome: 'network-error' },
  { name: 'malformed JSON', outcome: json({ unexpected: MARKER, items: [MARKER] }) },
];

function problem(app: SatwayApp) {
  return app.page.getByText(COULD_NOT_REFRESH);
}

async function expectNoPayload(app: SatwayApp): Promise<void> {
  expect(await app.page.locator('body').innerText()).not.toContain(MARKER);
}

async function expectNotTerminal(app: SatwayApp): Promise<void> {
  await expect(app.page.getByRole('heading', { name: 'Deposit complete' })).toHaveCount(0);
  await expect(app.page.getByRole('button', { name: 'Start another' })).toHaveCount(0);
  await expect(app.page.getByRole('button', { name: 'Hide' })).toBeEnabled();
}

async function expectStillUsable(app: SatwayApp): Promise<void> {
  await expect(app.page.getByRole('button', { name: 'Download receipt again' })).toBeEnabled();
  await expect(app.page.getByRole('button', { name: 'Recover' })).toBeEnabled();
}

function hold(world: World, service: Service, path: RegExp) {
  return world.hold({ service, path, callers: ['page'] });
}

test.describe('S2. an upstream is down while a deposit is tracked', () => {
  test.beforeEach(({ harness }) => {
    harness.allowConsoleErrors(FAILED_TO_LOAD, NET_FAILED);
  });

  for (const failure of FAILURES) {
    test(`mempool.space address reads fail (${failure.name}): retry copy, no send offered, recovers on the next poll`, async ({
      app,
      world,
      wallets,
    }) => {
      await startAwaitingFunds(app);
      await expect(app.sendButton).toBeVisible();
      world.addFault({ service: 'mempool', path: ADDRESS, outcome: failure.outcome });
      for (let i = 0; i < 2; i++) {
        await app.tick();
        await expect(problem(app)).toBeVisible();
        await expect(app.page.getByText(SEND_COPY.unknown, { exact: true })).toBeVisible();
        await expectNoSendOffered(app);
        await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
        await expectNotTerminal(app);
        await expectStillUsable(app);
        await expectNoPayload(app);
      }
      expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toEqual([]);
      world.clearFaults();
      await app.tick();
      await expect(problem(app)).toHaveCount(0);
      await expect(app.sendButton).toBeVisible();
      await app.sendFromWallet();
      await finishJourney(app, world);
    });

    test(`Emily deposit lookups fail while minting (${failure.name}): mint status unknown, never Done or reclaimable, recovers`, async ({
      app,
      world,
    }) => {
      const { payout } = await toMinting(app, world);
      world.addFault({ service: 'emily', path: EMILY_DEPOSIT, outcome: failure.outcome });
      world.signers.mint(payout.outpoint);
      for (let i = 0; i < 2; i++) {
        await app.tick();
        await expect(problem(app)).toHaveCount(0);
        await expect(app.progress(MINT_UNKNOWN_SPENT)).toBeVisible();
        await expect(app.progress(MINT_UNKNOWN_NOTICE)).toBeVisible();
        await expect(app.definition('Bitcoin payout')).toContainText(payout.outpoint.txid);
        await expectNotTerminal(app);
        await expectStillUsable(app);
        await expectNoPayload(app);
        await expectNoSendOffered(app);
      }
      world.clearFaults();
      await app.waitForProgress(PROGRESS.done);
      await app.expectComplete();
    });

    test(`Emily deposit lookups fail at the timelock (${failure.name}): Recover still shows the output and the reclaim, and never says it was never processed`, async ({
      app,
      world,
      wallets,
    }) => {
      const { started, payout } = await toReclaimable(app, world);
      world.addFault({ service: 'emily', path: EMILY_DEPOSIT, outcome: failure.outcome });
      await openReceiptInRecover(app, started);
      await expect(app.page.getByRole('alert')).toHaveCount(0);
      await expect(app.progress(MINT_UNKNOWN_NOTICE)).toBeVisible();
      await expect(app.progress(/could not be reached/).first()).toBeVisible();
      await expect(app.page.getByText(/never processed/)).toHaveCount(0);
      await expect(app.definition('Bitcoin payout')).toContainText(payout.outpoint.txid);
      const controls = reclaimControls(app);
      await expect(controls.output).toHaveValue(outpointKey(payout.outpoint));
      await reclaimFromRecover(app, wallets.stacks.account.paymentAddress);
      await expect(app.progress(/^Reclaim sent for /)).toBeVisible();
      expect(world.bitcoin.isSpent(payout.outpoint)).toBe(true);
      await expectNoPayload(app);
    });

    test(`the mempool.space tip fails at the timelock (${failure.name}): reclaim is not offered until the tip is known`, async ({
      app,
      world,
    }) => {
      const { started } = await toReclaimable(app, world);
      world.addFault({
        service: 'mempool',
        path: /^\/api\/blocks\/tip\/height$/,
        outcome: failure.outcome,
      });
      await openReceiptInRecover(app, started);
      await expectNoReclaimOffered(app);
      await expectNoPayload(app);
      world.clearFaults();
      await openReceiptInRecover(app, started);
      await expect(reclaimControls(app).button).toBeVisible();
    });

    test(`Hiro fails (${failure.name}): tracking never reads Hiro and reaches Done; "Get quote" refuses`, async ({
      app,
      world,
    }) => {
      await startAwaitingFunds(app);
      const hiroBefore = world.requestsTo('hiro').length;
      world.addFault({ service: 'hiro', outcome: failure.outcome });
      await app.sendFromWallet();
      await finishJourney(app, world);
      expect(world.requestsTo('hiro').length).toBe(hiroBefore);

      await app.startAnother();
      await app.fillDeposit({ amount: '100' });
      await app.page.getByRole('button', { name: 'Get quote' }).click();
      await expect(app.page.getByRole('alert')).toBeVisible();
      await expect(app.definition('You receive about')).toHaveCount(0);
      await expectNoPayload(app);
      expect(world.requestsTo('hiro').length).toBeGreaterThan(hiroBefore);
    });
  }

  test('a held (hanging) mempool.space read: the page stays usable, gives up on it, and recovers on the next poll', async ({
    app,
    world,
  }) => {
    await startAwaitingFunds(app);
    const held = hold(world, 'mempool', ADDRESS);
    await app.tick();
    expect(world.parked).toBe(1);
    world.reportDeposit();
    await app.fastForward(15_000);
    await expect(problem(app)).toBeVisible();
    await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
    await expectNoSendOffered(app);
    await expectNotTerminal(app);
    await expectStillUsable(app);
    await app.waitForProgress(PROGRESS.swapping);
    await expect(problem(app)).toHaveCount(0);
    await expectNoSendOffered(app);
    held.release();
  });

  test('a held (hanging) Emily lookup while minting: never Done early, recovers when it answers', async ({
    app,
    world,
  }) => {
    const { payout } = await toMinting(app, world);
    const held = hold(world, 'emily', EMILY_DEPOSIT);
    await app.tick();
    world.signers.mint(payout.outpoint);
    await app.tick();
    await expect(
      app.progress(PROGRESS.minting).or(app.progress(MINT_UNKNOWN_NOTICE)).first()
    ).toBeVisible();
    await expect(app.progress(PROGRESS.done)).toHaveCount(0);
    await expectNotTerminal(app);
    held.release();
    await app.waitForProgress(PROGRESS.done);
  });

  test('a hanging upstream request times out: the page says it could not refresh and offers no send on the last known status', async ({
    app,
    world,
  }) => {
    await startAwaitingFunds(app);
    await expect(app.sendButton).toBeVisible();
    const held = world.hold({ service: 'mempool', path: ADDRESS, callers: ['page'], times: 1_000 });
    for (let i = 0; i < 6; i++) await app.tick();
    await expect(problem(app)).toBeVisible({ timeout: 1_000 });
    await expect(problem(app)).toHaveText(/No answer from .+ within 15 seconds/);
    await expectNoSendOffered(app);
    await expectStillUsable(app);
    world.clearFaults();
    await app.tick();
    await app.tick();
    await expect(problem(app)).toHaveCount(0);
    await expect(app.sendButton).toBeVisible();
    held.release();
  });

  test.describe('a Solana deposit', () => {
    test.use({ walletSetup: { evm: false, stacks: true, solana: { features: ['signAndSend'] } } });

    async function startSol(app: SatwayApp): Promise<void> {
      await app.open();
      await app.connectStacksWallet();
      await app.connectSolanaWallet();
      await app.fillDeposit({ asset: 'SOL on sol', amount: '0.5' });
      await app.getQuote();
      await app.continue();
      await app.waitForProgress(PROGRESS.awaitingFunds);
      await expect(app.sendButton).toBeVisible();
    }

    for (const failure of FAILURES) {
      test(`the Solana RPC fails at send (${failure.name}): the wallet is never asked, nothing is recorded as sent, a retry works`, async ({
        app,
        world,
        wallets,
      }) => {
        await startSol(app);
        world.addFault({ service: 'solana', outcome: failure.outcome });
        await app.clickSend();
        await expect(app.sendError).toBeVisible();
        await expectNoPayload(app);
        expect(wallets.solana.signRequests).toEqual([]);
        expect(world.solana.submissions).toEqual([]);
        expect(await app.sendRecords()).toEqual([]);
        await expect(app.sendButton).toBeVisible();

        world.clearFaults();
        await app.sendFromWallet();
        expect(world.solana.submissions).toHaveLength(1);
        expect(world.swap().token.assetId).toBe(TOKENS.sol.assetId);
      });
    }

    test('a held Solana RPC call at send: no second send is offered while it hangs, it times out before the wallet is asked, and a retry works', async ({
      app,
      world,
      wallets,
    }) => {
      await startSol(app);
      const held = world.hold({ service: 'solana', rpcMethod: 'getLatestBlockhash' });
      await app.clickSend();
      await expect(
        app.page.getByRole('button', { name: 'Confirm in your wallet…' })
      ).toBeDisabled();
      await app.fastForward(14_000);
      await expectNoSendOffered(app);
      expect(wallets.solana.signRequests).toEqual([]);
      await app.fastForward(1_000);
      await expect(app.sendError).toHaveText(/within 15 seconds/);
      expect(wallets.solana.signRequests).toEqual([]);
      expect(world.solana.submissions).toEqual([]);
      expect(await app.sendRecords()).toEqual([]);
      held.release();
      await app.sendFromWallet();
      expect(world.solana.submissions).toHaveLength(1);
    });
  });
});
