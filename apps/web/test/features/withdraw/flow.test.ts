import { describe, expect, it } from 'vitest';

import {
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
  type OneClickToken,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as W,
  parseOneClickStatus,
} from '@satway/core';

import {
  type FlowDeps,
  type WithdrawalForm,
  describeQuoteChange,
  formatTokenAmount,
  liveQuoteFor,
  parseSats,
  previewFor,
  satsOrNull,
  withdrawalDestinations,
} from '../../../src/features/withdraw/flow.js';
import {
  BASE_USDC,
  EVM_RECIPIENT,
  QUOTE,
  REFUND,
  SENDER,
  SWAP_ADDRESS,
} from '../../shared/withdrawal-fixtures.js';

const USDC: OneClickToken = {
  assetId: BASE_USDC,
  decimals: 6,
  blockchain: 'base',
  symbol: 'USDC',
  price: 1,
};

function token(over: Partial<OneClickToken>): OneClickToken {
  return { ...USDC, ...over };
}

const ACTIVE = '0x0a0614f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c';
const BALANCE_URL = `${W.stxApiUrl}/extended/v2/addresses/${SENDER}/balances/ft/${W.sbtcContract}.sbtc-token::sbtc-token`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function world(options: { balance?: string; feeRate?: number } = {}) {
  const urls: string[] = [];
  const requests: OneClickQuoteRequest[] = [];
  function fetchFn(url: string): Promise<Response> {
    urls.push(url);
    if (url === `${W.sbtcApiUrl}/limits`) {
      return Promise.resolve(
        json({
          perWithdrawalCap: 5_100_000_000,
          rollingWithdrawalBlocks: 150,
          rollingWithdrawalCap: 15_100_000_000,
          availableToWithdraw: 14_000_000_000,
        })
      );
    }
    if (url === `${W.btcApiUrl}/fee-estimates`) {
      return Promise.resolve(json({ '1': options.feeRate ?? 2.5 }));
    }
    if (url.endsWith('/sbtc-registry/get-active-protocol')) {
      return Promise.resolve(json({ okay: true, result: ACTIVE }));
    }
    if (url === BALANCE_URL) return Promise.resolve(json({ balance: options.balance ?? '50000' }));
    return Promise.resolve(new Response('not found', { status: 404 }));
  }
  let last: OneClickQuoteResponse | null = null;
  const deps: FlowDeps = {
    config: W,
    fetchFn,
    quotes: {
      quote(request) {
        requests.push(request);
        last = {
          ...QUOTE,
          quoteRequest: { ...request, appFees: QUOTE.quoteRequest.appFees },
          quote: request.dry
            ? {
                ...QUOTE.quote,
                depositAddress: undefined,
                amountOut: '6517200',
                minAmountOut: '6452028',
              }
            : QUOTE.quote,
        };
        return Promise.resolve(last);
      },
    },
    backend: {
      status(): Promise<OneClickStatusResponse> {
        if (!last) return Promise.reject(new Error('no quote'));
        return Promise.resolve(
          parseOneClickStatus({
            status: 'PENDING_DEPOSIT',
            updatedAt: '2026-11-14T16:41:39.492Z',
            swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] },
            quoteResponse: {
              timestamp: last.timestamp,
              signature: last.signature,
              quoteRequest: last.quoteRequest,
              quote: last.quote,
            },
          })
        );
      },
    },
  };
  return { deps, urls, requests };
}

const FORM: WithdrawalForm = {
  token: USDC,
  amount: '10000',
  recipient: EVM_RECIPIENT,
  refundTo: REFUND,
  slippageBps: 100,
};

describe('withdrawalDestinations', () => {
  it('offers only assets on chains whose addresses can be checked, popular ones first', () => {
    const list = withdrawalDestinations(
      [
        token({ assetId: 'a', symbol: 'ZZZ', blockchain: 'base' }),
        token({ assetId: W.btcAssetId, symbol: 'BTC', blockchain: 'btc' }),
        token({ assetId: 'tron-usdt', symbol: 'USDT', blockchain: 'tron' }),
        token({ assetId: 'sol', symbol: 'SOL', blockchain: 'sol' }),
        token({ assetId: 'dead', symbol: 'OLD (deprecated)', blockchain: 'eth' }),
        token({ assetId: 'free', symbol: 'FREE', blockchain: 'eth', price: 0 }),
        USDC,
      ],
      W.btcAssetId
    );
    expect(list.map(t => t.assetId)).toEqual([BASE_USDC, 'a']);
  });
});

