import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type OneClickQuoteRequest,
  type OneClickQuoteResponse,
  type OneClickSwapStatus,
  type OneClickToken,
  MAINNET_CONFIG as config,
  largestPayoutSats,
  planReclaim,
} from '@satway/core';

import { prepareDeposit, toBaseUnits } from '../../../src/features/deposit/flow.js';
import { pickAccount } from '../../../src/features/stacks-wallet/wallet.js';
import {
  type Backend,
  type BackgroundRegistration,
  createBackend,
} from '../../../src/shared/backend.js';
import { checkProgress } from '../../../src/shared/progress.js';
import {
  MAX_UNREADABLE_BACKUPS,
  RECEIPTS_KEY,
  REVOKE_DOWNLOAD_URL_AFTER_MS,
  type Receipt,
  UNREADABLE_RECEIPTS_PREFIX,
  downloadReceipt,
  loadReceipts,
  receiptFileName,
  receiptId,
  rememberReceipt,
  sendAmountOf,
  verifyReceipt,
} from '../../../src/shared/receipt.js';
import {
  STXONECTOR_RECEIPTS_KEY,
  migrateBrowserStorage,
} from '../../../src/shared/storage-migration.js';

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
const REAL_TX_HEX =
  '020000000001028ef08f51a0401825af15c238d7b2136d2405abd9bf02e0c1c8a697db2aeb296c0100000000fdffffff1e6ad5fd73606f585163f958b617134804bf611c2a0a7ffb175fded4280b3d1d0a00000000fdffffff02063031010000000022512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2ecc0a0000000000001600142df601e9bf6db95982ff4579f18ca119f02c053102473044022045ec482d45a32b8f761cd402687ce8f9e6cc2d9b8ed5bba2c71a31fc099e77cd02200a644600d7174977f7185d630323b1f0dda4b5b81b2017bc8000639015bdd23501210251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff20247304402204c18dfb4eb01af4da5f1c66e9c0f79696e55803ec7c257cc7e34014af2c2d97a02202df05db704cbd99c121dd18cb908d5c2a5bd63baca86ad09dbd9c0ad82749b9c01210251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff200000000';
const CHAIN: Record<number, { txid: string; hex: string }> = {
  0: { txid: D.txid, hex: REAL_TX_HEX },
  2: {
    txid: '2f00c1314c251e6f45ba2707deb85e7eb3b8cd47383bd75d2412e3c5c77f9015',
    hex: '02000000018ef08f51a0401825af15c238d7b2136d2405abd9bf02e0c1c8a697db2aeb296c010000000151fdffffff030100000000000000160014111111111111111111111111111111111111111101000000000000001600141111111111111111111111111111111111111111ac8a00000000000022512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e00000000',
  },
};
const TIP = 975_805;
const SIGNER_DEPOSIT_SCRIPT =
  '2400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac';
const SIGNER_CONTROL_BLOCK =
  'c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614';
const SIGNER_SWEEP_TXID = 'abc3e21b4028dd3a3a3f0aaebb7da2ab4a6331107608a0c28d0bb062dbf0927c';
const PEG_SPK = '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753';
const EVIDENCE_SPK = '5120df59a36d0b1f2ffb3f68a37ad4a3f8457a21a4191a75821214eadc7f839495cc';
const EVIDENCE = [
  {
    txid: 'b2965a1d76c7e71729aabad38549b733cf3e00e9c174260acf33157c8f687135',
    value: 80_000,
    signature:
      'b07e22eb9bdfce9568e42f40d2141eab9e68d4a469ac1809e9d0c94a4abc01fed78b0206697e9d5c8a899088fcf6efa04d477ff5e4c8274791076ddf970b0d8001',
    hex: '01000000000101e4ec668a51d5bef17910a183dbdbfbf90a0f9254d3822c66fb1af20e9fcad7620200000000fdffffff030000000000000000536a4c5058325b22fccb460558d404079bf07161dc6eb76565c7ce597009da6d73e2f16381d94d6c9ed8ea144644e95ba490bb55dea54f49d04d676d82f0e205a9263768b91a53000ee4470105000ee388001a8b8038010000000000225120df59a36d0b1f2ffb3f68a37ad4a3f8457a21a4191a75821214eadc7f839495cc850dc2100000000016001463ec8808122d5913aede7aa5572c2ffb7171726602483045022100edbcc2c50fe4d3cc154510e98dbc1b89573897870da7b44e93d5f8ffb7df9079022038304a48f6eb253a027f472884f93153331febaf16ca271d789b7568bed8370b012102d2ce43867f5b8fdd1246b1535717aac9b73147b05eba7ff8698c39d42701fc9300000000',
  },
  {
    txid: 'fe3f3e74468d89e087d03064e389abb932c68ce448ffa6940aa013168ddb9168',
    value: 10_000,
    signature:
      'c068b01c082023ccb9f4f1a19a092332828ee8afb177560fce40188c90eb10c631b4a2def0e13a87e16990bf59cdf140803e56303bda3e1ab4a8099d3ccb6e8401',
    hex: '01000000000101ac47ef284e3b01c5fa435533ab615140ceaff1324de80c62c39b707b0688d7500200000000fdffffff030000000000000000536a4c5058325b22fccb460558d404079bf07161dc6eb76565c7ce597009da6d73e2f16381d94d6c9ed8ea144644e95ba490bb55dea54f49d04d676d82f0e205a9263768b91a53000ee4470105000ee2a900048b1027000000000000225120df59a36d0b1f2ffb3f68a37ad4a3f8457a21a4191a75821214eadc7f839495cc721b0001000000001600142d27111a8deaaac9ddb2259b1f12f0e0b71eed9b0248304502210089d70d1b409ed4f6dfa3757ae9c6659b465e0f61a786591bc7a4ae9f9370f99a022001aa95a72df9dd35b5706e6b964feefc4180a96296831b1fb93a775b2637baf80121037864e29fbd01dadb255f29c54c78ab4592db292afc1c057edb7662b305095b2200000000',
  },
];
const SIGNER_SWEEP = {
  txid: SIGNER_SWEEP_TXID,
  vin: [
    {
      txid: '13722963457daa096f6bcb73314bb9c8eb9db7db04192714cced9a46c9217c67',
      vout: 0,
      witness: [],
      prevout: { scriptpubkey: PEG_SPK, value: 248_335_120_296 },
    },
    ...EVIDENCE.map(e => ({
      txid: e.txid,
      vout: 1,
      witness: [e.signature, SIGNER_DEPOSIT_SCRIPT, SIGNER_CONTROL_BLOCK],
      prevout: { scriptpubkey: EVIDENCE_SPK, value: e.value },
    })),
  ],
  vout: [
    { scriptpubkey: PEG_SPK, value: 248_335_327_083 },
    { scriptpubkey: '6a03543301', value: 0 },
  ],
  status: { confirmed: true, block_height: TIP - 1 },
};
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

