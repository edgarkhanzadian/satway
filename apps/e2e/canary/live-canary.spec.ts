import {
  MAINNET_CONFIG,
  fetchLimits,
  fetchTipHeight,
  fetchVerifiedSigners,
  parseWith,
  z,
} from '@portage/core';

import { expect, test } from '../src/canary/canary-fixtures.js';
import { SOLANA_MAINNET_CAIP2, UPSTREAM } from '../src/config.js';

const WALLETCONNECT_PROJECT_ID = '78235ea93aa1c847fd6384cc920a44d1';
const SOLANA_RPC_URL = `${UPSTREAM.solanaRpc}/v1/?chainId=${SOLANA_MAINNET_CAIP2}&projectId=${WALLETCONNECT_PROJECT_ID}`;

interface Route {
  asset: string;
  amount: string;
  refundTo: string | null;
  mayFail?: string;
}

const PLACEHOLDER_SOL = 'So11111111111111111111111111111111111111112';
const PLACEHOLDER_TRON = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const ROUTES: Route[] = [
  { asset: 'USDC on base', amount: '25', refundTo: null },
  { asset: 'ETH on eth', amount: '0.01', refundTo: null },
  { asset: 'SOL on sol', amount: '0.2', refundTo: PLACEHOLDER_SOL },
  {
    asset: 'USDT on tron',
    amount: '25',
    refundTo: PLACEHOLDER_TRON,
    mayFail: 'the swap provider may refuse a small Tron route on its minimum',
  },
];

const feesSchema = z.looseObject({
  fastestFee: z.number(),
  halfHourFee: z.number(),
  hourFee: z.number(),
});

const rpcSchema = z.looseObject({ jsonrpc: z.literal('2.0'), result: z.unknown() });

async function solanaRpc(method: string): Promise<unknown> {
  const response = await fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
  });
  expect(response.status, `Solana RPC ${method}`).toBe(200);
  return parseWith(rpcSchema, await response.json(), `Solana RPC ${method}`).result;
}

test.describe('live canary: real public services, read-only, no funds', () => {
  test('upstreams answer in the shapes the app expects', async () => {
    const signers = await fetchVerifiedSigners(MAINNET_CONFIG);
    expect(signers.signersPublicKey).toMatch(/^[0-9a-f]{64}$/);
    const limits = await fetchLimits(MAINNET_CONFIG.sbtcApiUrl);
    expect(limits.perDepositMinimum).toBeGreaterThan(0);
    const tip = await fetchTipHeight(MAINNET_CONFIG.btcApiUrl);
    expect(tip).toBeGreaterThan(900_000);
    const feesUrl = `${MAINNET_CONFIG.btcApiUrl}/v1/fees/recommended`;
    const fees = parseWith(feesSchema, await (await fetch(feesUrl)).json(), feesUrl);
    expect(fees.halfHourFee).toBeGreaterThan(0);
    expect(await solanaRpc('getHealth')).toBe('ok');
    const blockhash = await solanaRpc('getLatestBlockhash');
    expect(JSON.stringify(blockhash)).toMatch(/"blockhash":"[1-9A-HJ-NP-Za-km-z]{32,44}"/);
    test.info().annotations.push({
      type: 'upstreams',
      description: `signers key ${signers.signersPublicKey.slice(0, 12)}…, deposit minimum ${limits.perDepositMinimum} sats, tip ${tip}, half-hour fee ${fees.halfHourFee} sat/vB`,
    });
  });

  test('the production build loads the token list through a local Worker and verifies dry quotes', async ({
    app,
    canaryLog,
  }) => {
    test.setTimeout(180_000);
    await app.open();
    await app.connectStacksWallet();
    await app.connectEvmWallet();
    await expect(app.assetSelect.locator('option')).not.toHaveCount(0, { timeout: 30_000 });
    const options = await app.assetSelect.locator('option').allInnerTexts();
    expect(options.length).toBeGreaterThan(10);
    for (const route of ROUTES) expect(options).toContain(route.asset);

    for (const route of ROUTES) {
      await app.fillDeposit({ asset: route.asset, amount: route.amount });
      if (route.refundTo !== null) await app.refundInput.fill(route.refundTo);
      await app.page.getByRole('button', { name: 'Get quote' }).click();
      const preview = app.definition('You receive about');
      const alert = app.page.getByRole('alert');
      await expect(preview.or(alert).first()).toBeVisible({ timeout: 45_000 });
      const refused = (await alert.count()) > 0 ? await alert.innerText() : null;
      test.info().annotations.push({
        type: refused === null ? 'quote ok' : 'quote refused',
        description: `${route.asset}: ${refused ?? (await preview.innerText())}`,
      });
      if (refused !== null && route.mayFail === undefined)
        throw new Error(`The dry quote for ${route.asset} was refused: ${refused}`);
      await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toHaveCount(0);
    }

    expect(canaryLog.workerCalls.filter(c => c.path === '/tokens').map(c => c.status)).toContain(
      200
    );
    expect(canaryLog.workerCalls.some(c => c.path === '/deposits')).toBe(false);

    await app.fillDeposit({ asset: 'USDC on base', amount: '25' });
    await app.getQuote();
    await app.page.getByRole('button', { name: 'Continue' }).click();
    const blocked = await app.page.evaluate(async api => {
      try {
        await fetch(`${api}/quote`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dry: false }),
        });
        return false;
      } catch {
        return true;
      }
    }, 'http://127.0.0.1:4392');
    expect(blocked).toBe(true);
    await expect(app.page.getByRole('heading', { name: 'Deposit in progress' })).toHaveCount(0);
    expect(canaryLog.violations).toEqual([
      'a guarded button was pressed: Continue',
      'a non-dry quote was requested: {"dry":false}',
    ]);
    canaryLog.violations.length = 0;
  });
});