describe('amounts', () => {
  it('reads whole sats, with or without thousands separators', () => {
    expect(parseSats('50000')).toBe(50_000);
    expect(parseSats(' 50,000 ')).toBe(50_000);
    expect(satsOrNull('0.5')).toBeNull();
    expect(satsOrNull('0')).toBeNull();
    expect(satsOrNull('')).toBeNull();
    expect(() => parseSats('1e5')).toThrow(/whole number of sats/);
  });

  it('formats destination base units with the token decimals', () => {
    expect(formatTokenAmount('6515571', USDC)).toBe('6.515571');
    expect(formatTokenAmount('1000000000000000000', token({ decimals: 18 }))).toBe('1.0');
    expect(formatTokenAmount('n/a', USDC)).toBe('n/a');
  });
});

describe('previewFor', () => {
  it('checks the address, then asks for a dry quote only', async () => {
    const w = world();
    const preview = await previewFor(w.deps, FORM);
    expect(preview).toMatchObject({ amountSats: 10_000, maxFeeSats: 3_000, amountOut: '6517200' });
    expect(w.requests.map(r => r.dry)).toEqual([true]);
  });

  it('refuses a bad destination address before any request', async () => {
    const w = world();
    await expect(
      previewFor(w.deps, { ...FORM, recipient: '0xb5660bca47faae88a0c286ca8eec920bbae1d7c' })
    ).rejects.toThrow(/40 hex/);
    expect(w.urls).toHaveLength(0);
  });

  it('refuses the delivered token’s own contract as the recipient, before any request', async () => {
    const w = world();
    const contract = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
    const form = { ...FORM, token: token({ contractAddress: contract }) };
    await expect(
      previewFor(w.deps, { ...form, recipient: `0x${contract.slice(2).toUpperCase()}` })
    ).rejects.toThrow(/contract of the token you receive/);
    await expect(
      liveQuoteFor(w.deps, { ...form, recipient: contract }, SENDER, null)
    ).rejects.toThrow(/contract of the token you receive/);
    expect(w.urls).toHaveLength(0);
  });

  it('explains an amount below the minimum without asking for a quote', async () => {
    const w = world();
    await expect(previewFor(w.deps, { ...FORM, amount: '9000' })).rejects.toThrow(
      'Amount is too small. Withdraw at least 10000 sats.'
    );
    expect(w.requests).toHaveLength(0);
  });
});

describe('liveQuoteFor', () => {
  it('reads the balance, prepares the live request and compares it with the preview', async () => {
    const w = world();
    const preview = await previewFor(w.deps, FORM);
    const live = await liveQuoteFor(w.deps, FORM, SENDER, preview);
    expect(live.balanceSats).toBe(50_000);
    expect(live.receipt.depositAddress).toBe(SWAP_ADDRESS);
    expect(live.receipt.contractCall.postConditions[0]?.amount).toBe('13000');
    expect(live.change).toEqual({
      amountOutDropped: true,
      minAmountOutDropped: true,
      feeCapRose: false,
      worse: true,
    });
    expect(w.requests.map(r => r.dry)).toEqual([true, false]);
  });

  it('refuses when the balance does not cover the amount plus the fee cap', async () => {
    const w = world({ balance: '12000' });
    await expect(liveQuoteFor(w.deps, FORM, SENDER, null)).rejects.toThrow(
      'Your sBTC balance is 12,000 sats, but this withdrawal locks 13,000 sats: the amount plus the signers’ fee cap. Withdraw 1,000 sats less.'
    );
    expect(w.requests).toHaveLength(1);
    const early = world({ balance: '9000' });
    await expect(liveQuoteFor(early.deps, FORM, SENDER, null)).rejects.toThrow(/9,000 sats/);
    expect(early.requests).toHaveLength(0);
  });
});

describe('describeQuoteChange', () => {
  it('says what got worse, in the destination asset', () => {
    const lines = describeQuoteChange(
      { amountOutDropped: true, minAmountOutDropped: true, feeCapRose: true, worse: true },
      { amountOut: '6517200', minAmountOut: '6452028', maxFeeSats: 3_000 },
      { amountOut: '6515571', minAmountOut: '6450415', maxFeeSats: 3_040 },
      USDC
    );
    expect(lines).toEqual([
      'You now receive about 6.515571 USDC, down from 6.5172 USDC.',
      'The guaranteed minimum is now 6.450415 USDC, down from 6.452028 USDC.',
      'Bitcoin fees went up: the signers’ fee cap is now 3,040 sats, up from 3,000.',
    ]);
  });
});
