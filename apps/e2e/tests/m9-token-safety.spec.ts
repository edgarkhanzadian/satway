import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { SEND_COPY, startDeposit } from '../src/scenario/journeys.js';
import type { WorldToken } from '../src/world/oneclick.js';
import { encodeMint } from '../src/world/solana.js';

const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

async function expectManualSendStillWorks(
  app: SatwayApp,
  started: Awaited<ReturnType<typeof startDeposit>>,
  label: string
): Promise<void> {
  const quote = started.receipt.quoteResponse.quote;
  await expect(
    app.page.getByText(`${quote.amountInFormatted} ${label}`, { exact: true })
  ).toBeVisible();
  await expect(app.page.getByText(quote.depositAddress, { exact: true })).toBeVisible();
}

const EVM_CASES: { name: string; token: WorldToken; message: string }[] = [
  {
    name: 'an EVM token with no contract address that is not a known native coin',
    token: {
      assetId: 'nep141:base-mystery.omft.near',
      decimals: 18,
      blockchain: 'base',
      symbol: 'MYST',
      price: 2,
      family: 'evm',
      chainId: 8453,
    },
    message: `The token list has no contract address for MYST on base, and it is not a known native coin. ${SEND_COPY.sendManually}`,
  },
  {
    name: 'an EVM token whose asset id embeds a different contract than contractAddress',
    token: {
      assetId: 'nep141:base-0x1111111111111111111111111111111111111111.omft.near',
      decimals: 6,
      blockchain: 'base',
      symbol: 'TWIN',
      price: 1,
      contractAddress: '0x2222222222222222222222222222222222222222',
      family: 'evm',
      chainId: 8453,
    },
    message: `The token list gives two different contract addresses for TWIN. ${SEND_COPY.sendManually}`,
  },
];

test.describe('M9. tokens the wallet must not send are quoted but left to a manual send', () => {
  for (const c of EVM_CASES) {
    test(c.name, async ({ app, world, wallets }) => {
      world.oneClick.extraTokens.push(c.token);
      const started = await startDeposit(app, {
        asset: `${c.token.symbol} on base`,
        amount: '100',
      });
      expect(started.receipt.origin.assetId).toBe(c.token.assetId);
      await app.waitForProgress(PROGRESS.awaitingFunds);
      await expectManualSendStillWorks(app, started, `${c.token.symbol} on base`);

      await app.clickSend();
      await expect(app.sendError).toHaveText(c.message);
      expect(wallets.evm.behaviour.requests.map(r => r.method)).toEqual(['eth_requestAccounts']);
      expect(await app.sendRecords()).toEqual([]);

      world.reportDeposit();
      await app.waitForProgress(PROGRESS.swapping);
      expect(world.evm.transactions.size).toBe(0);
    });
  }

  test('a Solana mint owned by the Token-2022 program', async ({ app, world, wallets }) => {
    const mint = world.rng.base58(32);
    world.solana.accounts.set(mint, {
      lamports: 1_461_600n,
      owner: TOKEN_2022,
      data: encodeMint({ decimals: 6, supply: 10n ** 12n, authority: world.rng.base58(32) }),
      executable: false,
    });
    world.oneClick.extraTokens.push({
      assetId: `nep141:sol-${world.rng.hex(20)}.omft.near`,
      decimals: 6,
      blockchain: 'sol',
      symbol: 'HOOK',
      price: 1,
      contractAddress: mint,
      family: 'solana',
    });
    await app.open();
    await app.connectStacksWallet();
    await app.connectSolanaWallet();
    await app.fillDeposit({ asset: 'HOOK on sol', amount: '25' });
    await app.getQuote();
    const started = await app.continue();
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await expectManualSendStillWorks(app, started, 'HOOK on sol');

    await app.clickSend();
    await expect(app.sendError).toHaveText(
      `This token uses the Token-2022 program, whose fees and transfer hooks can change the amount that arrives. ${SEND_COPY.sendManually}`
    );
    await expect(app.sendButton).toHaveText('Send from Test Solana Wallet');
    expect(wallets.solana.behaviour.requests.map(r => r.method)).toEqual(['connect']);
    expect(wallets.solana.signRequests).toEqual([]);
    expect(world.solana.simulations).toEqual([]);
    expect(await app.sendRecords()).toEqual([]);
  });
});
