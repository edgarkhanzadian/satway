import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickSwapStatus,
  type OneClickToken,
  MAINNET_CONFIG as config,
} from '@stxonector/core';

import { createBackend } from '../src/backend.js';
import { type Backend, checkProgress, prepareDeposit, toBaseUnits } from '../src/flow.js';
import { type Receipt, verifyReceipt } from '../src/receipt.js';
import { pickAccount } from '../src/wallet.js';

const D = {
  txid: '5ab7ae554358d3ffdab7cc48db49ff144c5ae4fdd617b4140eac1b1936109bf5',
  stacksAddress: 'SP1Q6W6VADA7V12SEVH6VNDNN4N7RX1PQ949EQPQ',
  reclaimPublicKey: '51b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2',
  signersPublicKey: 'd99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69',
  address: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
  scriptPubKey: '512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e',
  depositScript:
    '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
  reclaimScript: '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
};
const TIP = 975_805;
const NOW = new Date('2026-11-14T12:00:00.000Z');
const USDC: OneClickToken = {
  assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  decimals: 6,
  blockchain: 'base',
  symbol: 'USDC',
  price: 1,
};
const input = {
  stacksAddress: D.stacksAddress,
  reclaimPublicKey: D.reclaimPublicKey,
  reclaimKeyAddress: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys',
  token: USDC,
  amount: '25',
  refundTo: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function emilyDeposit(status: string) {
  return {
    bitcoinTxid: D.txid,
    bitcoinTxOutputIndex: 0,
    recipient: '0x051a' + 'ab'.repeat(20),
    amount: 35_500,
    status,
    statusMessage: '',
    reclaimScript: D.reclaimScript,
    depositScript: D.depositScript,
  };
}

function later<T>(make: () => T): Promise<T> {
  return new Promise(resolve => resolve(make()));
}

function bodyJson(init: RequestInit): unknown {
  if (typeof init.body !== 'string') throw new Error('Expected a string body');
  const parsed: unknown = JSON.parse(init.body);
  return parsed;
}

interface World {
  minOut?: string;
  rewrite?: Partial<OneClickQuoteRequest>;
  swap?: OneClickSwapStatus;
  payoutVout?: number | null;
  mint?: string | null;
  signerKey?: string;
}

function world(w: World = {}) {
  const posts: { url: string; body: unknown }[] = [];
  const quotes: OneClickQuoteRequest[] = [];
  const registered: string[] = [];
  let mint = w.mint ?? null;

  function fetchFn(url: string, init?: RequestInit): Promise<Response> {
    return later(() => route(url, init));
  }

  function route(url: string, init?: RequestInit): Response {
    if (url.includes('/v2/contracts/call-read/')) {
      return jsonRes({
        okay: true,
        result: '0x020000002102' + (w.signerKey ?? D.signersPublicKey),
      });
    }
    if (url.includes('/deposit?status=confirmed')) {
      return jsonRes({
        deposits: [
          { bitcoinTxid: 'aa'.repeat(32), bitcoinTxOutputIndex: 1, depositScript: D.depositScript },
        ],
      });
    }
    if (url.endsWith('/blocks/tip/height')) return new Response(String(TIP));
    if (url.includes('/outspend/'))
      return jsonRes({ spent: true, status: { confirmed: true, block_height: TIP - 1 } });
    if (url.endsWith('/limits'))
      return jsonRes({ pegCap: null, perDepositMinimum: 10_000, perDepositCap: null });
    if (url.includes('/address/')) {
      if (w.payoutVout == null) return jsonRes([]);
      const other = { scriptpubkey: '0014' + '11'.repeat(20), value: 1 };
      const vout = [
        ...Array.from({ length: w.payoutVout }, () => other),
        { scriptpubkey: D.scriptPubKey, value: 35_500 },
      ];
      return jsonRes([{ txid: D.txid, vout, status: { confirmed: true, block_height: TIP - 2 } }]);
    }
    if (url.endsWith('/deposit') && init?.method === 'POST') {
      posts.push({ url, body: bodyJson(init) });
      mint = 'pending';
      return jsonRes(emilyDeposit('pending'), 201);
    }
    if (url.includes('/deposit/'))
      return mint ? jsonRes(emilyDeposit(mint)) : jsonRes({ message: 'nope' }, 404);
    throw new Error(`unexpected url ${url}`);
  }

  const backend: Backend = {
    tokens: () => later(() => [USDC]),
    quote(request) {
      return later(() => quote(request));
    },
    status() {
      return later(() => {
        if (!w.swap) throw new Error('not found');
        return {
          status: w.swap,
          updatedAt: '',
          swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] },
        };
      });
    },
    register(depositScript) {
      return later(() => {
        registered.push(depositScript);
        return { address: D.address };
      });
    },
  };

  function quote(request: OneClickQuoteRequest): OneClickQuoteResponse {
    quotes.push(request);
    return {
      correlationId: 'c',
      timestamp: NOW.toISOString(),
      signature: 'sig',
      quoteRequest: { ...request, ...w.rewrite },
      quote: {
        depositAddress: request.dry ? undefined : '0x4352589330E4Ab9c40B2eaFBc125F4eeA38e260D',
        amountIn: request.amount,
        amountInFormatted: '25.0',
        amountInUsd: '25',
        minAmountIn: request.amount,
        amountOut: '35617',
        amountOutFormatted: '0.00035617',
        amountOutUsd: '23.6',
        minAmountOut: w.minOut ?? '35260',
        timeEstimate: 480,
        withdrawFee: '1900',
      },
    };
  }
  return { fetchFn, backend, posts, quotes, registered };
}

