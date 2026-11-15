import type { Page } from '@playwright/test';

import { PROGRESS, type SatwayApp } from '../src/app/satway-app.js';
import { APP_ORIGIN } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';
import { expectRegisteredWithEmily } from '../src/scenario/checks.js';
import { finishJourney, savedLabel, startAwaitingFunds } from '../src/scenario/journeys.js';

const NEW_RECEIPTS = 'satway.receipts.v1';
const PORTAGE_RECEIPTS = 'portage.receipts.v1';
const OLD_RECEIPTS = 'stxonector.receipts.v1';
const IDB_NAME = 'WALLET_CONNECT_V2_INDEXED_DB';
const IDB_STORE = 'keyvaluestorage';
function OLD_WC(name: string): string {
  return `wc@2:core:0.3:stxonector-evm:${name}`;
}
function PORTAGE_WC(name: string): string {
  return `wc@2:core:0.3:portage-evm:${name}`;
}
function NEW_WC(name: string): string {
  return `wc@2:core:0.3:satway-evm:${name}`;
}
const OLD_WC_SLASHES = 'wc@2:client:0.3//stxonector-evm:session';
const PORTAGE_WC_SLASHES = 'wc@2:client:0.3//portage-evm:session';
const NEW_WC_SLASHES = 'wc@2:client:0.3//satway-evm:session';
const PORTAGE_SEND_RECORD = 'portage:send-record:v1:0xelsewhere:';
const NEW_SEND_RECORD = 'satway:send-record:v1:0xelsewhere:';

interface StorageSnapshot {
  local: Record<string, string>;
  session: Record<string, string>;
  idb: Record<string, unknown>;
}

async function snapshot(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(
    async ({ name, store }) => {
      function dump(s: Storage): Record<string, string> {
        const out: Record<string, string> = {};
        for (let i = 0; i < s.length; i++) {
          const key = s.key(i);
          if (key !== null) out[key] = s.getItem(key) ?? '';
        }
        return out;
      }
      const idb = await new Promise<Record<string, unknown>>(resolve => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onerror = () => resolve({});
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve({});
            return;
          }
          const tx = db.transaction(store, 'readonly');
          const keys = tx.objectStore(store).getAllKeys();
          const values = tx.objectStore(store).getAll();
          tx.oncomplete = () => {
            const out: Record<string, unknown> = {};
            keys.result.forEach((k, i) => {
              out[typeof k === 'string' ? k : JSON.stringify(k)] = values.result[i];
            });
            db.close();
            resolve(out);
          };
        };
      });
      return { local: dump(localStorage), session: dump(sessionStorage), idb };
    },
    { name: IDB_NAME, store: IDB_STORE }
  );
}

async function seed(page: Page, data: StorageSnapshot): Promise<void> {
  await page.evaluate(
    async ({ name, store, data: seeded }) => {
      localStorage.clear();
      sessionStorage.clear();
      for (const [k, v] of Object.entries(seeded.local)) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(seeded.session)) sessionStorage.setItem(k, v);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(store))
            request.result.createObjectStore(store);
        };
        request.onerror = () => reject(new Error('could not open IndexedDB'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).clear();
          for (const [k, v] of Object.entries(seeded.idb)) tx.objectStore(store).put(v, k);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(new Error('could not seed IndexedDB'));
        };
      });
    },
    { name: IDB_NAME, store: IDB_STORE, data }
  );
}

async function blankPageOnOrigin(app: SatwayApp): Promise<SatwayApp> {
  await app.page.close();
  const fresh = await app.newTab();
  await fresh.page.goto(`${APP_ORIGIN}/__e2e/health`);
  return fresh;
}

async function migrated(page: Page): Promise<StorageSnapshot> {
  await expect
    .poll(async () =>
      Object.keys((await snapshot(page)).idb).some(
        k => k.includes('stxonector') || k.includes('portage')
      )
    )
    .toBe(false);
  return snapshot(page);
}

