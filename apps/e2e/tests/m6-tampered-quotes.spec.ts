import type { Download } from '@playwright/test';

import { expect, test } from '../src/fixtures.js';
import { field } from '../src/world/http.js';
import { bitcoinKey, p2trOf } from '../src/world/keys.js';
import { PROVIDER_FEE_RECIPIENT, TOKENS } from '../src/world/oneclick.js';
import type { World } from '../src/world/world.js';

type Body = Record<string, unknown>;

function part(response: Body, key: 'quote' | 'quoteRequest'): Body {
  const value = field(response, key);
  if (typeof value !== 'object' || value === null) throw new Error(`No ${key}`);
  const out: Body = {};
  for (const [k, v] of Object.entries(value)) out[k] = v;
  response[key] = out;
  return out;
}

interface Tamper {
  name: string;
  change(response: Body, world: World): void;
  message: string;
}

function CHANGED(what: string): string {
  return `Quote does not match the request: "${what}" was changed`;
}

const TAMPERS: Tamper[] = [
  {
    name: 'the recipient (our Bitcoin deposit address) is replaced',
    change(r, world) {
      part(r, 'quoteRequest').recipient = p2trOf(bitcoinKey(world.rng)).address;
    },
    message: CHANGED('recipient'),
  },
  {
    name: 'the refund address is replaced',
    change(r, world) {
      part(r, 'quoteRequest').refundTo = world.rng.evmAddress();
    },
    message: CHANGED('refundTo'),
  },
  {
    name: 'the echoed amount is changed',
    change(r) {
      const request = part(r, 'quoteRequest');
      request.amount = String(BigInt(String(request.amount)) * 2n);
    },
    message: CHANGED('amount'),
  },
  {
    name: 'the origin asset is changed',
    change(r) {
      part(r, 'quoteRequest').originAsset = TOKENS.usdtTron.assetId;
    },
    message: CHANGED('originAsset'),
  },
  {
    name: 'the destination asset is changed',
    change(r) {
      part(r, 'quoteRequest').destinationAsset = TOKENS.eth.assetId;
    },
    message: CHANGED('destinationAsset'),
  },
  {
    name: 'the provider fee is raised above the allowed maximum',
    change(r) {
      part(r, 'quoteRequest').appFees = [{ recipient: PROVIDER_FEE_RECIPIENT, fee: 60 }];
    },
    message: 'Quote does not match the request: "appFees" has 60 bps of unexpected fees',
  },
  {
    name: 'an extra fee entry is slipped in front of the provider fee',
    change(r) {
      const request = part(r, 'quoteRequest');
      const fees: unknown[] = Array.isArray(request.appFees) ? request.appFees : [];
      request.appFees = [{ recipient: 'someone.near', fee: 40 }, ...fees];
    },
    message: 'Quote does not match the request: "appFees" has 60 bps of unexpected fees',
  },
  {
    name: 'the slippage is changed',
    change(r) {
      part(r, 'quoteRequest').slippageTolerance = 500;
    },
    message: CHANGED('slippageTolerance'),
  },
  {
    name: 'the deadline is moved',
    change(r) {
      const request = part(r, 'quoteRequest');
      request.deadline = new Date(Date.parse(String(request.deadline)) + 10 * 60_000).toISOString();
    },
    message: CHANGED('deadline'),
  },
  {
    name: 'minAmountOut is above amountOut',
    change(r) {
      const quote = part(r, 'quote');
      quote.minAmountOut = String(Number(quote.amountOut) + 1);
    },
    message: 'Quote does not add up: its minimum output is above its expected output',
  },
  {
    name: 'minAmountOut allows more than the requested slippage',
    change(r) {
      const quote = part(r, 'quote');
      quote.minAmountOut = String(Math.floor(Number(quote.amountOut) * 0.9));
    },
    message: 'Quote does not add up: its minimum output allows more than the requested slippage',
  },
  {
    name: 'the dry flag is flipped',
    change(r) {
      part(r, 'quoteRequest').dry = true;
    },
    message: CHANGED('dry'),
  },
  {
    name: 'the live quote has no deposit address',
    change(r) {
      delete part(r, 'quote').depositAddress;
    },
    message: 'Quote has no deposit address',
  },
];

test.describe('M6. a tampered live quote is refused before anything is saved or registered', () => {
  for (const tamper of TAMPERS) {
    test(`${tamper.name}`, async ({ app, world, api, wallets }) => {
      world.oneClick.tamper = (response, { dry }) => {
        if (!dry) tamper.change(response, world);
      };
      const downloads: Download[] = [];
      app.page.on('download', d => downloads.push(d));
      await app.open();
      await app.connectStacksWallet();
      await app.connectEvmWallet();
      await app.fillDeposit({ amount: '100' });
      await app.getQuote();

      await app.page.getByRole('button', { name: 'Continue' }).click();
      await expect(app.sendError).toHaveText(tamper.message);
      await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toHaveCount(0);
      await expect(app.sendButton).toHaveCount(0);
      expect(world.oneClick.quotes.map(q => q.dry)).toEqual([true, false]);
      expect(downloads).toEqual([]);
      expect(Object.keys(await app.storage()).filter(k => k.startsWith('portage'))).toEqual([]);
      expect(api.depositPosts()).toEqual([]);
      expect(api.watched()).toEqual([]);
      expect(wallets.evm.behaviour.calls('eth_sendTransaction')).toEqual([]);
    });
  }

  test.fail(
    'APP ISSUE: quote.amountIn is never compared with the requested amount, so a changed amountIn is accepted and would be sent from the wallet (correct: refuse)',
    async ({ app, world, api }) => {
      world.oneClick.tamper = (response, { dry }) => {
        if (dry) return;
        const quote = part(response, 'quote');
        quote.amountIn = String(BigInt(String(quote.amountIn)) * 2n);
        quote.amountInFormatted = '200.0';
      };
      const downloads: Download[] = [];
      app.page.on('download', d => downloads.push(d));
      await app.open();
      await app.connectStacksWallet();
      await app.connectEvmWallet();
      await app.fillDeposit({ amount: '100' });
      await app.getQuote();
      await app.page.getByRole('button', { name: 'Continue' }).click();
      const tracking = app.page.getByRole('heading', { name: 'Deposit in progress' });
      await expect(app.sendError.or(tracking).first()).toBeVisible();
      await expect(app.sendError).toBeVisible({ timeout: 500 });
      await expect(app.page.getByText('200.0 USDC on base', { exact: true })).toHaveCount(0);
      expect(downloads).toEqual([]);
      expect(api.depositPosts()).toEqual([]);
    }
  );
});
