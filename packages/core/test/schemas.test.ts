import { describe, expect, it } from 'vitest';

import {
  type FetchLike,
  HttpError,
  MAINNET_CONFIG,
  OneClickClient,
  ResponseShapeError,
  buildQuoteRequest,
  fetchDeposit,
  fetchLimits,
  fetchVerifiedSigners,
  findPayouts,
  isOutputSpent,
  notifyDeposit,
  oneClickQuoteResponseSchema,
  parseWith,
  providerFeesOf,
  z,
} from '../src/index.js';
import {
  REAL_DEPOSIT as D,
  REAL_DEPOSIT_TX_HEX,
  REGISTRY_RESULT,
  jsonResponse,
} from './fixtures.js';
import {
  REAL_DEPOSIT_TX,
  REAL_DRY_QUOTE,
  REAL_EMILY_DEPOSIT,
  REAL_LIMITS,
  REAL_OUTSPEND,
  REAL_TOKENS,
} from './real-responses.js';

const ONECLICK = 'https://1click.example';

function serve(body: unknown, status = 200): FetchLike {
  return () => Promise.resolve(jsonResponse(body, status));
}

const real = oneClickQuoteResponseSchema.parse(REAL_DRY_QUOTE);

const sent = buildQuoteRequest(MAINNET_CONFIG, {
  originAsset: real.quoteRequest.originAsset,
  amount: real.quoteRequest.amount,
  refundTo: real.quoteRequest.refundTo,
  depositAddress: D.address,
  dry: true,
});

describe('zod configuration', () => {
  it('runs without the eval-based JIT, so it never trips a strict CSP', () => {
    expect(z.config().jitless).toBe(true);
  });
});

describe('real mainnet responses pass and keep every field', () => {
  it('1Click quote, including fields our types do not name', async () => {
    const client = new OneClickClient(ONECLICK, { fetchFn: serve(REAL_DRY_QUOTE) });
    const res = await client.quote(sent);
    expect(res).toEqual(REAL_DRY_QUOTE);
    expect(res.quoteRequest).toMatchObject({ depositMode: 'SIMPLE', insured: false });
    expect(providerFeesOf(sent, res)).toEqual([
      { recipient: '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd', fee: 20 },
    ]);
  });

  it('1Click tokens, with and without a contract address', async () => {
    const client = new OneClickClient(ONECLICK, { fetchFn: serve(REAL_TOKENS) });
    expect(await client.tokens()).toEqual(REAL_TOKENS);
  });

  it('Emily limits and deposit records', async () => {
    expect(await fetchLimits('https://emily.example', serve(REAL_LIMITS))).toEqual(REAL_LIMITS);
    expect(
      await fetchDeposit('https://emily.example', D.txid, 0, serve(REAL_EMILY_DEPOSIT))
    ).toEqual(REAL_EMILY_DEPOSIT);
  });

  it('mempool.space transactions and outspends', async () => {
    const payouts = await findPayouts(
      'https://btc.example',
      D.address,
      D.scriptPubKey,
      serve([REAL_DEPOSIT_TX])
    );
    expect(payouts).toEqual([
      {
        txid: D.txid,
        vout: 0,
        amountSats: D.amountSats,
        confirmed: true,
        blockHeight: D.blockHeight,
      },
    ]);
    expect(await isOutputSpent('https://btc.example', D.txid, 0, serve(REAL_OUTSPEND))).toBe(true);
  });
});

