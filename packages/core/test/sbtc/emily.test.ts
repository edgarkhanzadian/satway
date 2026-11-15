import { describe, expect, it } from 'vitest';

import {
  DepositCheckError,
  HttpError,
  classifyRegistrationError,
  fetchDeposit,
  notifyDeposit,
  verifyDepositTransaction,
} from '../../src/index.js';
import {
  REAL_DEPOSIT as D,
  OTHER_TX,
  REAL_DEPOSIT_TX_HEX,
  defined,
  jsonBody,
  jsonResponse,
} from '../fixtures.js';

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

  it('throws a DepositCheckError so callers can tell a failed check from a network error', () => {
    expect(() => verifyDepositTransaction(OTHER_TX.hex, expected)).toThrow(DepositCheckError);
  });
});

describe('classifyRegistrationError', () => {
  const EMILY = 'https://sbtc-emily.com';

  it('treats a refusal from the signers’ API as a rejection', () => {
    expect(
      classifyRegistrationError(new HttpError(400, `${EMILY}/deposit`, 'bad hex'), EMILY)
    ).toEqual({
      kind: 'rejected',
      status: 400,
      message: `HTTP 400 from ${EMILY}/deposit: bad hex`,
    });
  });

  it('treats a failed local transaction check as a rejection', () => {
    expect(classifyRegistrationError(new DepositCheckError('has txid x'), EMILY)).toEqual({
      kind: 'rejected',
      status: null,
      message: 'has txid x',
    });
  });

  it.each([
    ['a server error from the signers’ API', new HttpError(503, `${EMILY}/deposit`, 'down'), 503],
    ['rate limiting', new HttpError(429, `${EMILY}/deposit`, 'slow down'), 429],
    [
      'a 4xx from the Bitcoin API',
      new HttpError(404, 'https://mempool.space/api/tx/x/hex', ''),
      404,
    ],
    ['a network error', new TypeError('Failed to fetch'), null],
  ])('treats %s as transient', (_name, err, status) => {
    expect(classifyRegistrationError(err, EMILY)).toMatchObject({ kind: 'transient', status });
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
