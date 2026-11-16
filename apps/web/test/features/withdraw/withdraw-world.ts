import {
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
  type OneClickToken,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as W,
  parseOneClickStatus,
} from '@satway/core';

import type { FlowDeps, WithdrawalForm } from '../../../src/features/withdraw/flow.js';
import {
  BASE_USDC,
  EVM_RECIPIENT,
  QUOTE,
  REFUND,
  SENDER,
} from '../../shared/withdrawal-fixtures.js';

export const USDC: OneClickToken = {
  assetId: BASE_USDC,
  decimals: 6,
  blockchain: 'base',
  symbol: 'USDC',
  price: 1,
};

export function token(over: Partial<OneClickToken>): OneClickToken {
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

export function world(options: { balance?: string; feeRate?: number } = {}) {
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

export const FORM: WithdrawalForm = {
  token: USDC,
  amount: '10000',
  recipient: EVM_RECIPIENT,
  refundTo: REFUND,
  slippageBps: 100,
};