async function receiptFor(w: ReturnType<typeof world>): Promise<Receipt> {
  return (
    await prepareDeposit(config, w.backend, input, { dry: false, fetchFn: w.fetchFn, now: NOW })
  ).receipt;
}

describe('toBaseUnits', () => {
  it.each([
    ['25', 6, '25000000'],
    ['0.01', 18, '10000000000000000'],
    ['1.5', 6, '1500000'],
    [' 7 ', 0, '7'],
    ['0.000001', 6, '1'],
  ])('%s with %i decimals -> %s', (amount, decimals, expected) => {
    expect(toBaseUnits(amount, decimals)).toBe(expected);
  });

  it.each(['', '0', '0.0', '-1', '1e3', '1,5', 'abc', '1.0000001'])('rejects %j', amount => {
    expect(() => toBaseUnits(amount, 6)).toThrow();
  });
});

describe('prepareDeposit', () => {
  it('builds the address locally and asks only for a quote that pays it', async () => {
    const w = world();
    const prepared = await prepareDeposit(config, w.backend, input, {
      dry: false,
      fetchFn: w.fetchFn,
      now: NOW,
    });
    expect(prepared.receipt.depositAddress).toBe(D.address);
    expect(prepared.receipt.depositScript).toBe(D.depositScript);
    expect(prepared.receipt.reclaimScript).toBe(D.reclaimScript);
    expect(w.quotes[0]).toMatchObject({
      recipient: D.address,
      refundTo: input.refundTo,
      amount: '25000000',
      destinationAsset: config.btcAssetId,
    });
    expect(prepared).toMatchObject({
      expectedSats: 35_617,
      minimumSats: 35_260,
      providerFeeBps: 0,
      withdrawFeeSats: 1_900,
    });
    expect(prepared.warnings).toHaveLength(1);
    expect(() => verifyReceipt(JSON.parse(JSON.stringify(prepared.receipt)))).not.toThrow();
  });

  it('refuses a quote whose recipient was rewritten on the way back', async () => {
    const w = world({ rewrite: { recipient: 'bc1pattacker' } });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).rejects.toThrow(/recipient/);
  });

  it('refuses a quote with a fee recipient we did not set', async () => {
    const w = world({ rewrite: { appFees: [{ recipient: 'thief.near', fee: 300 }] } });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).rejects.toThrow(/appFees/);
  });

  it('refuses when the swap could deliver less than sBTC accepts', async () => {
    const w = world({ minOut: '9999' });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).rejects.toThrow(/too small/);
  });

  it('never asks for a quote if the signer key cannot be verified', async () => {
    const w = world({ signerKey: 'ab'.repeat(32) });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).rejects.toThrow(/refusing/);
    expect(w.quotes).toHaveLength(0);
  });

  it('never asks for a quote for a bad recipient', async () => {
    const w = world();
    await expect(
      prepareDeposit(
        config,
        w.backend,
        { ...input, stacksAddress: 'ST000000000000000000002AMW42H' },
        { dry: true, fetchFn: w.fetchFn }
      )
    ).rejects.toThrow();
    expect(w.quotes).toHaveLength(0);
  });
});

