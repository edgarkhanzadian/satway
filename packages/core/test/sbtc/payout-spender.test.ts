import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { describe, expect, it } from 'vitest';

import {
  type SweepTransaction,
  buildDepositAddress,
  buildReclaimPsbt,
  fetchPayoutSpend,
  fetchPayoutSpender,
  parseWith,
  signReclaimPsbt,
  spenderOfTransaction,
  spenderOfWitness,
  sweepTransactionSchema,
} from '../../src/index.js';
import { REAL_DEPOSIT as D, defined } from '../fixtures.js';
import { EVIDENCE_DEPOSITS, EVIDENCE_SWEEPS } from './signer-evidence-fixtures.js';

const BTC_API = 'https://btc.example/api';
const SWEEP_TXID = 'abc3e21b4028dd3a3a3f0aaebb7da2ab4a6331107608a0c28d0bb062dbf0927c';
const swept = defined(EVIDENCE_DEPOSITS[0]);
const realSweep = parseWith(sweepTransactionSchema, EVIDENCE_SWEEPS[SWEEP_TXID], 'sweep');
const sweptOutpoint = { txid: swept.bitcoinTxid, vout: swept.bitcoinTxOutputIndex };

const priv = hex.decode('11'.repeat(32));
const reclaimPublicKey = hex.encode(btc.utils.pubSchnorr(priv));
const deposit = buildDepositAddress({
  stacksAddress: D.stacksAddress,
  reclaimPublicKey,
  signersPublicKey: D.signersPublicKey,
  maxSignerFeeSats: D.maxSignerFeeSats,
  reclaimLockBlocks: D.reclaimLockBlocks,
});
const payout = { txid: D.txid, vout: D.vout, amountSats: 200_000 };

function reclaimTransaction(): SweepTransaction {
  const { psbtHex } = buildReclaimPsbt({
    payout,
    bitcoinAddress: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys',
    stacksAddress: D.stacksAddress,
    reclaimPublicKey,
    signersPublicKey: D.signersPublicKey,
    maxSignerFeeSats: D.maxSignerFeeSats,
    reclaimLockBlocks: D.reclaimLockBlocks,
    feeRate: 5,
  });
  const { txHex, txid } = signReclaimPsbt(psbtHex, priv);
  const tx = btc.Transaction.fromRaw(hex.decode(txHex), { allowUnknownOutputs: true });
  const input = tx.getInput(0);
  return {
    txid,
    vin: [
      {
        txid: hex.encode(defined(input.txid)),
        vout: defined(input.index),
        witness: defined(input.finalScriptWitness).map(item => hex.encode(item)),
        prevout: { scriptpubkey: deposit.scriptPubKey, value: payout.amountSats },
      },
    ],
    vout: Array.from({ length: tx.outputsLength }, (_, i) => {
      const out = tx.getOutput(i);
      return {
        scriptpubkey: hex.encode(defined(out.script)),
        value: Number(defined(out.amount)),
      };
    }),
    status: { confirmed: true, block_height: 976_000 },
  };
}

describe('telling a signer sweep from a reclaim', () => {
  it('reads the real signer sweep as a spend through the deposit leaf', () => {
    expect(spenderOfTransaction(realSweep, sweptOutpoint, swept)).toBe('signers');
  });

  it('reads a signed reclaim transaction as a spend through the reclaim leaf', () => {
    expect(spenderOfTransaction(reclaimTransaction(), payout, deposit)).toBe('reclaim');
  });

  it('does not guess when the input is missing, the witness is a key path, or the scripts differ', () => {
    expect(spenderOfTransaction(realSweep, { ...sweptOutpoint, vout: 9 }, swept)).toBeNull();
    expect(spenderOfWitness(['ab'.repeat(64)], swept)).toBeNull();
    const reclaim = defined(reclaimTransaction().vin[0]?.witness);
    expect(spenderOfWitness(reclaim, swept)).toBeNull();
    const [signature = '', script = ''] = reclaim;
    expect(spenderOfWitness([signature, script, 'c0'.padEnd(66, '0')], deposit)).toBeNull();
  });
});

describe('fetchPayoutSpender', () => {
  function esplora(spend: SweepTransaction | null, outspendTxid = spend?.txid) {
    const urls: string[] = [];
    function fetchFn(url: string) {
      urls.push(url);
      const body = url.includes('/outspend/')
        ? { spent: spend !== null, txid: outspendTxid, vin: 0 }
        : spend;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    return { urls, fetchFn };
  }

  it('reads the outspend, then the spending transaction', async () => {
    const reclaim = reclaimTransaction();
    const net = esplora(reclaim);
    expect(await fetchPayoutSpender(BTC_API, payout, deposit, net.fetchFn)).toBe('reclaim');
    expect(net.urls).toEqual([
      `${BTC_API}/tx/${D.txid}/outspend/${D.vout}`,
      `${BTC_API}/tx/${reclaim.txid}`,
    ]);
  });

  it('is unknown when the output is not reported as spent', async () => {
    const net = esplora(null);
    expect(await fetchPayoutSpender(BTC_API, payout, deposit, net.fetchFn)).toBeNull();
    expect(net.urls).toHaveLength(1);
  });

  it('is unknown when the API returns a different transaction than it named', async () => {
    const net = esplora(reclaimTransaction(), 'ff'.repeat(32));
    expect(await fetchPayoutSpender(BTC_API, payout, deposit, net.fetchFn)).toBeNull();
  });
});

describe('fetchPayoutSpend', () => {
  function esplora(outspend: unknown, spend: SweepTransaction | null = null) {
    function fetchFn(url: string) {
      const body = url.includes('/outspend/') ? outspend : spend;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    return fetchFn;
  }

  it('tells an output the API still calls unspent from one it cannot attribute', async () => {
    expect(await fetchPayoutSpend(BTC_API, payout, deposit, esplora({ spent: false }))).toBe(
      'unspent'
    );
    const reclaim = reclaimTransaction();
    expect(
      await fetchPayoutSpend(
        BTC_API,
        payout,
        deposit,
        esplora({ spent: true, txid: reclaim.txid }, reclaim)
      )
    ).toBe('reclaim');
    expect(
      await fetchPayoutSpend(BTC_API, payout, deposit, esplora({ spent: true, txid: 'zz' }))
    ).toBe('unknown');
    expect(
      await fetchPayoutSpend(
        BTC_API,
        payout,
        swept,
        esplora({ spent: true, txid: reclaim.txid }, reclaim)
      )
    ).toBe('unknown');
  });
});
