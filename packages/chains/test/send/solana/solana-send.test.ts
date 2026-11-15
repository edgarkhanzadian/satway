import { base58, base64 } from '@scure/base';
import { describe, expect, it, vi } from 'vitest';

import type { OneClickToken } from '@portage/core';

import { SendError, type SolanaSendResult } from '../../../src/index.js';
import type {
  RawAccount,
  SignatureStatus,
  SimulationResult,
  SolanaRpc,
} from '../../../src/send/solana/solana-rpc.js';
import {
  type SignedSolanaSend,
  checkSolanaSend,
  resendSignedTransaction,
  sendSolanaDeposit,
  simulationReason,
  solanaPayOffer,
} from '../../../src/send/solana/solana-send.js';
import {
  TOKEN_2022_PROGRAM,
  associatedTokenAccount,
} from '../../../src/send/solana/solana-transfer.js';

const SYSTEM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SENDER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const DEPOSIT = '2CXBDfuKKrEmmo5vXnYbCEbUbDyweZcbL12gXC4vHC4G';
const SIG =
  '4QMdVtgtZcuygfB7RnGhZvrPxVDjXU7WgaKCaYEd2XSeQYMGKSrthoiV4GmL6pq2fu5gHaoiHofNEYTNSJuryyr';
const USDC_MINT_DATA = base64.decode(
  'AQAAAJj+huiNm+Lqi8HMpIeLKYjCQPUrhCS/tA7Rot3LXhmbXgh2TQqfHwAGAQEAAABicKqKWcWUBbRShshncubNEm6bil06OFNtN/e0FOi2Zw=='
);

const SOL: OneClickToken = {
  assetId: 'nep141:sol.omft.near',
  decimals: 9,
  blockchain: 'sol',
  symbol: 'SOL',
  price: 150,
};
const USDC: OneClickToken = {
  assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
  decimals: 6,
  blockchain: 'sol',
  symbol: 'USDC',
  price: 1,
  contractAddress: USDC_MINT,
};

const OK: SimulationResult = { err: null, logs: [], unitsConsumed: 150 };

function fakeRpc(opts: {
  accounts?: Record<string, RawAccount | null>;
  simulation?: SimulationResult;
  send?(): Promise<string>;
  rent?: bigint;
  statuses?: (SignatureStatus | null)[];
  height?: bigint;
}) {
  const sent: string[] = [];
  const simulated: string[] = [];
  const built: string[] = [];
  const statuses = [...(opts.statuses ?? [])];
  const rpc: SolanaRpc = {
    latestBlockhash() {
      built.push('latestBlockhash');
      return Promise.resolve({
        blockhash: 'BL2sQysVf3SYJqtmRgfXG6oUWf7RUSN4sHXM582sjJsZ',
        lastValidBlockHeight: 1000n,
      });
    },
    signatureStatus: () =>
      Promise.resolve(statuses.length > 1 ? (statuses.shift() ?? null) : (statuses[0] ?? null)),
    blockHeight: () => Promise.resolve(opts.height ?? 1n),
    accounts: addresses => Promise.resolve(addresses.map(a => opts.accounts?.[a] ?? null)),
    rentExemptMinimum: () => Promise.resolve(opts.rent ?? 890_880n),
    simulate(wire) {
      simulated.push(wire);
      return Promise.resolve(opts.simulation ?? OK);
    },
    send(wire) {
      sent.push(wire);
      return opts.send ? opts.send() : Promise.resolve(SIG);
    },
  };
  return { rpc, sent, simulated, built };
}

const funded = {
  [SENDER]: { owner: SYSTEM, lamports: 10n ** 10n, data: new Uint8Array(0), executable: false },
};

function account(result: (tx: Uint8Array) => SolanaSendResult) {
  const send = vi.fn((tx: Uint8Array) => Promise.resolve(result(tx)));
  return { address: SENDER, sender: { send }, send };
}

const input = { token: SOL, recipient: DEPOSIT, amount: '1000000000' };