describe('checkProgress', () => {
  it('waits for funds before anything arrives', async () => {
    const w = world({ swap: 'PENDING_DEPOSIT' });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.progress.stage).toBe('awaiting-funds');
    expect(w.posts).toHaveLength(0);
  });

  it('registers the payout with the signers, using the output index found on chain', async () => {
    const w = world({ swap: 'SUCCESS', payoutVout: 2 });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(w.posts).toEqual([
      {
        url: 'https://sbtc-emily.com/deposit',
        body: {
          bitcoinTxid: D.txid,
          bitcoinTxOutputIndex: 2,
          depositScript: D.depositScript,
          reclaimScript: D.reclaimScript,
        },
      },
    ]);
    expect(snap.progress.stage).toBe('minting');
    expect(snap.payout).toMatchObject({ vout: 2, amountSats: 35_500 });
  });

  it('still finds and registers the payout when the provider status is unavailable', async () => {
    const w = world({ payoutVout: 0 });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.swap).toBeNull();
    expect(w.posts).toHaveLength(1);
  });

  it('does not register twice', async () => {
    const w = world({ swap: 'SUCCESS', payoutVout: 0, mint: 'accepted' });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(w.posts).toHaveLength(0);
    expect(snap.progress.stage).toBe('minting');
  });

  it('reports completion once the mint is confirmed', async () => {
    const w = world({ swap: 'SUCCESS', payoutVout: 0, mint: 'confirmed' });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.progress).toMatchObject({ stage: 'done', terminal: true });
  });

  it('reports a refund', async () => {
    const w = world({ swap: 'REFUNDED' });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.progress).toMatchObject({ stage: 'refunded', terminal: true });
  });
});

describe('verifyReceipt', () => {
  it.each([
    ['recipient', { stacksAddress: 'SP000000000000000000002Q6VF78' }],
    [
      'deposit address',
      { depositAddress: 'bc1pvpxx0hgam7hwff9g63rer098vzqetvau4dmy9s3h9szq56zt77jsfhk2l6' },
    ],
    ['reclaim key', { reclaimPublicKey: 'aa'.repeat(32) }],
    ['signer key', { signersPublicKey: 'bb'.repeat(32) }],
    ['timelock', { reclaimLockBlocks: 10 }],
    ['reclaim script', { reclaimScript: D.reclaimScript.replace('02b603', '02b703') }],
  ])('rejects a receipt whose %s was edited', async (_name, change) => {
    const w = world();
    const receipt = await receiptFor(w);
    expect(() => verifyReceipt({ ...receipt, ...change })).toThrow();
  });

  it('rejects a receipt whose quote pays another address', async () => {
    const w = world();
    const receipt = await receiptFor(w);
    const forged = structuredClone(receipt);
    forged.quoteResponse.quoteRequest.recipient = 'bc1pattacker';
    expect(() => verifyReceipt(forged)).toThrow(/different address/);
  });

  it.each([null, 'x', {}, { version: 2 }])('rejects %j', value => {
    expect(() => verifyReceipt(value)).toThrow();
  });

  it.each([
    ['a wrong version', { version: 2, stacksAddress: '' }, /^Unsupported receipt version$/],
    ['an empty stacks address', { stacksAddress: '' }, /^Receipt is missing "stacksAddress"$/],
    [
      'a missing deposit script',
      { depositScript: undefined },
      /^Receipt is missing "depositScript"$/,
    ],
    [
      'a fee cap given as text',
      { maxSignerFeeSats: '80000' },
      /^Receipt is missing its fee cap or timelock$/,
    ],
    ['no quote', { quoteResponse: undefined }, /receipt file: quoteResponse/],
    ['no origin', { origin: undefined }, /receipt file: origin/],
    ['no creation date', { createdAt: undefined }, /receipt file: createdAt/],
  ])(
    'rejects a receipt with %s, with the same message as before',
    async (_name, change, message) => {
      const receipt = await receiptFor(world());
      expect(() => verifyReceipt({ ...receipt, ...change })).toThrow(message);
    }
  );

  it('rejects a receipt whose stored quote is malformed', async () => {
    const receipt = await receiptFor(world());
    const broken = {
      ...receipt,
      quoteResponse: {
        ...receipt.quoteResponse,
        quote: { ...receipt.quoteResponse.quote, amountIn: 1 },
      },
    };
    expect(() => verifyReceipt(broken)).toThrow(/receipt file: quoteResponse\.quote\.amountIn/);
  });
});

