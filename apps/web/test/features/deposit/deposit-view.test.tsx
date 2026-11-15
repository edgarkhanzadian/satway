import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { Deposit } from '../../../src/features/deposit/deposit.js';
import type { Backend, Receipt } from '../../../src/shared/index.js';

const receipt: Receipt = {
  version: 1,
  createdAt: '2026-11-14T12:00:00.000Z',
  stacksAddress: 'SP1Q6W6VADA7V12SEVH6VNDNN4N7RX1PQ949EQPQ',
  reclaimPublicKey: '51b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2',
  reclaimKeyAddress: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys',
  signersPublicKey: 'd99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69',
  maxSignerFeeSats: 80_000,
  reclaimLockBlocks: 950,
  depositAddress: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
  depositScriptPubKey: '512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e',
  depositScript:
    '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
  reclaimScript: '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
  origin: { chain: 'base', symbol: 'USDC', assetId: 'nep141:base-usdc', decimals: 6 },
  refundTo: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
  quoteResponse: {
    correlationId: 'c',
    timestamp: '2026-11-14T12:00:00.000Z',
    signature: 'sig',
    quoteRequest: {
      dry: false,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: 'nep141:base-usdc',
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: 'nep141:btc.omft.near',
      amount: '25000000',
      refundTo: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
      refundType: 'ORIGIN_CHAIN',
      recipient: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
      recipientType: 'DESTINATION_CHAIN',
      deadline: '2026-11-14T14:00:00.000Z',
    },
    quote: {
      depositAddress: '0x4352589330E4Ab9c40B2eaFBc125F4eeA38e260D',
      amountIn: '25000000',
      amountInFormatted: '25.0',
      amountInUsd: '25',
      minAmountIn: '25000000',
      amountOut: '35617',
      amountOutFormatted: '0.00035617',
      amountOutUsd: '23.6',
      minAmountOut: '35260',
      timeEstimate: 480,
    },
  },
};

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

const backend: Backend = {
  tokens: never,
  quote: never,
  status: never,
  register: never,
};

function render(active: boolean): string {
  return renderToStaticMarkup(
    <Deposit
      backend={backend}
      account={null}
      source={null}
      active={active ? { receipt, receiptUnsaved: false } : null}
      onActive={() => undefined}
      onRoute={() => undefined}
    />
  );
}

describe('Deposit without a connected Stacks wallet', () => {
  it('tracks an active deposit from its receipt alone', () => {
    const html = render(true);
    expect(html).toContain('Deposit in progress');
    expect(html).toContain(receipt.stacksAddress);
    expect(html).toContain(receipt.depositAddress);
  });

  it('shows no deposit form, since a new deposit needs the wallet', () => {
    expect(render(false)).toBe('');
  });
});
