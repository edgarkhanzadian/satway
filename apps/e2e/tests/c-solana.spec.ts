import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import type { Wallets } from '../src/browser/harness.js';
import { expect, test } from '../src/fixtures.js';
import { expectReceiptMatchesWorld, expectRegisteredWithEmily } from '../src/scenario/checks.js';
import { field, parseJson } from '../src/world/http.js';
import { TOKENS } from '../src/world/oneclick.js';
import { SYSTEM_PROGRAM, associatedTokenAddress, effectsOf } from '../src/world/solana.js';
import type { World } from '../src/world/world.js';

async function finishJourney(
  app: SatwayApp,
  world: World,
  receipt: Parameters<typeof expectRegisteredWithEmily>[1]
) {
  await app.waitForProgress(PROGRESS.swapping);
  const payout = world.completeSwap();
  await app.waitForProgress(PROGRESS.payoutUnconfirmed);
  expectRegisteredWithEmily(world, receipt, payout.outpoint, 'page');
  world.mine(1);
  await app.waitForProgress(PROGRESS.minting);
  world.signers.mint(payout.outpoint);
  await app.waitForProgress(PROGRESS.done);
  await app.expectComplete();
}

async function sendNativeSol(app: SatwayApp, world: World, wallets: Wallets) {
  await app.open();
  await app.connectStacksWallet();
  await app.connectSolanaWallet();
  await expect(app.assetSelect).toHaveValue(TOKENS.usdcSol.assetId);
  await app.fillDeposit({ asset: 'SOL on sol', amount: '0.5' });
  await expect(app.refundInput).toHaveValue(wallets.solana.address);

  await app.getQuote();
  expect(world.oneClick.latestQuote(true).amountIn).toBe('500000000');
  const { receipt } = await app.continue();
  expectReceiptMatchesWorld(receipt, {
    world,
    wallets,
    refundTo: wallets.solana.address,
    assetId: TOKENS.sol.assetId,
  });
  const quote = receipt.quoteResponse.quote;

  await app.waitForProgress(PROGRESS.awaitingFunds);
  await expect(app.page.getByText(`${quote.amountInFormatted} SOL on sol`)).toBeVisible();
  await expect(app.sendButton).toHaveText('Send from Test Solana Wallet');
  await app.sendFromWallet();
  await expect(app.progress('Sent from your wallet.')).toBeVisible();

  expect(world.solana.submissions).toHaveLength(1);
  const [submission] = world.solana.submissions;
  await expect(
    app.progress(`Sent from your wallet. Transaction ${submission?.signature ?? ''}`)
  ).toBeVisible();
  await expect(app.sendButton).toHaveCount(0);

  const [asked] = wallets.solana.signRequests;
  expect(wallets.solana.signRequests).toHaveLength(1);
  expect(asked?.simulationsBefore).toBe(1);
  expect(asked?.transaction.accountKeys[0]).toBe(wallets.solana.address);
  expect(asked?.transaction.requiredSignatures).toBe(1);
  expect(asked ? effectsOf(asked.transaction) : []).toEqual([
    {
      kind: 'sol',
      from: wallets.solana.address,
      to: quote.depositAddress,
      lamports: BigInt(quote.amountIn),
    },
  ]);
  expect(asked?.transaction.instructions.map(i => i.programId)).toEqual([SYSTEM_PROGRAM]);
  expect(world.solana.lamports(quote.depositAddress)).toBe(BigInt(quote.amountIn));
  expect(world.swap(quote.depositAddress).status).toBe('PROCESSING');
  return { receipt, submission };
}

test.describe('C. native SOL from the Wallet Standard Solana wallet', () => {
  test('the wallet signs and sends after the app simulated the transfer', async ({
    app,
    world,
    wallets,
  }) => {
    const { receipt, submission } = await sendNativeSol(app, world, wallets);
    expect(submission?.via).toBe('wallet');
    expect(wallets.solana.behaviour.calls('signAndSendTransaction')).toHaveLength(1);
    expect(wallets.solana.behaviour.calls('signTransaction')).toHaveLength(0);
    await finishJourney(app, world, receipt);
  });

  test.describe('a sign-only wallet', () => {
    test.use({ walletSetup: { evm: false, stacks: true, solana: { features: ['sign'] } } });

    test('the app checks the signed message and sends it through the RPC', async ({
      app,
      world,
      wallets,
    }) => {
      const { receipt, submission } = await sendNativeSol(app, world, wallets);
      expect(submission?.via).toBe('rpc');
      expect(wallets.solana.behaviour.calls('signTransaction')).toHaveLength(1);
      const methods = world
        .requestsTo('solana', { caller: 'page' })
        .map(e => field(parseJson(e.requestBody ?? '{}'), 'method'));
      expect(methods).toEqual(
        expect.arrayContaining([
          'getLatestBlockhash',
          'getMultipleAccounts',
          'simulateTransaction',
          'sendTransaction',
        ])
      );
      await finishJourney(app, world, receipt);
    });
  });

  test('stretch: USDC on Solana creates the deposit token account and transfers exactly amountIn', async ({
    app,
    world,
    wallets,
  }) => {
    const mint = TOKENS.usdcSol.contractAddress;
    const senderAta = world.solana.fundToken(wallets.solana.address, mint, 500_000_000n);
    await app.open();
    await app.connectStacksWallet();
    await app.connectSolanaWallet();
    await app.fillDeposit({ asset: 'USDC on sol', amount: '125.5' });
    await app.getQuote();
    const { receipt } = await app.continue();
    const quote = receipt.quoteResponse.quote;
    expect(world.solana.tokenBalance(quote.depositAddress, mint)).toBeNull();

    await app.waitForProgress(PROGRESS.awaitingFunds);
    await app.sendFromWallet();
    await expect(app.progress('Sent from your wallet.')).toBeVisible();

    const depositAta = associatedTokenAddress(quote.depositAddress, mint);
    const [asked] = wallets.solana.signRequests;
    expect(asked ? effectsOf(asked.transaction) : []).toEqual([
      {
        kind: 'create-ata',
        payer: wallets.solana.address,
        ata: depositAta,
        owner: quote.depositAddress,
        mint,
      },
      {
        kind: 'token',
        source: senderAta,
        destination: depositAta,
        authority: wallets.solana.address,
        mint,
        amount: 125_500_000n,
        decimals: 6,
      },
    ]);
    expect(quote.amountIn).toBe('125500000');
    expect(world.solana.tokenBalance(quote.depositAddress, mint)).toBe(125_500_000n);
    expect(world.solana.tokenBalance(wallets.solana.address, mint)).toBe(
      500_000_000n - 125_500_000n
    );
    expect(world.swap(quote.depositAddress).status).toBe('PROCESSING');
    await finishJourney(app, world, receipt);
  });
});