describe('quote -> receipt -> verifyReceipt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps every field the provider adds, through the backend, the receipt file and verification', async () => {
    const w = world();
    const http = createBackend('https://api.example');
    let asked: OneClickQuoteRequest | null = null;
    const backend: Backend = {
      ...w.backend,
      quote(request) {
        asked = request;
        return http.quote(request);
      },
    };
    vi.stubGlobal('fetch', async () => {
      if (!asked) throw new Error('no quote was requested');
      const plain = await w.backend.quote(asked);
      const withExtras = {
        ...plain,
        providerTrace: { region: 'eu', hops: [1, 2] },
        quote: { ...plain.quote, quoteTier: 'gold', insured: true },
        quoteRequest: {
          ...plain.quoteRequest,
          depositMode: 'SIMPLE',
          confidentiality: 'public',
          appFees: [{ recipient: 'provider', fee: 20, kind: 'keyless' }],
        },
      };
      return jsonRes(withExtras);
    });

    const prepared = await prepareDeposit(config, backend, input, {
      dry: false,
      fetchFn: w.fetchFn,
      now: NOW,
    });
    expect(prepared.providerFeeBps).toBe(20);
    const file: unknown = JSON.parse(JSON.stringify(prepared.receipt));
    const verified = verifyReceipt(file);
    expect(verified).toEqual(file);
    expect(verified).toEqual(prepared.receipt);
    expect(verified.quoteResponse).toMatchObject({
      providerTrace: { region: 'eu', hops: [1, 2] },
      quote: { quoteTier: 'gold', insured: true },
      quoteRequest: {
        depositMode: 'SIMPLE',
        confidentiality: 'public',
        appFees: [{ recipient: 'provider', fee: 20, kind: 'keyless' }],
      },
    });
    expect(verifyReceipt(JSON.parse(JSON.stringify(verified)))).toEqual(file);
  });
});

describe('pickAccount', () => {
  const stx = { address: D.stacksAddress, publicKey: '02' + 'cc'.repeat(32) };
  const payment = {
    address: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys',
    publicKey: '03' + D.reclaimPublicKey,
  };
  const taproot = { address: D.address, publicKey: 'dd'.repeat(32) };

  it('uses the Stacks address and the payment key', () => {
    expect(pickAccount([taproot, payment, stx])).toEqual({
      stacksAddress: D.stacksAddress,
      reclaimPublicKey: D.reclaimPublicKey,
      reclaimKeyAddress: payment.address,
    });
  });

  it('falls back to the taproot key', () => {
    expect(pickAccount([stx, taproot]).reclaimKeyAddress).toBe(D.address);
  });

  it('refuses a testnet wallet or one with no Bitcoin key', () => {
    expect(() =>
      pickAccount([{ address: 'ST000000000000000000002AMW42H', publicKey: 'x' }, payment])
    ).toThrow();
    expect(() => pickAccount([stx])).toThrow();
    expect(() => pickAccount([payment])).toThrow();
  });
});