describe('sendSolanaDeposit', () => {
  it('simulates first and refuses to ask the wallet when simulation fails', async () => {
    const { rpc, simulated } = fakeRpc({
      accounts: funded,
      simulation: {
        err: '{"InstructionError":[0,{"Custom":1}]}',
        logs: ['Program 111 invoke [1]', 'Transfer: insufficient lamports 5, need 10'],
        unitsConsumed: 150,
      },
    });
    const wallet = account(() => ({ kind: 'sent', signature: SIG }));
    await expect(sendSolanaDeposit(input, wallet, rpc)).rejects.toThrow(
      'Solana says this transfer would fail, so it was not sent: Transfer: insufficient lamports 5, need 10'
    );
    expect(simulated).toHaveLength(1);
    expect(wallet.send).not.toHaveBeenCalled();
  });

  it('returns the signature from a wallet that sends', async () => {
    const { rpc, sent, simulated } = fakeRpc({ accounts: funded });
    const wallet = account(() => ({ kind: 'sent', signature: SIG }));
    expect(await sendSolanaDeposit(input, wallet, rpc)).toBe(SIG);
    expect(sent).toEqual([]);
    expect(simulated).toHaveLength(1);
    expect(wallet.send.mock.calls[0]?.[0]).toEqual(base64.decode(String(simulated[0])));
  });

  it('rejects a wallet reply that is not a signature', async () => {
    const { rpc } = fakeRpc({ accounts: funded });
    const wallet = account(() => ({ kind: 'sent', signature: '0xdeadbeef' }));
    await expect(sendSolanaDeposit(input, wallet, rpc)).rejects.toThrow(/did not return/);
  });

  it('submits a signed transaction through the RPC when the message is unchanged', async () => {
    const { rpc, sent } = fakeRpc({ accounts: funded });
    const signature = base58.decode(SIG);
    const wallet = account(tx => {
      const signed = Uint8Array.from(tx);
      signed.set(signature, 1);
      return { kind: 'signed', transaction: signed };
    });
    expect(await sendSolanaDeposit(input, wallet, rpc)).toBe(SIG);
    expect(sent).toHaveLength(1);
    expect(base64.decode(String(sent[0])).subarray(1, 65)).toEqual(signature);
  });

  it('refuses a signed transaction whose message the wallet changed, or that is unsigned', async () => {
    const changed = fakeRpc({ accounts: funded });
    const tampered = account(tx => {
      const signed = Uint8Array.from(tx);
      signed.set(base58.decode(SIG), 1);
      signed[signed.length - 1] = (signed[signed.length - 1] ?? 0) ^ 1;
      return { kind: 'signed', transaction: signed };
    });
    await expect(sendSolanaDeposit(input, tampered, changed.rpc)).rejects.toThrow(
      'The wallet changed the transaction before signing it. Nothing was sent.'
    );
    expect(changed.sent).toEqual([]);

    const unsigned = fakeRpc({ accounts: funded });
    await expect(
      sendSolanaDeposit(
        input,
        account(tx => ({ kind: 'signed', transaction: tx })),
        unsigned.rpc
      )
    ).rejects.toThrow(/did not sign/);
    expect(unsigned.sent).toEqual([]);
  });

  it('explains an RPC send error', async () => {
    const { rpc } = fakeRpc({
      accounts: funded,
      send: () => Promise.reject(new Error('Solana RPC error: Blockhash not found')),
    });
    const wallet = account(tx => {
      const signed = Uint8Array.from(tx);
      signed.set(base58.decode(SIG), 1);
      return { kind: 'signed', transaction: signed };
    });
    await expect(sendSolanaDeposit(input, wallet, rpc)).rejects.toThrow(
      'Solana did not confirm that it accepted the signed transaction: Solana RPC error: Blockhash not found'
    );
  });

  it('hands over the signature, signed bytes and expiry before the RPC send, and keeps the signature when it fails', async () => {
    const order: string[] = [];
    const { rpc } = fakeRpc({
      accounts: funded,
      send() {
        order.push('rpc.send');
        return Promise.reject(new Error('Could not reach the Solana RPC: network error'));
      },
    });
    const wallet = account(tx => {
      const signed = Uint8Array.from(tx);
      signed.set(base58.decode(SIG), 1);
      return { kind: 'signed', transaction: signed };
    });
    const handed: SignedSolanaSend[] = [];
    const failure = await sendSolanaDeposit(input, wallet, rpc, {
      onSigned(signed) {
        order.push('onSigned');
        handed.push(signed);
      },
    }).catch((err: unknown) => err);
    expect(order).toEqual(['onSigned', 'rpc.send']);
    expect(handed[0]?.signature).toBe(SIG);
    expect(handed[0]?.lastValidBlockHeight).toBe(1000n);
    expect(base58.encode(handed[0]?.transaction.subarray(1, 65) ?? new Uint8Array())).toBe(SIG);
    expect(failure).toBeInstanceOf(SendError);
    if (!(failure instanceof SendError)) return;
    expect(failure.phase).toBe('uncertain');
    expect(failure.tx).toBe(SIG);
  });

  it('says nothing was sent when it fails before the wallet is asked', async () => {
    const { rpc } = fakeRpc({
      accounts: funded,
      simulation: { err: '"AccountNotFound"', logs: [], unitsConsumed: null },
    });
    const wallet = account(() => ({ kind: 'sent', signature: SIG }));
    const failure = await sendSolanaDeposit(input, wallet, rpc).catch((err: unknown) => err);
    expect(failure instanceof SendError && failure.phase).toBe('not-sent');
  });

  it('treats a lost reply from a sending wallet as uncertain and a rejection as rejected', async () => {
    const { rpc } = fakeRpc({ accounts: funded });
    const lost = {
      address: SENDER,
      sender: { send: () => Promise.reject(new Error('Request expired. Please try again.')) },
    };
    const lostFailure = await sendSolanaDeposit(input, lost, rpc).catch((err: unknown) => err);
    expect(lostFailure instanceof SendError && lostFailure.phase).toBe('uncertain');
    const rejecting = {
      address: SENDER,
      sender: {
        send: () => Promise.reject(Object.assign(new Error('User rejected'), { code: 4001 })),
      },
    };
    const rejected = await sendSolanaDeposit(input, rejecting, rpc).catch((err: unknown) => err);
    expect(rejected instanceof SendError && rejected.phase).toBe('rejected');
  });
});