interface Out {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  height?: number;
  time?: number;
  spent?: boolean;
}

interface World {
  minOut?: string;
  amountOut?: string;
  perDepositCap?: number | null;
  rewrite?: Partial<OneClickQuoteRequest>;
  swap?: OneClickSwapStatus;
  hashes?: string[];
  payoutVout?: number | null;
  prior?: Out[];
  outputs?: Out[];
  fillers?: number;
  mint?: string | null;
  mints?: Record<string, string>;
  signerKey?: string;
  secondaryKey?: string;
  secondaryDown?: boolean;
  txHex?: string;
  notifyStatus?: number;
  failPostFor?: string;
  emilyReadsDown?: boolean;
}

const OTHER_SPK = '0014' + '11'.repeat(20);
const AFTER = Date.parse(NOW.toISOString()) / 1000 + 3_600;

function payoutOut(vout: number): Out {
  return {
    txid: CHAIN[vout]?.txid ?? D.txid,
    vout,
    value: 35_500,
    confirmed: true,
    height: TIP - 2,
    time: AFTER,
  };
}

function txJson(txid: string, outs: Out[]) {
  const first = outs[0];
  const width = Math.max(...outs.map(o => o.vout)) + 1;
  const vout = Array.from({ length: width }, (_, i) => {
    const o = outs.find(x => x.vout === i);
    return o
      ? { scriptpubkey: D.scriptPubKey, value: o.value }
      : { scriptpubkey: OTHER_SPK, value: 1 };
  });
  const status = first?.confirmed
    ? { confirmed: true, block_height: first.height, block_time: first.time }
    : { confirmed: false };
  return { txid, vout, status };
}

