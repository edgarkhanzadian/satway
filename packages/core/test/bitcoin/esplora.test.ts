import { describe, expect, it } from 'vitest';

import {
  type BtcTx,
  HttpError,
  TooManyOutputsError,
  fetchAddressHistory,
  fetchAddressTxCount,
  fetchDepositOutputs,
  fetchTransactionHex,
  fetchUnspentOutputs,
  payoutsInTx,
} from '../../src/index.js';
import { fakeEsplora, txidOf } from '../fake-esplora.js';
import { REAL_DEPOSIT as D, REAL_DEPOSIT_TX_HEX, defined, jsonResponse } from '../fixtures.js';
import { REAL_UNUSED_ADDRESS_STATS, REAL_USED_ADDRESS_STATS } from '../real-responses.js';

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

describe('fetchUnspentOutputs', () => {
  it('lists unspent outputs at the address, all marked unspent', async () => {
    const esplora = fakeEsplora({
      address: D.address,
      spk: D.scriptPubKey,
      txs: [
        { txid: txidOf(1), outputs: [{ spk: D.scriptPubKey, value: 546 }], confirmed: false },
        {
          txid: txidOf(2),
          outputs: [{ spk: D.scriptPubKey, value: 40_000 }],
          confirmed: true,
          height: 900,
          time: 1_700_000_000,
        },
        {
          txid: txidOf(3),
          outputs: [{ spk: D.scriptPubKey, value: 9, spent: true }],
          confirmed: true,
          height: 800,
        },
      ],
    });
    const utxos = await fetchUnspentOutputs('https://btc.example', D.address, esplora.fetchFn);
    expect(esplora.urls).toEqual([`https://btc.example/address/${D.address}/utxo`]);
    expect(utxos).toEqual([
      {
        txid: txidOf(1),
        vout: 0,
        amountSats: 546,
        confirmed: false,
        blockHeight: null,
        blockTime: null,
        spent: false,
      },
      {
        txid: txidOf(2),
        vout: 0,
        amountSats: 40_000,
        confirmed: true,
        blockHeight: 900,
        blockTime: 1_700_000_000,
        spent: false,
      },
    ]);
  });

  it('turns the "too many unspent outputs" refusal into an explicit error, not an empty list', async () => {
    const esplora = fakeEsplora({
      address: D.address,
      spk: D.scriptPubKey,
      txs: [],
      tooManyUtxos: true,
    });
    await expect(
      fetchUnspentOutputs('https://btc.example', D.address, esplora.fetchFn)
    ).rejects.toBeInstanceOf(TooManyOutputsError);
  });
});

function busyAddress(count: number, payoutAt: number) {
  const other = '0014' + '11'.repeat(20);
  return Array.from({ length: count }, (_, i) => ({
    txid: txidOf(i + 1),
    outputs: [{ spk: i === payoutAt ? D.scriptPubKey : other, value: i === payoutAt ? 40_000 : 1 }],
    confirmed: true,
    height: 100_000 - i,
  }));
}

describe('fetchAddressHistory', () => {
  it('pages the confirmed history with the last seen txid until a short page', async () => {
    const esplora = fakeEsplora({
      address: D.address,
      spk: D.scriptPubKey,
      txs: busyAddress(60, 57),
    });
    const history = await fetchAddressHistory('https://btc.example', D.address, D.scriptPubKey, {
      fetchFn: esplora.fetchFn,
    });
    const base = `https://btc.example/address/${D.address}/txs`;
    expect(esplora.urls).toEqual([
      `${base}/mempool`,
      `${base}/chain`,
      `${base}/chain/${txidOf(25)}`,
      `${base}/chain/${txidOf(50)}`,
    ]);
    expect(history.outputs.map(o => o.txid)).toEqual([txidOf(58)]);
    expect(history).toMatchObject({ truncated: false, requests: 4 });
  });

  it('stops at the page cap and says the list is truncated', async () => {
    const esplora = fakeEsplora({
      address: D.address,
      spk: D.scriptPubKey,
      txs: busyAddress(100, 90),
    });
    const history = await fetchAddressHistory('https://btc.example', D.address, D.scriptPubKey, {
      maxPages: 2,
      fetchFn: esplora.fetchFn,
    });
    expect(history.truncated).toBe(true);
    expect(history.outputs).toEqual([]);
    expect(esplora.urls).toHaveLength(3);
  });

  it('says the list is truncated when the mempool page is full', async () => {
    const txs = Array.from({ length: 50 }, (_, i) => ({
      txid: txidOf(i + 1),
      outputs: [{ spk: D.scriptPubKey, value: 546 }],
      confirmed: false,
    }));
    const esplora = fakeEsplora({ address: D.address, spk: D.scriptPubKey, txs });
    const history = await fetchAddressHistory('https://btc.example', D.address, D.scriptPubKey, {
      fetchFn: esplora.fetchFn,
    });
    expect(history.truncated).toBe(true);
  });
});

