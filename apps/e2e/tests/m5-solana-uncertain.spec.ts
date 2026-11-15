import { base58, base64 } from '@scure/base';

import { PROGRESS, type SatwayApp, type StartedDeposit } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { SEND_COPY, expectNoSendOffered } from '../src/scenario/journeys.js';
import { decodeTransaction } from '../src/world/solana.js';

const PENDING_NOTE =
  'Solana has not seen this transaction yet. This page keeps checking until it lands or expires, which takes about two minutes at most.';
const EXPIRED =
  'Your earlier transaction expired before it reached Solana, so nothing was transferred. You can send again.';

function signatureOf(wire: string | undefined): string {
  if (wire === undefined) throw new Error('Nothing was sent to the RPC');
  return base58.encode(base64.decode(wire).subarray(1, 65));
}

async function startSolana(app: SatwayApp): Promise<StartedDeposit> {
  await app.open();
  await app.connectStacksWallet();
  await app.connectSolanaWallet();
  await app.fillDeposit({ asset: 'SOL on sol', amount: '0.5' });
  await app.getQuote();
  const started = await app.continue();
  await app.waitForProgress(PROGRESS.awaitingFunds);
  await expect(app.sendButton).toHaveText('Send from Test Solana Wallet');
  return started;
}

async function clickAndWaitForUncertain(app: SatwayApp): Promise<void> {
  await app.clickSend();
  await expect(app.page.getByText(SEND_COPY.uncertainHeadline, { exact: true })).toBeVisible();
}

async function expectUncertain(app: SatwayApp, signature: string, what: string): Promise<void> {
  await expect(app.page.getByText(SEND_COPY.uncertainHeadline, { exact: true })).toBeVisible();
  await expect(app.page.getByText(`What happened: ${what}`, { exact: true })).toBeVisible();
  await expect(app.page.getByText(`Signature ${signature}`, { exact: true })).toBeVisible();
  await expect(app.page.getByRole('button', { name: SEND_COPY.resend })).toBeVisible();
  await expect(app.confirmNothingSentButton).toHaveCount(0);
  await expectNoSendOffered(app);
}

const DROPPED =
  'Solana did not confirm that it accepted the signed transaction: Solana RPC error: Internal error: the node dropped the transaction';

test.describe('M5. a sign-only Solana wallet whose RPC send fails after signing', () => {
  test.use({ walletSetup: { evm: false, stacks: true, solana: { features: ['sign'] } } });

  test('the RPC drops it: the same signed bytes are sent again and then land', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startSolana(app);
    world.solana.sendReplyFaults.push('drop-then-error');
    await clickAndWaitForUncertain(app);
    const signature = signatureOf(world.solana.rpcSends[0]);
    await expectUncertain(app, signature, DROPPED);
    await expect(app.page.getByText(PENDING_NOTE, { exact: true })).toBeVisible();
    expect(world.solana.submissions).toEqual([]);
    expect(await app.sendRecords()).toEqual([
      expect.objectContaining({
        state: 'uncertain',
        family: 'solana',
        tx: signature,
        signed: expect.objectContaining({ signature, transaction: world.solana.rpcSends[0] }),
      }),
    ]);

    await app.page.getByRole('button', { name: SEND_COPY.resend }).click();
    await expect(
      app.progress(`Sent from your wallet. Transaction ${signature}. Do not send again.`)
    ).toBeVisible();
    expect(world.solana.rpcSends).toHaveLength(2);
    expect(world.solana.rpcSends[1]).toBe(world.solana.rpcSends[0]);
    expect(world.solana.submissions.map(s => s.signature)).toEqual([signature]);
    expect(wallets.solana.behaviour.calls('signTransaction')).toHaveLength(1);
    expect(world.swap(started.receipt.quoteResponse.quote.depositAddress).status).toBe(
      'PROCESSING'
    );
    await app.waitForProgress(PROGRESS.swapping);
  });

  test('the RPC accepts it but the reply is lost: the status check finds the signature', async ({
    app,
    world,
    wallets,
  }) => {
    await startSolana(app);
    world.solana.sendReplyFaults.push('accept-then-error');
    const statusCheck = world.hold({
      service: 'solana',
      rpcMethod: 'getSignatureStatuses',
      callers: ['page'],
    });
    await clickAndWaitForUncertain(app);
    const signature = signatureOf(world.solana.rpcSends[0]);
    await expectUncertain(
      app,
      signature,
      'Solana did not confirm that it accepted the signed transaction: Solana RPC error: Internal error: the reply was lost'
    );
    expect(world.solana.submissions.map(s => s.signature)).toEqual([signature]);

    statusCheck.release();
    await expect(
      app.progress(`Sent from your wallet. Transaction ${signature}. Do not send again.`)
    ).toBeVisible();
    expect(await app.sendRecords()).toEqual([
      expect.objectContaining({ state: 'sent', via: 'chain', tx: signature }),
    ]);
    expect(world.solana.rpcSends).toHaveLength(1);
    expect(wallets.solana.behaviour.calls('signTransaction')).toHaveLength(1);
    await app.waitForProgress(PROGRESS.swapping);
  });

  test('it never lands and its blockhash expires: the record clears and a fresh transaction pays', async ({
    app,
    world,
    wallets,
  }) => {
    await startSolana(app);
    world.solana.sendReplyFaults.push('drop-then-error');
    await clickAndWaitForUncertain(app);
    const [first] = world.solana.rpcSends;
    if (first === undefined) throw new Error('Nothing was sent to the RPC');
    await expectUncertain(app, signatureOf(first), DROPPED);

    await app.until(() =>
      expect(app.page.getByText(EXPIRED, { exact: true })).toBeVisible({ timeout: 750 })
    );
    const firstTx = decodeTransaction(base64.decode(first));
    expect(world.solana.blockhashValid(firstTx.recentBlockhash)).toBe(false);
    await expect(app.sendButton).toHaveText('Send from Test Solana Wallet');
    expect(await app.sendRecords()).toEqual([]);
    expect(world.solana.submissions).toEqual([]);

    await app.sendFromWallet();
    expect(world.solana.rpcSends).toHaveLength(2);
    const [, resent] = world.solana.rpcSends;
    if (resent === undefined) throw new Error('No second transaction reached the RPC');
    const second = decodeTransaction(base64.decode(resent));
    expect(second.recentBlockhash).not.toBe(firstTx.recentBlockhash);
    expect(world.solana.submissions.map(s => s.signature)).toEqual([
      signatureOf(world.solana.rpcSends[1]),
    ]);
    expect(wallets.solana.behaviour.calls('signTransaction')).toHaveLength(2);
    await app.waitForProgress(PROGRESS.swapping);
  });
});