function world(w: World = {}) {
  const posts: { url: string; body: unknown }[] = [];
  const quotes: OneClickQuoteRequest[] = [];
  const registered: string[] = [];
  const urls: string[] = [];
  const emily = new Map<string, string>(Object.entries(w.mints ?? {}));
  const payout = w.payoutVout == null ? null : payoutOut(w.payoutVout);
  if (payout && w.mint) emily.set(`${payout.txid}:${payout.vout}`, w.mint);
  const state = { arrived: false, tip: TIP };
  const arriving = [...(w.outputs ?? []), ...(payout ? [payout] : [])];

  function visible(): Out[] {
    return [...(state.arrived ? arriving : []), ...(w.prior ?? [])];
  }

  function txs() {
    const byTx = new Map<string, Out[]>();
    for (const o of visible()) byTx.set(o.txid, [...(byTx.get(o.txid) ?? []), o]);
    const real = [...byTx].map(([txid, outs]) => txJson(txid, outs));
    const fillers = state.arrived
      ? Array.from({ length: w.fillers ?? 0 }, (_, i) => ({
          txid: (i + 1).toString(16).padStart(64, 'f'),
          vout: [{ scriptpubkey: OTHER_SPK, value: 1 }],
          status: { confirmed: true, block_height: TIP - 1, block_time: AFTER },
        }))
      : [];
    return [...fillers, ...real];
  }

  function fetchFn(url: string, init?: RequestInit): Promise<Response> {
    urls.push(url);
    return later(() => route(url, init));
  }

  function route(url: string, init?: RequestInit): Response {
    if (url.includes('/v2/contracts/call-read/')) {
      return jsonRes({
        okay: true,
        result: '0x020000002102' + (w.signerKey ?? D.signersPublicKey),
      });
    }
    if (url.startsWith(`${config.stxSecondaryApiUrl}/v2/data_var/`)) {
      if (w.secondaryDown) return new Response('Bad gateway', { status: 502 });
      return jsonRes({
        data: '0x020000002102' + (w.secondaryKey ?? w.signerKey ?? D.signersPublicKey),
      });
    }
    if (url.includes('/deposit?status=confirmed')) {
      return jsonRes({
        deposits: EVIDENCE.map(e => ({
          bitcoinTxid: e.txid,
          bitcoinTxOutputIndex: 1,
          depositScript: SIGNER_DEPOSIT_SCRIPT,
          reclaimScript: '03ffff00b26a',
        })),
      });
    }
    if (url.endsWith('/blocks/tip/height')) return new Response(String(state.tip));
    const evidence = EVIDENCE.findIndex(e => url.endsWith(`/tx/${e.txid}/outspend/1`));
    if (evidence >= 0)
      return jsonRes({
        spent: true,
        txid: SIGNER_SWEEP_TXID,
        vin: evidence + 1,
        status: { confirmed: true, block_height: TIP - 1 },
      });
    if (url.endsWith(`/tx/${SIGNER_SWEEP_TXID}`)) return jsonRes(SIGNER_SWEEP);
    const funding = EVIDENCE.find(e => url.endsWith(`/tx/${e.txid}/hex`));
    if (funding) return new Response(funding.hex);
    if (url.endsWith('/limits'))
      return jsonRes({
        pegCap: null,
        perDepositMinimum: 10_000,
        perDepositCap: w.perDepositCap ?? null,
      });
    const addr = `https://mempool.space/api/address/${D.address}`;
    if (url === `${addr}/utxo`) {
      return jsonRes(
        visible()
          .filter(o => !o.spent)
          .map(o => ({
            txid: o.txid,
            vout: o.vout,
            value: o.value,
            status: o.confirmed
              ? { confirmed: true, block_height: o.height, block_time: o.time }
              : { confirmed: false },
          }))
      );
    }
    if (url === `${addr}/txs/mempool`) return jsonRes(txs().filter(t => !t.status.confirmed));
    if (url.startsWith(`${addr}/txs/chain`)) {
      const chain = txs().filter(t => t.status.confirmed);
      const last = url.slice(`${addr}/txs/chain`.length).replace(/^\//, '');
      const start = last === '' ? 0 : chain.findIndex(t => t.txid === last) + 1;
      return jsonRes(chain.slice(start, start + 25));
    }
    const txMatch = /\/tx\/([0-9a-f]{64})$/.exec(url);
    if (txMatch) {
      const tx = txs().find(t => t.txid === txMatch[1]);
      return tx ? jsonRes(tx) : new Response('Transaction not found', { status: 404 });
    }
    if (url.includes('/tx/') && url.endsWith('/hex')) {
      const known = Object.values(CHAIN).find(t => url.endsWith(`/tx/${t.txid}/hex`));
      if (!known) return new Response('Transaction not found', { status: 404 });
      return new Response(w.txHex ?? known.hex);
    }
    if (url.endsWith('/deposit') && init?.method === 'POST') {
      const body = bodyJson(init);
      posts.push({ url, body });
      if (w.notifyStatus) return jsonRes({ message: 'invalid transaction hex' }, w.notifyStatus);
      const key =
        typeof body === 'object' &&
        body !== null &&
        'bitcoinTxid' in body &&
        'bitcoinTxOutputIndex' in body
          ? `${String(body.bitcoinTxid)}:${String(body.bitcoinTxOutputIndex)}`
          : '';
      if (key === w.failPostFor) return jsonRes({ message: 'Emily is down' }, 503);
      emily.set(key, 'pending');
      return jsonRes(emilyDeposit('pending'), 201);
    }
    const dep = /\/deposit\/([0-9a-f]{64})\/(\d+)$/.exec(url);
    if (dep) {
      if (w.emilyReadsDown) return jsonRes({ message: 'Service Unavailable' }, 503);
      const status = emily.get(`${dep[1]}:${dep[2]}`);
      return status ? jsonRes(emilyDeposit(status)) : jsonRes({ message: 'nope' }, 404);
    }
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
          swapDetails: {
            originChainTxHashes: [],
            destinationChainTxHashes: (w.hashes ?? []).map(hash => ({ hash, explorerUrl: '' })),
          },
        };
      });
    },
    register(depositScript) {
      return later(() => {
        registered.push(depositScript);
        const done: BackgroundRegistration = { kind: 'registered', address: D.address };
        return done;
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
        amountOut: w.amountOut ?? '35617',
        amountOutFormatted: '0.00035617',
        amountOutUsd: '23.6',
        minAmountOut: w.minOut ?? '35260',
        timeEstimate: 480,
        withdrawFee: '1900',
      },
    };
  }
  function arrive() {
    state.arrived = true;
  }
  function setTip(tip: number) {
    state.tip = tip;
  }
  return { fetchFn, backend, posts, quotes, registered, urls, emily, arrive, setTip };
}