describe('resendSignedTransaction', () => {
  it('sends exactly the saved bytes again and builds nothing new', async () => {
    const { rpc, sent, built, simulated } = fakeRpc({});
    const signed = Uint8Array.from([1, ...base58.decode(SIG), 7, 7, 7]);
    expect(await resendSignedTransaction({ signature: SIG, transaction: signed }, rpc)).toBe(SIG);
    expect(sent).toEqual([base64.encode(signed)]);
    expect(built).toEqual([]);
    expect(simulated).toEqual([]);
  });

  it('refuses bytes that do not carry the saved signature', async () => {
    const { rpc, sent } = fakeRpc({});
    const other = Uint8Array.from([1, ...new Array<number>(64).fill(3), 7]);
    await expect(
      resendSignedTransaction({ signature: SIG, transaction: other }, rpc)
    ).rejects.toThrow(/does not match/);
    expect(sent).toEqual([]);
  });
});

describe('checkSolanaSend', () => {
  it('reports a signature found on chain as landed, or failed when it errored', async () => {
    const landed = fakeRpc({ statuses: [{ err: null, confirmation: 'confirmed' }] }).rpc;
    expect(await checkSolanaSend({ signature: SIG, lastValidBlockHeight: 10n }, landed)).toEqual({
      status: 'landed',
    });
    const failed = fakeRpc({
      statuses: [{ err: '{"InstructionError":[0,"x"]}', confirmation: 'confirmed' }],
    }).rpc;
    expect(
      (await checkSolanaSend({ signature: SIG, lastValidBlockHeight: 10n }, failed)).status
    ).toBe('failed');
  });

  it('keeps a signature that is only processed, or has no commitment, pending: it can still be dropped', async () => {
    for (const confirmation of ['processed', null]) {
      for (const err of [null, '{"InstructionError":[0,"x"]}']) {
        const rpc = fakeRpc({ statuses: [{ err, confirmation }], height: 99n }).rpc;
        expect(await checkSolanaSend({ signature: SIG, lastValidBlockHeight: 10n }, rpc)).toEqual({
          status: 'pending',
        });
      }
    }
  });

  it('reports expiry only once the block height passed and the signature is still unknown', async () => {
    const before = fakeRpc({ statuses: [null], height: 10n }).rpc;
    expect(await checkSolanaSend({ signature: SIG, lastValidBlockHeight: 10n }, before)).toEqual({
      status: 'pending',
    });
    const after = fakeRpc({ statuses: [null], height: 11n }).rpc;
    expect(await checkSolanaSend({ signature: SIG, lastValidBlockHeight: 10n }, after)).toEqual({
      status: 'expired',
    });
    const raced = fakeRpc({
      statuses: [null, { err: null, confirmation: 'finalized' }],
      height: 11n,
    }).rpc;
    expect(await checkSolanaSend({ signature: SIG, lastValidBlockHeight: 10n }, raced)).toEqual({
      status: 'landed',
    });
    const noExpiry = fakeRpc({ statuses: [null], height: 99n }).rpc;
    expect(await checkSolanaSend({ signature: SIG, lastValidBlockHeight: null }, noExpiry)).toEqual(
      {
        status: 'pending',
      }
    );
  });

  it('refuses a quote with a memo before touching the network', async () => {
    const { rpc, simulated } = fakeRpc({ accounts: funded });
    const wallet = account(() => ({ kind: 'sent', signature: SIG }));
    await expect(sendSolanaDeposit({ ...input, memo: '7' }, wallet, rpc)).rejects.toThrow(/memo/);
    expect(simulated).toEqual([]);
    expect(wallet.send).not.toHaveBeenCalled();
  });
});

