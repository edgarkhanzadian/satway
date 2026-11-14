import { describe, expect, it } from 'vitest';

import {
  type BtcTx,
  HttpError,
  fetchDeposit,
  fetchTransactionHex,
  findPayouts,
  notifyDeposit,
  payoutsInTx,
  verifyDepositTransaction,
} from '../src/index.js';
import {
  REAL_DEPOSIT as D,
  OTHER_TX,
  REAL_DEPOSIT_TX_HEX,
  defined,
  jsonBody,
  jsonResponse,
} from './fixtures.js';

const realTx: BtcTx = {
  txid: D.txid,
  vout: [
    { scriptpubkey: D.scriptPubKey, value: D.amountSats },
    { scriptpubkey: D.changeScriptPubKey, value: 2764 },
  ],
  status: { confirmed: true, block_height: D.blockHeight },
};

describe('payoutsInTx', () => {
  it('finds the deposit output in the real transaction', () => {
    expect(payoutsInTx(realTx, D.scriptPubKey)).toEqual([
      {
        txid: D.txid,
        vout: 0,
        amountSats: D.amountSats,
        confirmed: true,
        blockHeight: D.blockHeight,
      },
    ]);
  });

  it('finds the output wherever the provider puts it', () => {
    const batched: BtcTx = {
      txid: 'ab'.repeat(32),
      vout: [
        { scriptpubkey: '0014' + '11'.repeat(20), value: 5_000 },
        { scriptpubkey: '0014' + '22'.repeat(20), value: 6_000 },
        { scriptpubkey: D.scriptPubKey.toUpperCase(), value: 37_000 },
        { scriptpubkey: '0014' + '33'.repeat(20), value: 7_000 },
      ],
      status: { confirmed: false },
    };
    expect(payoutsInTx(batched, D.scriptPubKey)).toEqual([
      { txid: batched.txid, vout: 2, amountSats: 37_000, confirmed: false, blockHeight: null },
    ]);
  });

  it('returns nothing for a transaction that does not pay us', () => {
    expect(payoutsInTx(realTx, '5120' + 'ff'.repeat(32))).toEqual([]);
  });

  it('reports each matching output separately', () => {
    const first = defined(realTx.vout[0]);
    const twice: BtcTx = { ...realTx, vout: [first, first] };
    expect(payoutsInTx(twice, D.scriptPubKey).map(p => p.vout)).toEqual([0, 1]);
  });
});

describe('findPayouts', () => {
  it('queries by address and filters by script', async () => {
    let url = '';
    function fetchFn(u: string): Promise<Response> {
      url = u;
      return Promise.resolve(
        jsonResponse([realTx, { ...realTx, txid: 'cd'.repeat(32), vout: [realTx.vout[1]] }])
      );
    }
    const payouts = await findPayouts('https://btc.example', D.address, D.scriptPubKey, fetchFn);
    expect(url).toBe(`https://btc.example/address/${D.address}/txs`);
    expect(payouts).toHaveLength(1);
  });
});

describe('fetchTransactionHex', () => {
  it('reads the raw transaction from the Bitcoin API', async () => {
    let url = '';
    function fetchFn(u: string): Promise<Response> {
      url = u;
      return Promise.resolve(new Response(`${REAL_DEPOSIT_TX_HEX}\n`));
    }
    expect(await fetchTransactionHex('https://btc.example', D.txid, fetchFn)).toBe(
      REAL_DEPOSIT_TX_HEX
    );
    expect(url).toBe(`https://btc.example/tx/${D.txid}/hex`);
  });

  it('rejects a response that is not hex', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(new Response('<html>oops</html>'));
    }
    await expect(fetchTransactionHex('https://btc.example', D.txid, fetchFn)).rejects.toThrow(
      /non-hex/
    );
  });

  it('propagates HTTP failures', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(new Response('Transaction not found', { status: 404 }));
    }
    await expect(
      fetchTransactionHex('https://btc.example', D.txid, fetchFn)
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('refuses to build a URL from something that is not a txid', async () => {
    function fetchFn(): Promise<Response> {
      throw new Error('should not be called');
    }
    await expect(fetchTransactionHex('https://btc.example', '../x', fetchFn)).rejects.toThrow(
      /Not a Bitcoin txid/
    );
  });
});

describe('verifyDepositTransaction', () => {
  const expected = {
    txid: D.txid,
    vout: 0,
    depositScript: D.depositScript,
    reclaimScript: D.reclaimScript,
  };

  it('accepts the real deposit transaction', () => {
    expect(() => verifyDepositTransaction(REAL_DEPOSIT_TX_HEX, expected)).not.toThrow();
  });

  it('accepts upper-case hex and an upper-case txid', () => {
    expect(() =>
      verifyDepositTransaction(REAL_DEPOSIT_TX_HEX.toUpperCase(), {
        ...expected,
        txid: D.txid.toUpperCase(),
      })
    ).not.toThrow();
  });

  it('rejects a different transaction', () => {
    expect(() => verifyDepositTransaction(OTHER_TX.hex, expected)).toThrow(
      new RegExp(`has txid ${OTHER_TX.txid}`)
    );
  });

  it('rejects an output index the transaction does not have', () => {
    expect(() => verifyDepositTransaction(REAL_DEPOSIT_TX_HEX, { ...expected, vout: 2 })).toThrow(
      /has no output 2/
    );
  });

  it('rejects an output that pays something else', () => {
    expect(() => verifyDepositTransaction(REAL_DEPOSIT_TX_HEX, { ...expected, vout: 1 })).toThrow(
      /does not pay the deposit address/
    );
  });

  it('rejects an output when the scripts describe another deposit address', () => {
    const otherReclaim = D.reclaimScript.replace(/^02b603/, '02b703');
    expect(() =>
      verifyDepositTransaction(REAL_DEPOSIT_TX_HEX, { ...expected, reclaimScript: otherReclaim })
    ).toThrow(/does not pay the deposit address/);
  });

  it.each([
    ['truncated', REAL_DEPOSIT_TX_HEX.slice(0, -10)],
    ['with trailing bytes', `${REAL_DEPOSIT_TX_HEX}00`],
    ['not hex at all', 'zz'],
    ['empty', ''],
  ])('rejects transaction data that is %s', (_name, data) => {
    expect(() => verifyDepositTransaction(data, expected)).toThrow(/does not parse/);
  });
});