async function receiptFor(w: ReturnType<typeof world>): Promise<Receipt> {
  const receipt = (
    await prepareDeposit(config, w.backend, input, { dry: false, fetchFn: w.fetchFn, now: NOW })
  ).receipt;
  w.arrive();
  return receipt;
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
    const w = world({ amountOut: '10099', minOut: '9999' });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).rejects.toThrow(/too small/);
  });

  it('refuses when the payout could exceed the per-deposit cap, even if the minimum is under it', async () => {
    const w = world({ perDepositCap: 36_000 });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).rejects.toThrow(/per-deposit cap/);
  });

  it('accepts a payout whose expected output plus margin stays under the cap', async () => {
    const w = world({
      perDepositCap: largestPayoutSats({ amountOut: '35617', minAmountOut: '0' }),
    });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).resolves.toMatchObject({ expectedSats: 35_617, minimumSats: 35_260 });
  });

  it('never asks for a quote if the signer key cannot be verified', async () => {
    const w = world({ signerKey: 'ab'.repeat(32) });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).rejects.toThrow(/refusing/);
    expect(w.quotes).toHaveLength(0);
  });

  it('reads the signer key from two Stacks sources and checks the sweep on Bitcoin', async () => {
    const w = world();
    await prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn });
    expect(w.urls).toContain(
      `${config.stxSecondaryApiUrl}/v2/data_var/${config.sbtcContract}/sbtc-registry/current-aggregate-pubkey?proof=0`
    );
    expect(w.urls).toContain(`${config.btcApiUrl}/tx/${SIGNER_SWEEP_TXID}`);
  });

  it('never asks for a quote when the second Stacks source disagrees', async () => {
    const w = world({ secondaryKey: 'ab'.repeat(32) });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).rejects.toThrow(/mismatch between Stacks APIs/);
    expect(w.quotes).toHaveLength(0);
  });

  it('never asks for a quote when the second Stacks source is down', async () => {
    const w = world({ secondaryDown: true });
    await expect(
      prepareDeposit(config, w.backend, input, { dry: true, fetchFn: w.fetchFn })
    ).rejects.toThrow(/second Stacks source stacks-node\.alexlab\.co.*refusing/);
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
          bitcoinTxid: CHAIN[2]?.txid,
          bitcoinTxOutputIndex: 2,
          depositScript: D.depositScript,
          reclaimScript: D.reclaimScript,
          transactionHex: CHAIN[2]?.hex,
        },
      },
    ]);
    expect(snap.progress.stage).toBe('minting');
    expect(snap.payout).toMatchObject({ vout: 2, amountSats: 35_500 });
    expect(snap.registrationError).toBeNull();
    expect(snap.registrationErrors).toEqual([]);
  });

  it('sends the real raw transaction for a payout at output 0', async () => {
    const w = world({ swap: 'SUCCESS', payoutVout: 0 });
    await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(w.posts.map(p => p.body)).toEqual([
      {
        bitcoinTxid: D.txid,
        bitcoinTxOutputIndex: 0,
        depositScript: D.depositScript,
        reclaimScript: D.reclaimScript,
        transactionHex: REAL_TX_HEX,
      },
    ]);
  });

  it('posts nothing and reports why when the raw transaction does not match', async () => {
    const w = world({ swap: 'SUCCESS', payoutVout: 0, txHex: CHAIN[2]?.hex });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(w.posts).toHaveLength(0);
    expect(snap.progress.stage).toBe('awaiting-notification');
    expect(snap.registrationError).toMatch(/has txid/);
    expect(snap.registrationErrors[0]).toMatchObject({ kind: 'rejected', status: null });
  });

  it('reports a rejected registration instead of dropping it', async () => {
    const w = world({ swap: 'SUCCESS', payoutVout: 0, notifyStatus: 400 });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(w.posts).toHaveLength(1);
    expect(snap.mint).toBeNull();
    expect(snap.registrationError).toMatch(/HTTP 400 .*invalid transaction hex/);
    expect(snap.registrationErrors[0]).toMatchObject({ kind: 'rejected', status: 400 });
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

const REAL_OUT = `${D.txid}:0`;
const OTHER_TXID = CHAIN[2]?.txid ?? '';
const OTHER_OUT = `${OTHER_TXID}:2`;
const OLD_TXID = 'cc'.repeat(32);
const BEFORE = Date.parse(NOW.toISOString()) / 1000 - 86_400;

function postedOutpoints(w: ReturnType<typeof world>): string[] {
  return w.posts.map(p => {
    const b = p.body;
    return typeof b === 'object' && b !== null && 'bitcoinTxid' in b && 'bitcoinTxOutputIndex' in b
      ? `${String(b.bitcoinTxid)}:${String(b.bitcoinTxOutputIndex)}`
      : 'unknown';
  });
}

describe('checkProgress: which output is the payout', () => {
  it('a later unconfirmed 546-sat output does not hijack status or registration', async () => {
    const w = world({
      swap: 'SUCCESS',
      payoutVout: 0,
      outputs: [{ txid: OTHER_TXID, vout: 2, value: 546, confirmed: false }],
    });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.payout).toMatchObject({ txid: D.txid, vout: 0, amountSats: 35_500 });
    expect(snap.progress.stage).toBe('minting');
    expect(postedOutpoints(w)).toEqual([REAL_OUT]);
    expect(snap.belowMinimum).toMatchObject([{ txid: OTHER_TXID, amountSats: 546 }]);
  });

  it('dust before the payout leaves the deposit waiting, then the real payout is picked', async () => {
    const dust: Out = { txid: OTHER_TXID, vout: 2, value: 546, confirmed: false };
    const before = world({ swap: 'PROCESSING', outputs: [dust] });
    const receipt = await receiptFor(before);
    const waiting = await checkProgress(config, before.backend, receipt, before.fetchFn);
    expect(waiting.payout).toBeNull();
    expect(waiting.progress).toMatchObject({ stage: 'swapping', terminal: false });
    expect(before.posts).toHaveLength(0);

    const after = world({ swap: 'SUCCESS', hashes: [D.txid], payoutVout: 0, outputs: [dust] });
    after.arrive();
    const paid = await checkProgress(config, after.backend, receipt, after.fetchFn);
    expect(paid.payout).toMatchObject({ txid: D.txid, vout: 0 });
    expect(paid.basis).toBe('hash');
    expect(postedOutpoints(after)).toEqual([REAL_OUT]);
  });

  it('a second deposit on an address whose first payout was minted waits for its own payout', async () => {
    const old: Out = {
      txid: OLD_TXID,
      vout: 0,
      value: 50_000,
      confirmed: true,
      height: TIP - 5_000,
      time: BEFORE,
    };
    const w = world({
      swap: 'PENDING_DEPOSIT',
      prior: [old],
      mints: { [`${OLD_TXID}:0`]: 'confirmed' },
    });
    const receipt = await receiptFor(w);
    expect(receipt.priorOutpoints).toEqual([`${OLD_TXID}:0`]);
    const snap = await checkProgress(config, w.backend, receipt, w.fetchFn);
    expect(snap.progress).toMatchObject({ stage: 'awaiting-funds', terminal: false });
    expect(snap.payout).toBeNull();
    expect(w.posts).toHaveLength(0);
  });

  it.each(['PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT', 'PROCESSING'] as const)(
    'while this swap is %s, another deposit’s payout to the same address is not adopted but is still registered',
    async swap => {
      const w = world({ swap, payoutVout: 0, mint: 'confirmed' });
      const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
      expect(snap.payout).toBeNull();
      expect(snap.basis).toBeNull();
      expect(snap.progress.terminal).toBe(false);
      expect(snap.progress.stage).toBe(swap === 'PROCESSING' ? 'swapping' : 'awaiting-funds');
      expect(snap.otherOutputs).toMatchObject([{ txid: D.txid, amountSats: 35_500 }]);

      const fresh = world({ swap, payoutVout: 0 });
      const unregistered = await checkProgress(
        config,
        fresh.backend,
        await receiptFor(fresh),
        fresh.fetchFn
      );
      expect(unregistered.payout).toBeNull();
      expect(postedOutpoints(fresh)).toEqual([REAL_OUT]);
      expect(unregistered.mints.get(REAL_OUT)).toBe('pending');
    }
  );

  it('an old receipt without a snapshot still ignores a payout confirmed long before it', async () => {
    const old: Out = {
      txid: OLD_TXID,
      vout: 0,
      value: 50_000,
      confirmed: true,
      height: TIP - 5_000,
      time: BEFORE,
    };
    const w = world({
      swap: 'PENDING_DEPOSIT',
      prior: [old],
      mints: { [`${OLD_TXID}:0`]: 'confirmed' },
    });
    const legacy = structuredClone(await receiptFor(w));
    delete legacy.priorOutpoints;
    delete legacy.priorTruncated;
    const parsed = verifyReceipt(JSON.parse(JSON.stringify(legacy)));
    expect(parsed.priorOutpoints).toBeUndefined();
    const snap = await checkProgress(config, w.backend, parsed, w.fetchFn);
    expect(snap.progress.stage).toBe('awaiting-funds');
  });

  it('the 1Click hash beats an attacker output in the amount range', async () => {
    const w = world({
      swap: 'SUCCESS',
      hashes: [`0x${D.txid.toUpperCase()}`],
      payoutVout: 0,
      outputs: [{ txid: OTHER_TXID, vout: 2, value: 36_000, confirmed: false }],
    });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.payout).toMatchObject({ txid: D.txid });
    expect(snap.basis).toBe('hash');
    expect(snap.otherOutputs).toMatchObject([{ txid: OTHER_TXID, amountSats: 36_000 }]);
    expect(postedOutpoints(w).sort()).toEqual([REAL_OUT, OTHER_OUT].sort());
  });

  it('without a hash, one candidate is selected by amount', async () => {
    const w = world({ swap: 'SUCCESS', payoutVout: 0 });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.basis).toBe('amount');
    expect(snap.payout).toMatchObject({ txid: D.txid });
  });

  it('without a hash, two candidates are reported as ambiguous and both are registered', async () => {
    const w = world({
      swap: 'SUCCESS',
      payoutVout: 0,
      outputs: [{ txid: OTHER_TXID, vout: 2, value: 36_000, confirmed: false }],
    });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.payout).toBeNull();
    expect(snap.progress.stage).toBe('payout-ambiguous');
    expect(snap.candidates.map(c => c.txid).sort()).toEqual([D.txid, OTHER_TXID].sort());
    expect(postedOutpoints(w).sort()).toEqual([REAL_OUT, OTHER_OUT].sort());
  });

  it('with 1Click unavailable, the payout is still found by amount', async () => {
    const w = world({ payoutVout: 0 });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.swap).toBeNull();
    expect(snap.basis).toBe('amount');
    expect(snap.progress.stage).toBe('minting');
  });

  it('one failed registration does not stop the next, and the error names the outpoint', async () => {
    const w = world({
      swap: 'SUCCESS',
      payoutVout: 0,
      outputs: [{ txid: OTHER_TXID, vout: 2, value: 36_000, confirmed: false }],
      failPostFor: OTHER_OUT,
    });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(postedOutpoints(w)).toHaveLength(2);
    expect(snap.registrationErrors.map(e => e.outpoint)).toEqual([OTHER_OUT]);
    expect(snap.registrationErrors[0]?.message).toMatch(/HTTP 503/);
    expect(snap.registrationErrors[0]).toMatchObject({ kind: 'transient', status: 503 });
    expect(w.emily.get(REAL_OUT)).toBe('pending');
  });
});