describe('fetchDepositOutputs', () => {
  const base = `https://btc.example/address/${D.address}`;

  it('reads the history and the unspent set, and a reported hash it already saw costs nothing', async () => {
    const esplora = fakeEsplora({
      address: D.address,
      spk: D.scriptPubKey,
      txs: busyAddress(3, 1),
    });
    const res = await fetchDepositOutputs('https://btc.example', D.address, D.scriptPubKey, {
      txids: [txidOf(2).toUpperCase()],
      fetchFn: esplora.fetchFn,
    });
    expect(esplora.urls).toEqual([`${base}/txs/mempool`, `${base}/txs/chain`, `${base}/utxo`]);
    expect(res.outputs.map(o => o.txid)).toEqual([txidOf(2)]);
    expect(res).toMatchObject({ truncated: false, foreignTxids: [], requests: 3 });
  });

  it('still finds a reported, already spent payout that the history page limit cut off', async () => {
    const esplora = fakeEsplora({
      address: D.address,
      spk: D.scriptPubKey,
      txs: busyAddress(60, 59).map(tx =>
        tx.txid === txidOf(60)
          ? { ...tx, outputs: tx.outputs.map(o => ({ ...o, spent: true })) }
          : tx
      ),
    });
    const res = await fetchDepositOutputs('https://btc.example', D.address, D.scriptPubKey, {
      txids: [txidOf(60)],
      maxPages: 1,
      fetchFn: esplora.fetchFn,
    });
    expect(esplora.urls.at(-1)).toBe(`https://btc.example/tx/${txidOf(60)}`);
    expect(res.outputs).toMatchObject([{ txid: txidOf(60), amountSats: 40_000, spent: true }]);
    expect(res).toMatchObject({ truncated: true, foreignTxids: [] });
  });

  it('reports a hash that names a transaction not paying this address', async () => {
    const esplora = fakeEsplora({
      address: D.address,
      spk: D.scriptPubKey,
      txs: [
        ...busyAddress(3, 1),
        {
          txid: 'ee'.repeat(32),
          outputs: [{ spk: '0014' + '22'.repeat(20), value: 40_000 }],
          confirmed: false,
        },
      ],
    });
    const res = await fetchDepositOutputs('https://btc.example', D.address, D.scriptPubKey, {
      txids: [`0x${'ee'.repeat(32)}`.slice(2), 'ff'.repeat(32)],
      fetchFn: esplora.fetchFn,
    });
    expect(res.foreignTxids).toEqual(['ee'.repeat(32)]);
    expect(res.missingTxids).toEqual(['ff'.repeat(32)]);
    expect(res.outputs.map(o => o.txid)).toEqual([txidOf(2)]);
  });

  it('marks a confirmed output missing from the unspent set as spent, never an unconfirmed one', async () => {
    const esplora = fakeEsplora({
      address: D.address,
      spk: D.scriptPubKey,
      txs: [
        {
          txid: txidOf(1),
          outputs: [{ spk: D.scriptPubKey, value: 40_000, spent: true }],
          confirmed: true,
          height: 10,
        },
      ],
    });
    const res = await fetchDepositOutputs('https://btc.example', D.address, D.scriptPubKey, {
      fetchFn: esplora.fetchFn,
    });
    expect(res.outputs).toMatchObject([{ txid: txidOf(1), spent: true }]);
  });

  it('ignores hashes that are not txids', async () => {
    const esplora = fakeEsplora({ address: D.address, spk: D.scriptPubKey, txs: [] });
    await fetchDepositOutputs('https://btc.example', D.address, D.scriptPubKey, {
      txids: ['../x', '0xnothex'],
      fetchFn: esplora.fetchFn,
    });
    expect(esplora.urls).toEqual([`${base}/txs/mempool`, `${base}/txs/chain`, `${base}/utxo`]);
  });
});

describe('fetchAddressTxCount', () => {
  it('adds chain and mempool transactions from the recorded real responses', async () => {
    const urls: string[] = [];
    function fetchFn(url: string): Promise<Response> {
      urls.push(url);
      return Promise.resolve(
        jsonResponse(url.endsWith(D.address) ? REAL_USED_ADDRESS_STATS : REAL_UNUSED_ADDRESS_STATS)
      );
    }
    expect(await fetchAddressTxCount('https://btc.example', D.address, { fetchFn })).toBe(6);
    expect(await fetchAddressTxCount('https://btc.example', 'bc1pother', { fetchFn })).toBe(0);
    expect(urls[0]).toBe(`https://btc.example/address/${D.address}`);
  });

  it('counts a mempool-only transaction as use', async () => {
    function fetchFn(): Promise<Response> {
      return Promise.resolve(
        jsonResponse({ chain_stats: { tx_count: 0 }, mempool_stats: { tx_count: 1 } })
      );
    }
    expect(await fetchAddressTxCount('https://btc.example', D.address, { fetchFn })).toBe(1);
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