test.describe('S4. data saved under the old "stxonector" and "portage" names', () => {
  test('is moved to the new names on first load, is trackable, and a second load changes nothing', async ({
    app,
    world,
  }) => {
    const started = await startAwaitingFunds(app);
    const receipts = (await snapshot(app.page)).local[NEW_RECEIPTS];
    if (receipts === undefined) throw new Error('The deposit left no receipts list');

    const fresh = await blankPageOnOrigin(app);
    await seed(fresh.page, {
      local: {
        [OLD_RECEIPTS]: receipts,
        [PORTAGE_WC('keychain')]: '{"old":"keychain"}',
        [PORTAGE_SEND_RECORD]: '{"old":"send record"}',
        unrelated: 'stays',
      },
      session: {
        'stxonector:sent-tx:0xabc': '0xdeadbeef',
        'portage:sent-tx:0xdef': '0xfeedface',
        'unrelated-session': 'stays',
      },
      idb: {
        [OLD_WC('pairing')]: [{ topic: 'old-pairing' }],
        [PORTAGE_WC_SLASHES]: [{ topic: 'old-session' }],
        'wc@2:core:0.3:someone-else:pairing': 'not ours',
      },
    });

    await fresh.open();
    const after = await migrated(fresh.page);
    expect(after.local).toEqual({
      [NEW_RECEIPTS]: receipts,
      [NEW_WC('keychain')]: '{"old":"keychain"}',
      [NEW_SEND_RECORD]: '{"old":"send record"}',
      unrelated: 'stays',
    });
    expect(after.session).toEqual({ 'unrelated-session': 'stays' });
    expect(after.idb).toEqual({
      [NEW_WC('pairing')]: [{ topic: 'old-pairing' }],
      [NEW_WC_SLASHES]: [{ topic: 'old-session' }],
      'wc@2:core:0.3:someone-else:pairing': 'not ours',
    });

    await fresh.page.reload();
    await fresh.open();
    await fresh.harnessIdle();
    expect(await snapshot(fresh.page)).toEqual(after);

    await fresh.connectStacksWallet();
    await fresh.connectEvmWallet();
    await fresh.resumeSaved(savedLabel(started));
    await fresh.waitForProgress(PROGRESS.awaitingFunds);
    world.reportDeposit();
    await fresh.waitForProgress(PROGRESS.swapping);
    const payout = await finishJourney(fresh, world);
    expectRegisteredWithEmily(world, started.receipt, payout.outpoint, 'page');
  });

  test('never overwrites data that already exists under the new names', async ({ app }) => {
    const started = await startAwaitingFunds(app);
    const receipts = (await snapshot(app.page)).local[NEW_RECEIPTS];
    if (receipts === undefined) throw new Error('The deposit left no receipts list');
    const fresh = await blankPageOnOrigin(app);
    const seeded: StorageSnapshot = {
      local: {
        [OLD_RECEIPTS]: '[{"version":1,"note":"an older list"}]',
        [PORTAGE_RECEIPTS]: '[{"version":1,"note":"an old list"}]',
        [NEW_RECEIPTS]: receipts,
        [OLD_WC('keychain')]: 'old keychain',
        [PORTAGE_WC('keychain')]: 'portage keychain',
        [NEW_WC('keychain')]: 'new keychain',
        [PORTAGE_SEND_RECORD]: 'portage send record',
        [NEW_SEND_RECORD]: 'new send record',
      },
      session: {},
      idb: {
        [OLD_WC('pairing')]: 'old pairing',
        [PORTAGE_WC('pairing')]: 'portage pairing',
        [NEW_WC('pairing')]: 'new pairing',
        [OLD_WC_SLASHES]: 'old session',
        [PORTAGE_WC_SLASHES]: 'portage session',
        [NEW_WC_SLASHES]: 'new session',
      },
    };
    await seed(fresh.page, seeded);
    await fresh.open();
    await fresh.harnessIdle();
    await expect.poll(async () => (await snapshot(fresh.page)).idb).toEqual(seeded.idb);
    expect((await snapshot(fresh.page)).local).toEqual(seeded.local);

    await fresh.connectStacksWallet();
    await fresh.openRecover();
    expect(await fresh.savedReceiptLabels()).toEqual([
      expect.stringContaining(savedLabel(started)),
    ]);
  });
});
