import { writeFile } from 'node:fs/promises';

import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { savedLabel, startAwaitingFunds, startDeposit } from '../src/scenario/journeys.js';
import { bitcoinKey, p2trOf } from '../src/world/keys.js';

async function variant(name: string, content: string): Promise<string> {
  const path = test.info().outputPath(name);
  await writeFile(path, content);
  return path;
}

function toRecord(value: unknown): Record<string, unknown> {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  if (typeof copy !== 'object' || copy === null) throw new Error('Not an object');
  const record: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(copy)) record[k] = v;
  return record;
}

function edited(receipt: unknown, change: (r: Record<string, unknown>) => void): string {
  const record = toRecord(receipt);
  change(record);
  return JSON.stringify(record, null, 2);
}

function setQuoteRequest(r: Record<string, unknown>, key: string, value: unknown): void {
  const response = toRecord(r.quoteResponse);
  const request = toRecord(response.quoteRequest);
  request[key] = value;
  response.quoteRequest = request;
  r.quoteResponse = response;
}

async function freshStorage(app: SatwayApp): Promise<void> {
  await app.page.evaluate(() => localStorage.clear());
  await app.open();
  await app.connectStacksWallet();
  await app.openRecover();
  await expect(app.savedReceipts).toHaveCount(0);
}

test.describe('R6. recovering a deposit from a receipt file', () => {
  test('a valid receipt in a browser with no storage is tracked', async ({ app, world }) => {
    const started = await startAwaitingFunds(app);
    world.reportDeposit();
    await freshStorage(app);

    await app.uploadReceipt(started.receiptPath);
    await expect(
      app.page.getByText(started.receipt.reclaimKeyAddress, { exact: true })
    ).toBeVisible();
    await expect(app.progress(PROGRESS.swapping)).toBeVisible();
    await app.followDeposit();
    await app.waitForProgress(PROGRESS.swapping);
    await expect(app.page.getByText(started.receipt.depositAddress, { exact: true })).toBeVisible();
    expect(Object.keys(await app.storage()).filter(k => k.startsWith('satway.receipts'))).toEqual(
      []
    );
  });

  test('a corrupt or inconsistent file is refused with a clear message and nothing is tracked', async ({
    app,
    world,
  }) => {
    const started = await startDeposit(app);
    await app.openRecover();
    const otherAddress = p2trOf(bitcoinKey(world.rng)).address;
    const cases: { file: string; message: string }[] = [
      {
        file: await variant('corrupt.json', '{"version": 1, "createdAt": '),
        message: 'That file is not a deposit receipt.',
      },
      {
        file: await variant(
          'moved-address.json',
          edited(started.receipt, r => {
            r.depositAddress = otherAddress;
          })
        ),
        message: 'Receipt does not add up: its address does not match its parameters',
      },
      {
        file: await variant(
          'swapped-script.json',
          edited(started.receipt, r => {
            r.reclaimScript = String(r.depositScript);
          })
        ),
        message: 'Receipt does not add up: its address does not match its parameters',
      },
      {
        file: await variant(
          'other-recipient.json',
          edited(started.receipt, r => setQuoteRequest(r, 'recipient', otherAddress))
        ),
        message: 'Receipt does not add up: the quote pays a different address',
      },
      {
        file: await variant(
          'version-2.json',
          edited(started.receipt, r => {
            r.version = 2;
          })
        ),
        message: 'Unsupported receipt version',
      },
      {
        file: await variant(
          'no-reclaim-key.json',
          edited(started.receipt, r => {
            delete r.reclaimPublicKey;
          })
        ),
        message: 'Receipt is missing "reclaimPublicKey"',
      },
    ];
    for (const c of cases) {
      const before = world.log.length;
      await app.uploadReceipt(c.file);
      await expect(app.sendError).toHaveText(c.message);
      await expect(app.page.getByRole('button', { name: 'Follow this deposit' })).toHaveCount(0);
      await expect(app.page.getByText('Reclaim key belongs to')).toHaveCount(0);
      expect(world.log.slice(before).filter(e => e.caller === 'page')).toEqual([]);
    }
  });

  test('picking receipt A and then B while A is slow shows only B', async ({
    app,
    world,
    harness,
  }) => {
    const a = await startAwaitingFunds(app, { amount: '100' });
    world.reportDeposit();
    await app.waitForProgress(PROGRESS.swapping);
    await app.page.getByRole('button', { name: 'Hide' }).click();
    await app.fillDeposit({ amount: '60' });
    await app.getQuote();
    const b = await app.continue();
    await app.waitForProgress(PROGRESS.awaitingFunds);

    await app.openRecover();
    const slow = world.hold({ service: 'oneclick', path: /^\/v0\/status$/ });
    await app.pickSavedReceipt(savedLabel(a));
    await expect(app.progress('Checking…')).toBeVisible();
    await app.pickSavedReceipt(savedLabel(b));
    await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
    slow.release();
    await harness.idle();
    await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
    await expect(app.progress(PROGRESS.swapping)).toHaveCount(0);
    const statusFor = world
      .requestsTo('oneclick', { path: '/v0/status' })
      .map(e => new URL(e.url).searchParams.get('depositAddress'));
    expect(statusFor.slice(-2)).toEqual([
      b.receipt.quoteResponse.quote.depositAddress,
      a.receipt.quoteResponse.quote.depositAddress,
    ]);
    await app.followDeposit();
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await expect(
      app.page.getByText(`${b.receipt.quoteResponse.quote.amountInFormatted} USDC on base`, {
        exact: true,
      })
    ).toBeVisible();
  });
});