describe('malformed 1Click responses are rejected before any check reads them', () => {
  const quoteCases: [string, unknown][] = [
    ['a body that is not an object', ['not', 'a', 'quote']],
    ['null', null],
    ['a missing quote', { ...real, quote: undefined }],
    ['a numeric amountOut', { ...real, quote: { ...real.quote, amountOut: 36030 } }],
    ['a missing minAmountOut', { ...real, quote: { ...real.quote, minAmountOut: undefined } }],
    ['a string timeEstimate', { ...real, quote: { ...real.quote, timeEstimate: '480' } }],
    ['a numeric depositAddress', { ...real, quote: { ...real.quote, depositAddress: 1 } }],
    ['a missing quoteRequest', { ...real, quoteRequest: undefined }],
    [
      'a non-string recipient',
      { ...real, quoteRequest: { ...real.quoteRequest, recipient: ['bc1p'] } },
    ],
    [
      'a fee given as text',
      { ...real, quoteRequest: { ...real.quoteRequest, appFees: [{ recipient: 'x', fee: '20' }] } },
    ],
    [
      'appFees that is not a list',
      { ...real, quoteRequest: { ...real.quoteRequest, appFees: {} } },
    ],
    ['a missing signature', { ...real, signature: undefined }],
  ];

  it.each(quoteCases)('quote with %s', async (_name, body) => {
    const client = new OneClickClient(ONECLICK, { fetchFn: serve(body) });
    const attempt = client.quote(sent);
    await expect(attempt).rejects.toBeInstanceOf(ResponseShapeError);
    await expect(attempt).rejects.toThrow(
      /^Unexpected data from https:\/\/1click\.example\/v0\/quote:/
    );
  });

  it.each([
    ['an unknown status', { status: 'STOLEN', updatedAt: '', swapDetails: {} }],
    ['no swap details', { status: 'SUCCESS', updatedAt: '' }],
    [
      'tx hashes that are not objects',
      {
        status: 'SUCCESS',
        updatedAt: '',
        swapDetails: { originChainTxHashes: ['0x1'], destinationChainTxHashes: [] },
      },
    ],
  ])('status with %s', async (_name, body) => {
    const client = new OneClickClient(ONECLICK, { fetchFn: serve(body) });
    await expect(client.status('0xabc')).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it('status keeps the fields 1Click adds', async () => {
    const body = {
      correlationId: 'c',
      status: 'SUCCESS',
      updatedAt: '2026-11-14T12:00:00.000Z',
      swapDetails: {
        intentHashes: ['h'],
        originChainTxHashes: [{ hash: '0x1', explorerUrl: 'https://x' }],
        destinationChainTxHashes: [],
      },
    };
    const client = new OneClickClient(ONECLICK, { fetchFn: serve(body) });
    expect(await client.status('0xabc')).toEqual(body);
  });

  it.each([
    ['a token with no price', [{ assetId: 'a', decimals: 6, blockchain: 'base', symbol: 'X' }]],
    ['a token list that is an object', { tokens: [] }],
  ])('tokens with %s', async (_name, body) => {
    const client = new OneClickClient(ONECLICK, { fetchFn: serve(body) });
    await expect(client.tokens()).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe('malformed sBTC and Bitcoin responses are rejected', () => {
  const record = {
    bitcoinTxid: D.txid,
    bitcoinTxOutputIndex: 0,
    recipient: 'x',
    amount: D.amountSats,
    status: 'pending',
    depositScript: D.depositScript,
    reclaimScript: D.reclaimScript,
  };

  it('accepts the rbf status Emily can report', async () => {
    const res = await fetchDeposit(
      'https://emily.example',
      D.txid,
      0,
      serve({ ...record, status: 'rbf' })
    );
    expect(res?.status).toBe('rbf');
  });

  it.each([
    ['an unknown status', { ...record, status: 'minted-maybe' }],
    ['an amount given as text', { ...record, amount: '20000774' }],
    ['no deposit script', { ...record, depositScript: undefined }],
  ])('deposit record with %s', async (_name, body) => {
    await expect(
      fetchDeposit('https://emily.example', D.txid, 0, serve(body))
    ).rejects.toBeInstanceOf(ResponseShapeError);
    await expect(
      notifyDeposit(
        { btcApiUrl: 'https://btc.example', sbtcApiUrl: 'https://emily.example' },
        {
          bitcoinTxid: D.txid,
          bitcoinTxOutputIndex: 0,
          depositScript: D.depositScript,
          reclaimScript: D.reclaimScript,
        },
        url =>
          Promise.resolve(
            url.startsWith('https://btc.example/tx/')
              ? new Response(REAL_DEPOSIT_TX_HEX)
              : jsonResponse(body, 201)
          )
      )
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it('limits with a cap given as text', async () => {
    await expect(
      fetchLimits(
        'https://emily.example',
        serve({ pegCap: '1', perDepositMinimum: 1, perDepositCap: 1 })
      )
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it('a transaction whose output value is text', async () => {
    const tx = {
      txid: D.txid,
      vout: [{ scriptpubkey: D.scriptPubKey, value: '1' }],
      status: { confirmed: true },
    };
    await expect(
      findPayouts('https://btc.example', D.address, D.scriptPubKey, serve([tx]))
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it('an outspend with no spent flag', async () => {
    await expect(isOutputSpent('https://btc.example', D.txid, 0, serve({}))).rejects.toBeInstanceOf(
      ResponseShapeError
    );
  });

  function signerWorld(over: {
    registry?: unknown;
    deposits?: unknown;
    outspend?: unknown;
  }): FetchLike {
    return url => {
      if (url.includes('/v2/contracts/call-read/'))
        return Promise.resolve(
          jsonResponse(over.registry ?? { okay: true, result: REGISTRY_RESULT })
        );
      if (url.includes('/deposit?status=confirmed'))
        return Promise.resolve(
          jsonResponse(
            over.deposits ?? {
              deposits: [
                {
                  bitcoinTxid: 'aa'.repeat(32),
                  bitcoinTxOutputIndex: 1,
                  depositScript: D.depositScript,
                },
              ],
            }
          )
        );
      if (url.endsWith('/blocks/tip/height')) return Promise.resolve(new Response('975805'));
      return Promise.resolve(
        jsonResponse(
          over.outspend ?? { spent: true, status: { confirmed: true, block_height: 975800 } }
        )
      );
    };
  }

  it('signer verification passes with well-formed answers', async () => {
    const res = await fetchVerifiedSigners(MAINNET_CONFIG, { fetchFn: signerWorld({}) });
    expect(res.signersPublicKey).toBe(D.signersPublicKey);
  });

  it.each([
    ['a registry answer with no okay flag', { registry: { result: REGISTRY_RESULT } }],
    ['a registry result that is not text', { registry: { okay: true, result: 42 } }],
    ['a deposit list that is not a list', { deposits: { deposits: 'none' } }],
    [
      'a deposit with a text output index',
      {
        deposits: {
          deposits: [
            { bitcoinTxid: 'aa', bitcoinTxOutputIndex: '1', depositScript: D.depositScript },
          ],
        },
      },
    ],
    [
      'an outspend flag given as text',
      { outspend: { spent: 'yes', status: { confirmed: true, block_height: 1 } } },
    ],
  ])('signer verification refuses %s', async (_name, over) => {
    await expect(
      fetchVerifiedSigners(MAINNET_CONFIG, { fetchFn: signerWorld(over) })
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe('ResponseShapeError', () => {
  it('names the endpoint without its query and does not echo the payload', async () => {
    const client = new OneClickClient(ONECLICK, {
      fetchFn: serve({
        status: 'SECRET-PAYLOAD-VALUE',
        updatedAt: 'SECRET-2',
        swapDetails: 'SECRET-3',
      }),
    });
    const err: unknown = await client.status('0xabc', 'memo').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResponseShapeError);
    const message = err instanceof Error ? err.message : '';
    expect(message).toMatch(/^Unexpected data from https:\/\/1click\.example\/v0\/status: /);
    expect(message).not.toMatch(/SECRET|depositAddress|memo|0xabc/);
  });

  it('lists at most three problems', () => {
    const schema = z.looseObject({
      a: z.string(),
      b: z.string(),
      c: z.string(),
      d: z.string(),
      e: z.string(),
    });
    expect(() => parseWith(schema, {}, 'a test')).toThrow(
      /^Unexpected data from a test: a: .*; b: .*; c: .* \(\+2 more\)$/
    );
  });

  it('keeps non-JSON bodies an HTTP error, as before', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(new Response('<html>oops</html>'));
    }
    await expect(fetchLimits('https://emily.example', fetchFn)).rejects.toBeInstanceOf(HttpError);
  });
});