describe('checkProgress: the sBTC signers’ API cannot be read', () => {
  it('still shows the outputs, marks the mint status unknown and registers nothing blindly', async () => {
    const w = world({ swap: 'SUCCESS', hashes: [D.txid], payoutVout: 0, emilyReadsDown: true });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.payout).toMatchObject({ txid: D.txid, vout: 0 });
    expect(snap.outputs).toHaveLength(1);
    expect(snap.mint).toBe('unknown');
    expect(snap.mints.get(REAL_OUT)).toBe('unknown');
    expect(snap.mintUnknown).toBe(true);
    expect(snap.progress).toMatchObject({ stage: 'awaiting-notification', terminal: false });
    expect(w.posts).toHaveLength(0);
  });

  it('past the timelock the output is reclaimable, without claiming it was never processed', async () => {
    const w = world({ swap: 'SUCCESS', hashes: [D.txid], payoutVout: 0, emilyReadsDown: true });
    const receipt = await receiptFor(w);
    w.setTip(TIP + 2_000);
    const snap = await checkProgress(config, w.backend, receipt, w.fetchFn);
    expect(snap.progress).toMatchObject({ stage: 'reclaimable', terminal: false });
    expect(snap.progress.message).not.toMatch(/never processed/);
    const plan = planReclaim({
      outputs: snap.outputs,
      selected: snap.payout,
      tipHeight: snap.tipHeight,
      reclaimLockBlocks: receipt.reclaimLockBlocks,
    });
    expect(plan.target?.ready).toBe(true);
  });

  it('a readable Emily leaves the mint status known', async () => {
    const w = world({ swap: 'SUCCESS', payoutVout: 0, mint: 'accepted' });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.mintUnknown).toBe(false);
  });
});

