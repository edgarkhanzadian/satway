import { PROGRESS } from '../src/app/satway-app.js';
import { SOLANA_MAINNET_CAIP2 } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';
import { finishJourney } from '../src/scenario/journeys.js';
import {
  EVM_CHAINS,
  WC_COPY,
  startPairing,
  walletConnectButton,
} from '../src/scenario/walletconnect.js';
import { WalletConnectWallet, parsePairingUri } from '../src/wallets/walletconnect-wallet.js';
import { RELAY_ORIGIN } from '../src/world/walletconnect-relay.js';

const URI = /^wc:[0-9a-f]{64}@2\?expiryTimestamp=\d+&relay-protocol=irn&symKey=[0-9a-f]{64}$/;

test.describe('W1. WalletConnect pairing against the fake relay', () => {
  test.use({ walletConnect: 'fake-relay' });

  test.describe('with clipboard access', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    test('the QR appears and "Copy link" copies a valid pairing URI whose proposal asks for our EVM chains and Solana', async ({
      app,
      world,
      wallets,
    }) => {
      await app.open();
      const uri = await startPairing(app);
      await app.page.getByRole('button', { name: 'Copy link' }).click();
      await expect(app.page.getByRole('button', { name: 'Copied' })).toBeVisible();
      const copied = await app.page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe(uri);
      expect(copied).toMatch(URI);

      expect(world.relay.urls).toHaveLength(1);
      const [opened] = world.relay.urls;
      if (opened === undefined) throw new Error('The page never opened the relay');
      const relayUrl = new URL(opened);
      expect(relayUrl.origin).toBe(RELAY_ORIGIN);
      expect(relayUrl.searchParams.get('projectId')).toBe('78235ea93aa1c847fd6384cc920a44d1');
      expect(relayUrl.searchParams.get('auth')).toMatch(/^eyJ/);

      const pairing = parsePairingUri(copied);
      expect(world.relay.proposals.map(p => p.pairingTopic)).toEqual([pairing.topic]);
      const proposal = new WalletConnectWallet(world, wallets.solana.address).readProposal(copied);
      expect(proposal.requiredNamespaces).toEqual({});
      expect(proposal.optionalNamespaces).toEqual({
        eip155: {
          chains: EVM_CHAINS.map(id => `eip155:${id}`),
          methods: ['eth_sendTransaction', 'wallet_switchEthereumChain'],
          events: ['chainChanged', 'accountsChanged'],
        },
        solana: {
          chains: [SOLANA_MAINNET_CAIP2],
          methods: ['solana_signAndSendTransaction', 'solana_signTransaction'],
          events: [],
        },
      });
      expect(proposal.metadata).toEqual({
        name: 'Satway',
        description: 'Deposit to sBTC on Stacks from other chains in one flow',
        url: 'http://127.0.0.1:4391',
        icons: [],
      });
    });
  });

  test('Cancel removes the box and ends the attempt: a late approval does not connect', async ({
    app,
    world,
    wallets,
  }) => {
    await app.open();
    const uri = await startPairing(app);
    await app.page.getByRole('button', { name: 'Cancel' }).click();
    await expect(app.page.getByText(WC_COPY.scan)).toHaveCount(0);
    await expect(walletConnectButton(app)).toBeEnabled();

    const wallet = new WalletConnectWallet(world, wallets.solana.address);
    wallet.approve(uri, { evmChainIds: [8453], solana: false });
    await expect
      .poll(() => world.relay.requests.filter(r => r.method === 'irn_publish').length)
      .toBeGreaterThan(1);
    await app.harnessIdle();
    await expect(app.from.getByText(/connected$/)).toHaveCount(0);
    await expect(walletConnectButton(app)).toBeVisible();
  });

  test('relay unreachable: the app says so, and the injected wallet and a manual deposit still work', async ({
    app,
    world,
  }) => {
    world.relay.mode = 'unreachable';
    await app.open();
    await app.connectStacksWallet();
    await walletConnectButton(app).click();
    await app.until(() =>
      expect(app.from.getByRole('alert')).toHaveText(WC_COPY.unreachable, { timeout: 750 })
    );
    await expect(app.page.getByText(WC_COPY.scan)).toHaveCount(0);
    expect(world.relay.urls.length).toBeGreaterThan(0);

    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    await app.continue();
    await app.waitForProgress(PROGRESS.awaitingFunds);
    world.reportDeposit();
    await app.waitForProgress(PROGRESS.swapping);
    await finishJourney(app, world);
  });
});