describe('simulationReason', () => {
  it('prefers the last error log line, then the error', () => {
    expect(
      simulationReason({
        err: 'x',
        logs: ['Program log: Error: one', 'ok', 'Program log: Error: insufficient funds'],
        unitsConsumed: null,
      })
    ).toBe('Error: insufficient funds');
    expect(simulationReason({ err: '"AccountNotFound"', logs: [], unitsConsumed: null })).toBe(
      '"AccountNotFound"'
    );
  });
});

describe('solanaPayOffer', () => {
  const mint = { owner: TOKEN_PROGRAM, lamports: 1n, data: USDC_MINT_DATA, executable: false };

  it('offers no link for an SPL token when the deposit has no token account', async () => {
    const { rpc } = fakeRpc({ accounts: { [USDC_MINT]: mint } });
    const offer = await solanaPayOffer(
      { token: USDC, recipient: DEPOSIT, amount: '25000000' },
      rpc
    );
    expect(offer.status).toBe('unavailable');
    if (offer.status === 'unavailable') expect(offer.reason).toMatch(/no token account yet/);
  });

  it('offers a link and QR when the deposit token account exists', async () => {
    const ata = await associatedTokenAccount(DEPOSIT, USDC_MINT);
    const data = new Uint8Array(165);
    data.set(base58.decode(USDC_MINT), 0);
    data.set(base58.decode(DEPOSIT), 32);
    data[108] = 1;
    const { rpc } = fakeRpc({
      accounts: {
        [USDC_MINT]: mint,
        [ata]: { owner: TOKEN_PROGRAM, lamports: 1n, data, executable: false },
      },
    });
    const offer = await solanaPayOffer(
      { token: USDC, recipient: DEPOSIT, amount: '25000000' },
      rpc
    );
    expect(offer.status).toBe('ready');
    if (offer.status !== 'ready') return;
    expect(offer.url).toBe(`solana:${DEPOSIT}?amount=25&spl-token=${USDC_MINT}`);
    expect(offer.matrix.length).toBeGreaterThan(20);
  });

  it('offers native SOL unless the amount cannot open a new deposit address', async () => {
    const ready = await solanaPayOffer(
      { token: SOL, recipient: DEPOSIT, amount: '1000000' },
      fakeRpc({}).rpc
    );
    expect(ready.status === 'ready' && ready.url).toBe(`solana:${DEPOSIT}?amount=0.001`);
    const small = await solanaPayOffer(
      { token: SOL, recipient: DEPOSIT, amount: '1000' },
      fakeRpc({}).rpc
    );
    expect(small.status).toBe('unavailable');
    const existing = await solanaPayOffer(
      { token: SOL, recipient: DEPOSIT, amount: '1000' },
      fakeRpc({
        accounts: {
          [DEPOSIT]: { owner: SYSTEM, lamports: 1n, data: new Uint8Array(0), executable: false },
        },
      }).rpc
    );
    expect(existing.status).toBe('ready');
  });

  it('offers no link for Token-2022, a memo, or an RPC failure', async () => {
    const t22 = await solanaPayOffer(
      { token: USDC, recipient: DEPOSIT, amount: '1' },
      fakeRpc({ accounts: { [USDC_MINT]: { ...mint, owner: TOKEN_2022_PROGRAM } } }).rpc
    );
    expect(t22.status === 'unavailable' && t22.reason).toMatch(/Token-2022/);
    const memo = await solanaPayOffer(
      { token: SOL, recipient: DEPOSIT, amount: '1000000', memo: 'x' },
      fakeRpc({}).rpc
    );
    expect(memo.status).toBe('unavailable');
    const broken = fakeRpc({}).rpc;
    broken.accounts = () => Promise.reject(new Error('Could not reach the Solana RPC'));
    const failed = await solanaPayOffer({ token: USDC, recipient: DEPOSIT, amount: '1' }, broken);
    expect(failed.status === 'unavailable' && failed.reason).toMatch(/Could not reach/);
  });
});