describe('checkProgress: busy addresses', () => {
  it('finds the payout behind 60 newer transactions by paging history', async () => {
    const w = world({ payoutVout: 0, fillers: 60 });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.payout).toMatchObject({ txid: D.txid });
    expect(snap.truncated).toBe(false);
  });

  it('reads the payout directly when 1Click reports its hash, without paging', async () => {
    const w = world({ swap: 'SUCCESS', hashes: [D.txid], payoutVout: 0, fillers: 60 });
    const receipt = await receiptFor(w);
    const start = w.urls.length;
    const snap = await checkProgress(config, w.backend, receipt, w.fetchFn);
    const used = w.urls.slice(start);
    expect(snap.payout).toMatchObject({ txid: D.txid });
    expect(used.some(u => u.includes('/txs/'))).toBe(false);
    expect(used.filter(u => !u.endsWith('/deposit'))).toHaveLength(6);
  });

  it('surfaces a truncated history instead of pretending it is complete', async () => {
    const w = world({ payoutVout: 0, fillers: 300 });
    const snap = await checkProgress(config, w.backend, await receiptFor(w), w.fetchFn);
    expect(snap.truncated).toBe(true);
  });
});

describe('checkProgress: timelock', () => {
  it.each(['pending', 'accepted', 'rbf'])(
    'Emily %s with the timelock passed and the output unspent -> reclaimable',
    async mint => {
      const w = world({ swap: 'SUCCESS', payoutVout: 0, mint });
      const receipt = await receiptFor(w);
      w.setTip(TIP + 2_000);
      const snap = await checkProgress(config, w.backend, receipt, w.fetchFn);
      expect(snap.progress.stage).toBe('reclaimable');
      expect(w.posts).toHaveLength(0);
    }
  );

  it('a confirmed mint is done', async () => {
    const w = world({ swap: 'SUCCESS', payoutVout: 0, mint: 'confirmed' });
    const receipt = await receiptFor(w);
    w.setTip(TIP + 2_000);
    const snap = await checkProgress(config, w.backend, receipt, w.fetchFn);
    expect(snap.progress.stage).toBe('done');
  });

  it('a payout the signers already spent is not reclaimable', async () => {
    const spent: Out = { ...payoutOut(0), spent: true };
    const w = world({
      swap: 'SUCCESS',
      hashes: [D.txid],
      outputs: [spent],
      mints: { [REAL_OUT]: 'accepted' },
    });
    const receipt = await receiptFor(w);
    w.setTip(TIP + 2_000);
    const snap = await checkProgress(config, w.backend, receipt, w.fetchFn);
    expect(snap.payout?.spent).toBe(true);
    expect(snap.progress.stage).toBe('minting');
  });
});

describe('reclaim target from a snapshot', () => {
  function planOf(snap: Awaited<ReturnType<typeof checkProgress>>) {
    return planReclaim({
      outputs: snap.outputs,
      selected: snap.payout,
      tipHeight: snap.tipHeight,
      reclaimLockBlocks: config.reclaimLockBlocks,
    });
  }
  const dust: Out = {
    txid: OTHER_TXID,
    vout: 2,
    value: 2_000,
    confirmed: true,
    height: TIP - 2,
    time: AFTER,
  };

  it('targets the real payout, not a 2,000-sat output, once the timelock has passed', async () => {
    const w = world({ swap: 'SUCCESS', hashes: [D.txid], payoutVout: 0, outputs: [dust] });
    const receipt = await receiptFor(w);
    w.setTip(TIP + 2_000);
    const snap = await checkProgress(config, w.backend, receipt, w.fetchFn);
    expect(snap.progress.stage).toBe('reclaimable');
    const plan = planOf(snap);
    expect(plan.target?.output).toMatchObject({ txid: D.txid, vout: 0 });
    expect(plan.options.map(o => o.output.amountSats)).toEqual([35_500, 2_000]);
  });

  it('after the payout is reclaimed the remaining output is still offered, never by default', async () => {
    const w = world({
      swap: 'SUCCESS',
      hashes: [D.txid],
      outputs: [{ ...payoutOut(0), spent: true }, dust],
    });
    const receipt = await receiptFor(w);
    w.setTip(TIP + 2_000);
    const snap = await checkProgress(config, w.backend, receipt, w.fetchFn);
    expect(snap.progress.stage).toBe('reclaimed');
    const plan = planOf(snap);
    expect(plan.target).toBeNull();
    expect(plan.nothingLeft).toBe(false);
    expect(plan.options.map(o => o.output.txid)).toEqual([OTHER_TXID]);
  });

  it('says nothing is left only when no output is unspent', async () => {
    const w = world({
      swap: 'SUCCESS',
      hashes: [D.txid],
      outputs: [{ ...payoutOut(0), spent: true }],
    });
    const receipt = await receiptFor(w);
    const snap = await checkProgress(config, w.backend, receipt, w.fetchFn);
    expect(planOf(snap).nothingLeft).toBe(true);
  });
});

