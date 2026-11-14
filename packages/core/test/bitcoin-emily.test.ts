import { describe, expect, it } from 'vitest';

import { type BtcTx, fetchDeposit, findPayouts, notifyDeposit, payoutsInTx } from '../src/index.js';
import { REAL_DEPOSIT as D, defined, jsonBody, jsonResponse } from './fixtures.js';

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

describe('emily', () => {
  const body = {
    bitcoinTxid: D.txid,
    bitcoinTxOutputIndex: 0,
    depositScript: D.depositScript,
    reclaimScript: D.reclaimScript,
  };
  const record = { ...body, recipient: 'x', amount: D.amountSats, status: 'pending' };

  it('posts the deposit with the scripts and output index', async () => {
    let sent: unknown;
    function fetchFn(_u: string, init?: RequestInit): Promise<Response> {
      sent = jsonBody(init);
      return Promise.resolve(jsonResponse(record, 201));
    }
    const res = await notifyDeposit('https://emily.example', body, fetchFn);
    expect(sent).toEqual(body);
    expect(res.status).toBe('pending');
  });

  it('treats an already-registered deposit as success', async () => {
    function fetchFn(u: string, init?: RequestInit): Promise<Response> {
      return Promise.resolve(
        init?.method === 'POST'
          ? jsonResponse({ message: 'conflict' }, 409)
          : jsonResponse({ ...record, status: 'accepted', url: u })
      );
    }
    const res = await notifyDeposit('https://emily.example', body, fetchFn);
    expect(res.status).toBe('accepted');
  });

  it('propagates other failures', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(jsonResponse({ message: 'bad script' }, 400));
    }
    await expect(notifyDeposit('https://emily.example', body, fetchFn)).rejects.toThrow(
      /bad script/
    );
  });

  it('fetchDeposit returns null when unknown', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(jsonResponse({ message: 'not found' }, 404));
    }
    expect(await fetchDeposit('https://emily.example', D.txid, 0, fetchFn)).toBeNull();
  });
});
