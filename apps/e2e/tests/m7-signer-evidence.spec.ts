import { expect, test } from '../src/fixtures.js';
import { FAILED_TO_LOAD } from '../src/scenario/journeys.js';
import { text } from '../src/world/http.js';
import { bitcoinKey } from '../src/world/keys.js';
import type { World } from '../src/world/world.js';

const REFUSE = 'refusing to build an address';
const NOT_IN_DEPOSITS = `Signer key from the registry does not appear in any recent confirmed sBTC deposit; ${REFUSE}`;
const REGISTRY = `https://api.hiro.so/v2/contracts/call-read/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4/sbtc-registry/get-current-aggregate-pubkey`;
const SECOND_SOURCE = `https://stacks-node.alexlab.co/v2/data_var/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4/sbtc-registry/current-aggregate-pubkey?proof=0`;

function sweepsFound(found: number, world: World, reasons: (txid: string) => string[]): string {
  const checked = world.evidence.length;
  const rejected = world.evidence
    .map(e => e.deposit.txid)
    .flatMap(txid => reasons(txid).map(reason => `${txid}:0: ${reason}`))
    .join('; ');
  return `Found ${found} of the 2 recent on-chain sweeps needed to trust the registry signer key (checked ${checked} deposit(s)${rejected ? `; ${rejected}` : ''}); ${REFUSE}`;
}

interface Case {
  name: string;
  arrange(world: World): void;
  message(world: World): string;
  consoleErrors?: boolean;
}

const CASES: Case[] = [
  {
    name: 'both Stacks sources return a key that no recent confirmed deposit was locked to',
    arrange(world) {
      const rogue = bitcoinKey(world.rng).publicKey;
      world.hiro.keyOverride = rogue;
      world.alex.keyOverride = rogue;
    },
    message: () => NOT_IN_DEPOSITS,
  },
  {
    name: 'the second Stacks source disagrees with Hiro on the signer key',
    arrange(world) {
      world.alex.keyOverride = bitcoinKey(world.rng).publicKey;
    },
    message(world) {
      const other = world.alex.keyOverride?.slice(2);
      return `Signer key mismatch between Stacks APIs: api.hiro.so says ${world.signer.xOnly}, stacks-node.alexlab.co says ${String(other)}; ${REFUSE}`;
    },
  },
  {
    name: 'the second Stacks source is down',
    arrange(world) {
      world.addFault({ service: 'alex', outcome: text('upstream unavailable', 503) });
    },
    message: () =>
      `Could not read the signer key from the second Stacks source stacks-node.alexlab.co (HTTP 503 from ${SECOND_SOURCE}: upstream unavailable); ${REFUSE}`,
    consoleErrors: true,
  },
  {
    name: 'Emily’s recent confirmed deposits are locked to a different key',
    arrange: world => world.replaceEvidence('other-signer-key'),
    message: () => NOT_IN_DEPOSITS,
  },
  {
    name: 'the deposits that would prove the key were never swept on Bitcoin',
    arrange: world => world.replaceEvidence('unswept'),
    message: world => sweepsFound(0, world, () => ['the deposit output is not spent']),
  },
  {
    name: 'only one of the two evidence deposits was swept',
    arrange: world => world.replaceEvidence('only-one-swept'),
    message: world =>
      sweepsFound(1, world, txid =>
        txid === world.evidence.at(-1)?.deposit.txid ? ['the deposit output is not spent'] : []
      ),
  },
  {
    name: 'the evidence is swept by a transaction that carries no signer UTXO (not a signer sweep)',
    arrange: world => world.replaceEvidence('without-signer-utxo'),
    message: world =>
      sweepsFound(0, world, () => [
        'the deposit is the first input, where sweeps spend the signer UTXO',
      ]),
  },
  {
    name: 'Hiro is down',
    arrange(world) {
      world.addFault({ service: 'hiro', outcome: text('upstream unavailable', 503) });
    },
    message: () => `HTTP 503 from ${REGISTRY}: upstream unavailable`,
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

      await expect(app.sendError).toHaveText(c.message(world));
      await expect(app.definition('Pays out to')).toHaveCount(0);
      await expect(app.page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
      await expect(app.page.getByText(/bc1p[0-9a-z]{58}/)).toHaveCount(0);
      expect(world.hiro.reads.length + world.requestsTo('hiro').length).toBeGreaterThan(0);
      expect(world.requestsTo('alex', { path: /\/v2\/data_var\// }).length).toBeGreaterThan(0);
      expect(api.requests.filter(r => r.path === '/quote')).toEqual([]);
      expect(world.oneClick.quotes).toEqual([]);
      expect(api.depositPosts()).toEqual([]);
      expect(world.requestsTo('mempool', { path: /\/address\// })).toEqual([]);
      expect(Object.keys(await app.storage()).filter(k => k.startsWith('satway'))).toEqual([]);
    });
  }

  test('with both Stacks sources agreeing and two real signer sweeps, the address is built', async ({
    app,
    world,
  }) => {
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await app.fillDeposit({ amount: '100' });
    await app.getQuote();
    await expect(app.definition('Pays out to')).toHaveText(/^bc1p[0-9a-z]{58}$/);
    expect(world.requestsTo('alex', { caller: 'page' }).map(e => e.status)).toEqual([200]);
    expect(world.evidence).toHaveLength(2);
    for (const { deposit, sweep } of world.evidence) {
      const txid = deposit.txid;
      expect(world.requestsTo('mempool', { path: `/api/tx/${txid}/hex` })).toHaveLength(1);
      expect(world.requestsTo('mempool', { path: `/api/tx/${txid}/outspend/0` })).toHaveLength(1);
      if (sweep === null) throw new Error('The evidence deposit was not swept');
      const spend = world.bitcoin.transaction(sweep);
      expect(spend?.inputs.map(i => i.txid)).toEqual([expect.any(String), txid]);
      expect(spend?.outputs[0]?.value).toBeGreaterThanOrEqual(10_000_000_000);
      expect(world.requestsTo('mempool', { path: `/api/tx/${sweep}` })).toHaveLength(1);
    }
  });
});