describe('rememberReceipt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps two deposits to the same Bitcoin address apart', async () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    const first = await receiptFor(world());
    const second = structuredClone(first);
    second.createdAt = '2026-11-15T12:00:00.000Z';
    second.quoteResponse.quote.depositAddress = '0x' + '77'.repeat(20);
    rememberReceipt(first);
    rememberReceipt(second);
    rememberReceipt(first);
    const stored = loadReceipts();
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map(receiptId)).size).toBe(2);
    expect(stored.every(r => r.depositAddress === D.address)).toBe(true);
  });

  function memory(entries: [string, string][] = []) {
    const data = new Map(entries);
    const store = {
      data,
      failWrites: false,
      getItem: (k: string) => data.get(k) ?? null,
      setItem(k: string, v: string) {
        if (store.failWrites) throw new DOMException('quota', 'QuotaExceededError');
        data.set(k, v);
      },
    };
    vi.stubGlobal('localStorage', store);
    return store;
  }

  function storedList(store: { data: Map<string, string> }): unknown[] {
    const parsed: unknown = JSON.parse(store.data.get(RECEIPTS_KEY) ?? 'null');
    if (!Array.isArray(parsed)) throw new Error('expected a stored list');
    return parsed.map((item: unknown) => item);
  }

  async function receiptAt(createdAt: string): Promise<Receipt> {
    const receipt = structuredClone(await receiptFor(world()));
    receipt.createdAt = createdAt;
    return receipt;
  }

  it('keeps items it cannot read or verify, in place, and returns only verified ones', async () => {
    const old = await receiptAt('2026-11-10T00:00:00.000Z');
    const tampered = { ...old, createdAt: '2026-11-11T00:00:00.000Z', reclaimLockBlocks: 10 };
    const future = { version: 2, note: 'written by a newer app' };
    const store = memory([[RECEIPTS_KEY, JSON.stringify([future, old, 'junk', tampered])]]);
    const next = await receiptAt('2026-11-15T00:00:00.000Z');
    expect(rememberReceipt(next)).toBe(true);
    expect(storedList(store)).toEqual([
      JSON.parse(JSON.stringify(next)),
      future,
      JSON.parse(JSON.stringify(old)),
      'junk',
      JSON.parse(JSON.stringify(tampered)),
    ]);
    expect(loadReceipts().map(r => r.createdAt)).toEqual([next.createdAt, old.createdAt]);
  });

  it('replaces only a verified copy with the same id', async () => {
    const receipt = await receiptAt('2026-11-10T00:00:00.000Z');
    const unverifiedTwin = { ...receipt, reclaimLockBlocks: 10 };
    const store = memory([[RECEIPTS_KEY, JSON.stringify([unverifiedTwin, receipt])]]);
    expect(rememberReceipt(receipt)).toBe(true);
    expect(storedList(store)).toEqual([
      JSON.parse(JSON.stringify(receipt)),
      JSON.parse(JSON.stringify(unverifiedTwin)),
    ]);
  });

  it.each(['{not json', '{"a":1}', '"text"'])(
    'backs up a stored value it cannot read (%s) instead of overwriting it',
    async raw => {
      const store = memory([[RECEIPTS_KEY, raw]]);
      const receipt = await receiptAt('2026-11-15T00:00:00.000Z');
      expect(rememberReceipt(receipt)).toBe(true);
      expect(store.data.get(`${UNREADABLE_RECEIPTS_PREFIX}0`)).toBe(raw);
      expect(loadReceipts().map(receiptId)).toEqual([receiptId(receipt)]);
    }
  );

  it('uses the next free backup slot and does not back up the same value twice', async () => {
    const store = memory([
      [`${UNREADABLE_RECEIPTS_PREFIX}0`, 'older'],
      [RECEIPTS_KEY, '{broken'],
    ]);
    expect(rememberReceipt(await receiptAt('2026-11-15T00:00:00.000Z'))).toBe(true);
    expect(store.data.get(`${UNREADABLE_RECEIPTS_PREFIX}0`)).toBe('older');
    expect(store.data.get(`${UNREADABLE_RECEIPTS_PREFIX}1`)).toBe('{broken');
    store.data.set(RECEIPTS_KEY, '{broken');
    expect(rememberReceipt(await receiptAt('2026-11-16T00:00:00.000Z'))).toBe(true);
    expect(store.data.has(`${UNREADABLE_RECEIPTS_PREFIX}2`)).toBe(false);
  });

  it('reports failure and leaves an unreadable value alone when it cannot be backed up', async () => {
    const store = memory([[RECEIPTS_KEY, '{broken']]);
    store.failWrites = true;
    expect(rememberReceipt(await receiptAt('2026-11-15T00:00:00.000Z'))).toBe(false);
    expect(store.data.get(RECEIPTS_KEY)).toBe('{broken');
    const full = memory([[RECEIPTS_KEY, '{broken']]);
    for (let slot = 0; slot < MAX_UNREADABLE_BACKUPS; slot++)
      full.data.set(`${UNREADABLE_RECEIPTS_PREFIX}${slot}`, `other ${slot}`);
    expect(rememberReceipt(await receiptAt('2026-11-15T00:00:00.000Z'))).toBe(false);
    expect(full.data.get(RECEIPTS_KEY)).toBe('{broken');
  });

  it('never evicts older receipts to make room', async () => {
    const store = memory();
    const first = await receiptAt('2026-01-01T00:00:00.000Z');
    rememberReceipt(first);
    for (let day = 1; day <= 25; day++) {
      const r = structuredClone(first);
      r.createdAt = new Date(Date.UTC(2026, 1, day)).toISOString();
      expect(rememberReceipt(r)).toBe(true);
    }
    expect(storedList(store)).toHaveLength(26);
    expect(loadReceipts().at(-1)?.createdAt).toBe(first.createdAt);
  });

  it('reports a full storage quota so the caller can warn that the download is the only copy', async () => {
    const existing = await receiptAt('2026-11-10T00:00:00.000Z');
    const store = memory([[RECEIPTS_KEY, JSON.stringify([existing])]]);
    store.failWrites = true;
    expect(rememberReceipt(await receiptAt('2026-11-15T00:00:00.000Z'))).toBe(false);
    expect(storedList(store)).toEqual([JSON.parse(JSON.stringify(existing))]);
    vi.stubGlobal('localStorage', undefined);
    expect(rememberReceipt(existing)).toBe(false);
  });
});