describe('emily', () => {
  const body = {
    bitcoinTxid: D.txid,
    bitcoinTxOutputIndex: 0,
    depositScript: D.depositScript,
    reclaimScript: D.reclaimScript,
  };
  const endpoints = { btcApiUrl: 'https://btc.example', sbtcApiUrl: 'https://emily.example' };
  const record = { ...body, recipient: 'x', amount: D.amountSats, status: 'pending' };

  function chain(txHex: string, emily: (init?: RequestInit) => Response) {
    const posts: unknown[] = [];
    function fetchFn(u: string, init?: RequestInit): Promise<Response> {
      if (u === `https://btc.example/tx/${D.txid}/hex`) {
        return Promise.resolve(new Response(txHex));
      }
      if (init?.method === 'POST') posts.push(jsonBody(init));
      return Promise.resolve(emily(init));
    }
    return { fetchFn, posts };
  }

  it('posts the deposit with the scripts, output index and raw transaction', async () => {
    const { fetchFn, posts } = chain(REAL_DEPOSIT_TX_HEX, () => jsonResponse(record, 201));
    const res = await notifyDeposit(endpoints, body, fetchFn);
    expect(posts).toEqual([{ ...body, transactionHex: REAL_DEPOSIT_TX_HEX }]);
    expect(res.status).toBe('pending');
  });

  it('sends only the fields Emily expects', async () => {
    const { fetchFn, posts } = chain(REAL_DEPOSIT_TX_HEX, () => jsonResponse(record, 201));
    const withExtra = { ...body, extra: 'dropped' };
    await notifyDeposit(endpoints, withExtra, fetchFn);
    const sent = defined(posts[0]);
    expect(typeof sent === 'object' && sent !== null ? Object.keys(sent) : []).toEqual([
      'bitcoinTxid',
      'bitcoinTxOutputIndex',
      'depositScript',
      'reclaimScript',
      'transactionHex',
    ]);
  });

  it('accepts the 200 Emily returns for a deposit it already has', async () => {
    const { fetchFn } = chain(REAL_DEPOSIT_TX_HEX, () =>
      jsonResponse({ ...record, status: 'accepted' }, 200)
    );
    expect((await notifyDeposit(endpoints, body, fetchFn)).status).toBe('accepted');
  });

  it('treats an already-registered deposit as success', async () => {
    const { fetchFn } = chain(REAL_DEPOSIT_TX_HEX, init =>
      init?.method === 'POST'
        ? jsonResponse({ message: 'conflict' }, 409)
        : jsonResponse({ ...record, status: 'accepted' })
    );
    const res = await notifyDeposit(endpoints, body, fetchFn);
    expect(res.status).toBe('accepted');
  });

  it('propagates other failures', async () => {
    const { fetchFn } = chain(REAL_DEPOSIT_TX_HEX, () =>
      jsonResponse({ message: 'bad script' }, 400)
    );
    await expect(notifyDeposit(endpoints, body, fetchFn)).rejects.toThrow(/bad script/);
  });

  it.each([
    ['the wrong transaction', OTHER_TX.hex, body, /has txid/],
    ['a missing output', REAL_DEPOSIT_TX_HEX, { ...body, bitcoinTxOutputIndex: 5 }, /no output 5/],
    [
      'an output paying something else',
      REAL_DEPOSIT_TX_HEX,
      { ...body, bitcoinTxOutputIndex: 1 },
      /does not pay/,
    ],
    ['unparseable data', 'deadbeef', body, /does not parse/],
  ])('posts nothing when the Bitcoin API returns %s', async (_name, txHex, input, message) => {
    const { fetchFn, posts } = chain(txHex, () => jsonResponse(record, 201));
    await expect(notifyDeposit(endpoints, input, fetchFn)).rejects.toThrow(message);
    expect(posts).toEqual([]);
  });

  it('posts nothing when the raw transaction cannot be fetched', async () => {
    const posts: unknown[] = [];
    function fetchFn(u: string, init?: RequestInit): Promise<Response> {
      if (init?.method === 'POST') posts.push(u);
      return Promise.resolve(new Response('Transaction not found', { status: 404 }));
    }
    await expect(notifyDeposit(endpoints, body, fetchFn)).rejects.toBeInstanceOf(HttpError);
    expect(posts).toEqual([]);
  });

  it('fetchDeposit returns null when unknown', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(jsonResponse({ message: 'not found' }, 404));
    }
    expect(await fetchDeposit('https://emily.example', D.txid, 0, fetchFn)).toBeNull();
  });
});
