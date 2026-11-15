import type { SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { SEND_COPY, resumeIn, startAwaitingFunds } from '../src/scenario/journeys.js';

async function clickSendInPage(app: SatwayApp): Promise<boolean> {
  return app.page.evaluate(() => {
    const buttons: HTMLButtonElement[] = Array.from(document.querySelectorAll('button'));
    const button = buttons.find(b => b.textContent.startsWith('Send from '));
    if (!button) return false;
    button.click();
    return true;
  });
}

test.describe('M4. two tabs on the same awaiting deposit', () => {
  test('clearing an uncertain send in one tab lets that tab send, although the other tab held the lock', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    harness.allowConsoleErrors(/Internal JSON-RPC error/);
    const started = await startAwaitingFunds(app);
    wallets.evm.behaviour.reject('eth_sendTransaction', {
      code: -32603,
      message: 'Internal JSON-RPC error.',
      times: 1,
    });
    await app.clickSend();
    await expect(app.page.getByText(SEND_COPY.uncertainHeadline, { exact: true })).toBeVisible();
    expect(world.evm.transactions.size).toBe(0);

    const other = await app.newTab();
    await resumeIn(other, started);
    await expect(other.page.getByText(SEND_COPY.uncertainHeadline, { exact: true })).toBeVisible();
    await other.confirmNothingSentButton.click();
    await expect(other.sendButton).toHaveText('Send from Test EVM Wallet');
    await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');

    await other.sendFromWallet();
    await expect(other.sendError).toHaveCount(0);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(2);
    expect(world.evm.transactions.size).toBe(1);
  });

  test('sending in one tab removes the button in the other without a reload', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    const other = await app.newTab();
    await resumeIn(other, started);
    await expect(other.sendButton).toHaveText('Send from Test EVM Wallet');
    await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');

    const wallet = wallets.evm.behaviour.late('eth_sendTransaction');
    await app.clickSend();
    await expect(other.sendButton).toHaveCount(0);
    await expect(other.page.getByText(SEND_COPY.attemptingHeadline, { exact: true })).toBeVisible();
    await expect(other.confirmNothingSentButton).toHaveCount(0);

    wallet.release();
    await expect(app.progress('Sent from your wallet.')).toBeVisible();
    const [sent] = [...world.evm.transactions.values()];
    await expect(
      other.progress(`Sent from your wallet. Transaction ${sent?.hash ?? ''}. Do not send again.`)
    ).toBeVisible();
    await expect(other.sendButton).toHaveCount(0);
    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(1);
    expect(world.evm.transactions.size).toBe(1);
  });

  test('clicking both buttons in a tight race asks the wallet once: the send-record check is locked across tabs', async ({
    app,
    world,
    wallets,
    harness,
  }) => {
    const started = await startAwaitingFunds(app);
    const other = await app.newTab();
    await resumeIn(other, started);
    await expect(other.sendButton).toBeVisible();
    await expect(app.sendButton).toBeVisible();

    const wallet = wallets.evm.behaviour.late('eth_sendTransaction');
    const [first, second] = await Promise.all([clickSendInPage(app), clickSendInPage(other)]);
    expect(first).toBe(true);
    test.info().annotations.push({
      type: 'race',
      description: second
        ? 'the second tab clicked before its button was removed'
        : 'the second tab had already removed its button',
    });
    await harness.idle();
    wallet.release();
    await expect(app.progress('Sent from your wallet.')).toBeVisible();
    await harness.idle();

    expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toHaveLength(1);
    const switches = wallets.evm.behaviour.calls('wallet_switchEthereumChain').length;
    expect(switches).toBeLessThanOrEqual(1);
    expect(wallets.evm.behaviour.calls('eth_chainId')).toHaveLength(1 + switches);
    expect(wallets.evm.behaviour.calls('eth_accounts')).toHaveLength(1);
    expect(world.evm.transactions.size).toBe(1);
    if (second) {
      await expect
        .poll(async () => [
          ...(await app.sendError.allInnerTexts()),
          ...(await other.sendError.allInnerTexts()),
        ])
        .toEqual([SEND_COPY.alreadyRecorded]);
    }
    await expect(app.sendButton).toHaveCount(0);
    await expect(other.sendButton).toHaveCount(0);
    await expect(other.progress('Sent from your wallet.')).toBeVisible();
  });
});
