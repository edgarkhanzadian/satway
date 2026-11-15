import { expect, test } from '../src/fixtures.js';
import { FAILED_TO_LOAD } from '../src/scenario/journeys.js';
import { text } from '../src/world/http.js';
import { bitcoinKey } from '../src/world/keys.js';
import type { World } from '../src/world/world.js';

const NOT_IN_DEPOSITS =
  'Signer key from the registry does not appear in any recent confirmed sBTC deposit; refusing to build an address';
const NO_SWEEP =
  'Could not find a recent on-chain sweep of a deposit locked to the registry signer key; refusing to build an address';
const REGISTRY = `https://api.hiro.so/v2/contracts/call-read/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4/sbtc-registry/get-current-aggregate-pubkey`;

interface Case {
  name: string;
  arrange(world: World): void;
  message: string;
  consoleErrors?: boolean;
}

const CASES: Case[] = [
  {
    name: 'Hiro returns a key that no recent confirmed deposit was locked to',
    arrange(world) {
      world.hiro.keyOverride = bitcoinKey(world.rng).publicKey;
    },
    message: NOT_IN_DEPOSITS,
  },
  {
    name: 'Emily’s recent confirmed deposits are locked to a different key',
    arrange: world => world.replaceEvidence('other-signer-key'),
    message: NOT_IN_DEPOSITS,
  },
  {
    name: 'the deposit that would prove the key was never swept on Bitcoin',
    arrange: world => world.replaceEvidence('unswept'),
    message: NO_SWEEP,
  },
  {
    name: 'Hiro is down',
    arrange(world) {
      world.addFault({ service: 'hiro', outcome: text('upstream unavailable', 503) });
    },
    message: `HTTP 503 from ${REGISTRY}: upstream unavailable`,
    consoleErrors: true,
  },
];

test.describe('M7. the signer key cannot be verified, so no deposit address is built', () => {
  for (const c of CASES) {
    test(c.name, async ({ app, world, api, harness }) => {
      if (c.consoleErrors === true) harness.allowConsoleErrors(FAILED_TO_LOAD);
      c.arrange(world);
      await app.open();
      await app.connectStacksWallet();
      await app.connectEvmWallet();
      await app.fillDeposit({ amount: '100' });
      await app.page.getByRole('button', { name: 'Get quote' }).click();

      await expect(app.sendError).toHaveText(c.message);
      await expect(app.definition('Pays out to')).toHaveCount(0);
      await expect(app.page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
      await expect(app.page.getByText(/bc1p[0-9a-z]{58}/)).toHaveCount(0);
      expect(world.hiro.reads.length + world.requestsTo('hiro').length).toBeGreaterThan(0);
      expect(api.requests.filter(r => r.path === '/quote')).toEqual([]);
      expect(world.oneClick.quotes).toEqual([]);
      expect(api.depositPosts()).toEqual([]);
      expect(world.requestsTo('mempool', { path: /\/address\// })).toEqual([]);
      expect(Object.keys(await app.storage()).filter(k => k.startsWith('portage'))).toEqual([]);
    });
  }
});
