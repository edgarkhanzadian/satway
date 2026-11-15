import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { savedLabel } from '../src/scenario/journeys.js';
import { parseJson } from '../src/world/http.js';

const RECEIPTS = 'satway.receipts.v1';
const UNREADABLE = `${RECEIPTS}.unreadable.`;
const ONLY_COPY =
  'This browser could not keep a copy of the receipt, so the file that was just downloaded is the only copy. Keep it: it is what lets you recover your BTC if anything goes wrong.';

async function openReady(app: SatwayApp): Promise<void> {
  await app.open();
  await app.connectStacksWallet();
  await app.connectEvmWallet();
}

async function deposit(app: SatwayApp, amount: string) {
  await app.fillDeposit({ amount });
  await app.getQuote();
  return app.continue();
}

async function storedList(app: SatwayApp): Promise<unknown[]> {
  const raw = (await app.storage())[RECEIPTS];
  if (raw === undefined) throw new Error('No receipts are stored');
  const list = parseJson(raw);
  if (!Array.isArray(list)) throw new Error(`Stored receipts are not a list: ${raw}`);
  return list.map((item: unknown) => item);
}

test.describe('R7. receipts this browser remembers', () => {
  test('two deposits coexist in storage and in the saved list', async ({ app }) => {
    await openReady(app);
    const first = await deposit(app, '100');
    await app.page.getByRole('button', { name: 'Hide' }).click();
    const second = await deposit(app, '60');
    const list = await storedList(app);
    expect(list).toEqual([
      JSON.parse(JSON.stringify(second.receipt)),
      JSON.parse(JSON.stringify(first.receipt)),
    ]);
    await app.openRecover();
    expect(await app.savedReceiptLabels()).toEqual([
      expect.stringMatching(new RegExp(`^${savedLabel(second).replace('.', '\\.')}, started `)),
      expect.stringMatching(new RegExp(`^${savedLabel(first).replace('.', '\\.')}, started `)),
    ]);
  });

  test('unreadable stored receipts are kept (a broken list is backed up, an unknown entry stays)', async ({
    app,
  }) => {
    await openReady(app);
    await app.page.evaluate(
      ({ key, backup }) => {
        localStorage.setItem(`${backup}0`, 'an older backup');
        localStorage.setItem(key, '[{"version":1,"createdAt":');
      },
      { key: RECEIPTS, backup: UNREADABLE }
    );
    const started = await deposit(app, '100');
    const all = await app.storage();
    expect(all[`${UNREADABLE}0`]).toBe('an older backup');
    expect(all[`${UNREADABLE}1`]).toBe('[{"version":1,"createdAt":');
    expect(await storedList(app)).toEqual([JSON.parse(JSON.stringify(started.receipt))]);
    await expect(app.page.getByText(ONLY_COPY)).toHaveCount(0);

    await app.page.getByRole('button', { name: 'Hide' }).click();
    const future = { version: 9, note: 'written by a newer app' };
    await app.page.evaluate(
      ({ key, value }) => {
        const list: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
        const items: unknown[] = Array.isArray(list) ? list : [];
        localStorage.setItem(key, JSON.stringify([...items, value]));
      },
      { key: RECEIPTS, value: future }
    );
    const next = await deposit(app, '60');
    expect(await storedList(app)).toEqual([
      JSON.parse(JSON.stringify(next.receipt)),
      JSON.parse(JSON.stringify(started.receipt)),
      future,
    ]);
    await app.openRecover();
    expect(await app.savedReceiptLabels()).toHaveLength(2);
  });

  test('a storage quota error on save: the receipt is still downloaded and the "only copy" warning shows', async ({
    app,
    world,
  }) => {
    await app.page.addInitScript(key => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(name: string, value: string) {
        if (name === key)
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        Reflect.apply(original, this, [name, value]);
      };
    }, RECEIPTS);
    await openReady(app);
    const started = await deposit(app, '100');
    expect(started.receipt.quoteResponse.quote.depositAddress).toBe(world.swap().depositAddress);
    await expect(app.page.getByRole('alert')).toHaveText(ONLY_COPY);
    expect(Object.keys(await app.storage()).filter(k => k.startsWith(RECEIPTS))).toEqual([]);
    await app.waitForProgress(PROGRESS.awaitingFunds);
    await expect(app.sendButton).toHaveText('Send from Test EVM Wallet');
  });
});