describe('downloadReceipt', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('attaches the link, clicks it, removes it, and revokes the URL only after a delay', async () => {
    const receipt = await receiptFor(world());
    vi.useFakeTimers();
    const log: string[] = [];
    const anchor = {
      href: '',
      download: '',
      click: () => log.push(`click ${anchor.href} ${anchor.download}`),
      remove: () => log.push('remove'),
    };
    vi.stubGlobal('document', {
      createElement(tag: string) {
        log.push(`create ${tag}`);
        return anchor;
      },
      body: { append: (node: unknown) => log.push(node === anchor ? 'append' : 'append ?') },
    });
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', {
      createObjectURL(blob: Blob) {
        blobs.push(blob);
        return 'blob:receipt';
      },
      revokeObjectURL: (url: string) => log.push(`revoke ${url}`),
    });
    downloadReceipt(receipt);
    expect(log).toEqual([
      'create a',
      'append',
      `click blob:receipt ${receiptFileName(receipt)}`,
      'remove',
    ]);
    vi.advanceTimersByTime(REVOKE_DOWNLOAD_URL_AFTER_MS - 1);
    expect(log).not.toContain('revoke blob:receipt');
    vi.advanceTimersByTime(1);
    expect(log.at(-1)).toBe('revoke blob:receipt');
    expect(REVOKE_DOWNLOAD_URL_AFTER_MS).toBeGreaterThanOrEqual(5_000);
    expect(blobs[0]?.type).toBe('application/json');
    expect(JSON.parse(await (blobs[0] ?? new Blob()).text())).toEqual(
      JSON.parse(JSON.stringify(receipt))
    );
  });

  it('still removes the link and revokes the URL when the click throws', async () => {
    const receipt = await receiptFor(world());
    vi.useFakeTimers();
    const log: string[] = [];
    vi.stubGlobal('document', {
      createElement: () => ({
        click() {
          throw new Error('blocked');
        },
        remove: () => log.push('remove'),
      }),
      body: { append: () => log.push('append') },
    });
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:x',
      revokeObjectURL: (url: string) => log.push(`revoke ${url}`),
    });
    expect(() => downloadReceipt(receipt)).toThrow(/blocked/);
    vi.runAllTimers();
    expect(log).toEqual(['append', 'remove', 'revoke blob:x']);
  });
});

describe('receipts saved under the old project name', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function oldStyleReceipt(): Promise<Receipt> {
    const receipt = await receiptFor(world());
    receipt.quoteResponse.quoteRequest.referral = 'stxonector';
    return receipt;
  }

  it('still load and verify from an old-style receipt file', async () => {
    const file: unknown = JSON.parse(JSON.stringify(await oldStyleReceipt(), null, 2));
    const verified = verifyReceipt(file);
    expect(verified.depositAddress).toBe(D.address);
    expect(verified.quoteResponse.quoteRequest.referral).toBe('stxonector');
  });

  it('are found after the storage migration', async () => {
    const data = new Map<string, string>([
      [STXONECTOR_RECEIPTS_KEY, JSON.stringify([await oldStyleReceipt()])],
    ]);
    vi.stubGlobal('localStorage', {
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
    vi.stubGlobal('sessionStorage', undefined);
    migrateBrowserStorage();
    expect(data.has(STXONECTOR_RECEIPTS_KEY)).toBe(false);
    expect(data.has(RECEIPTS_KEY)).toBe(true);
    expect(loadReceipts().map(r => r.depositAddress)).toEqual([D.address]);
  });

  it('new receipt files use the new name', async () => {
    expect(receiptFileName(await receiptFor(world()))).toMatch(/^satway-deposit-/);
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

  it('stores the token decimals in new receipts and still loads receipts without them', async () => {
    const receipt = await receiptFor(world());
    expect(receipt.origin.decimals).toBe(6);
    expect(verifyReceipt(JSON.parse(JSON.stringify(receipt))).origin.decimals).toBe(6);
    const old = structuredClone(receipt);
    delete old.origin.decimals;
    expect(verifyReceipt(JSON.parse(JSON.stringify(old))).origin.decimals).toBeUndefined();
  });

  it.each([-1, 2.5, 100, '6'])('rejects a receipt with token decimals %j', async decimals => {
    const receipt = await receiptFor(world());
    expect(() => verifyReceipt({ ...receipt, origin: { ...receipt.origin, decimals } })).toThrow(
      /receipt file: origin\.decimals/
    );
  });

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

describe('sendAmountOf', () => {
  async function tampered(formatted: string): Promise<Receipt> {
    const receipt = await receiptFor(world());
    receipt.quoteResponse.quote.amountInFormatted = formatted;
    return receipt;
  }

  it('shows the verified amount from the base units and the stored decimals, not the provider text', async () => {
    const receipt = await tampered('250.0');
    expect(receipt.quoteResponse.quote.amountIn).toBe('25000000');
    expect(sendAmountOf(receipt, null)).toEqual({ kind: 'verified', text: '25.0' });
  });

  it('uses the token list decimals for an old receipt without them', async () => {
    const receipt = await tampered('2.5');
    delete receipt.origin.decimals;
    expect(sendAmountOf(receipt, 6)).toEqual({ kind: 'verified', text: '25.0' });
  });

  it('falls back to base units when no decimals are known at all', async () => {
    const receipt = await tampered('25.0');
    delete receipt.origin.decimals;
    expect(sendAmountOf(receipt, null)).toEqual({ kind: 'base-units', units: '25000000' });
  });

  it('formats an owed remainder the same way', async () => {
    const receipt = await receiptFor(world());
    expect(sendAmountOf(receipt, null, 1_500_000n)).toEqual({ kind: 'verified', text: '1.5' });
    delete receipt.origin.decimals;
    expect(sendAmountOf(receipt, null, 1_500_000n)).toEqual({
      kind: 'base-units',
      units: '1500000',
    });
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
