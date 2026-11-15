import { describe, expect, it, vi } from 'vitest';

import {
  type RpcFetch,
  SOLANA_RPC_TIMEOUT_MS,
  createSolanaRpc,
  readAccount,
} from '../../../src/send/solana/solana-rpc.js';

const URL = 'https://rpc.example/solana';

function fakeFetch(reply: unknown, ok = true, status = 200) {
  const bodies: unknown[] = [];
  function fetchFn(_url: string, init: RequestInit): ReturnType<RpcFetch> {
    if (typeof init.body === 'string') bodies.push(JSON.parse(init.body));
    return Promise.resolve({ ok, status, json: () => Promise.resolve(reply) });
  }
  return { bodies, fetchFn };
}

describe('createSolanaRpc', () => {
  it('reads the latest blockhash', async () => {
    const { bodies, fetchFn } = fakeFetch({
      jsonrpc: '2.0',
      id: 1,
      result: { context: { slot: 1 }, value: { blockhash: 'abc', lastValidBlockHeight: 99 } },
    });
    const rpc = createSolanaRpc(URL, fetchFn);
    expect(await rpc.latestBlockhash()).toEqual({ blockhash: 'abc', lastValidBlockHeight: 99n });
    expect(bodies[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
    });
  });

  it('decodes base64 accounts and keeps missing ones as null', async () => {
    const { fetchFn } = fakeFetch({
      result: {
        value: [{ data: ['AQID', 'base64'], owner: 'o', lamports: 5, executable: false }, null],
      },
    });
    const accounts = await createSolanaRpc(URL, fetchFn).accounts(['a', 'b']);
    expect(accounts).toEqual([
      { owner: 'o', lamports: 5n, data: Uint8Array.from([1, 2, 3]), executable: false },
      null,
    ]);
  });

  it('refuses a reply with the wrong number of accounts or odd data', async () => {
    await expect(
      createSolanaRpc(URL, fakeFetch({ result: { value: [null] } }).fetchFn).accounts(['a', 'b'])
    ).rejects.toThrow(/wrong number/);
    expect(() => readAccount({ data: 'AQID', owner: 'o', lamports: 1 })).toThrow(/unexpected form/);
    expect(() => readAccount({ data: ['AQID', 'base58'], owner: 'o', lamports: 1 })).toThrow();
    expect(() => readAccount({ data: ['AQID', 'base64'], owner: '', lamports: 1 })).toThrow();
    expect(() => readAccount({ data: ['AQID', 'base64'], owner: 'o', lamports: -1 })).toThrow();
  });

  it('simulates without signature checks and reports the error and logs', async () => {
    const { bodies, fetchFn } = fakeFetch({
      result: {
        value: {
          err: { InstructionError: [0, { Custom: 1 }] },
          logs: ['Program log: Error: insufficient funds', 7],
          unitsConsumed: 4000,
        },
      },
    });
    const result = await createSolanaRpc(URL, fetchFn).simulate('AAAA');
    expect(result).toEqual({
      err: '{"InstructionError":[0,{"Custom":1}]}',
      logs: ['Program log: Error: insufficient funds'],
      unitsConsumed: 4000,
    });
    expect(bodies[0]).toMatchObject({
      method: 'simulateTransaction',
      params: ['AAAA', { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false }],
    });
  });

  it('surfaces RPC and HTTP errors', async () => {
    await expect(
      createSolanaRpc(
        URL,
        fakeFetch({ error: { code: -32002, message: 'Blockhash not found' } }).fetchFn
      ).send('AAAA')
    ).rejects.toThrow('Solana RPC error: Blockhash not found');
    await expect(
      createSolanaRpc(URL, fakeFetch({}, false, 429).fetchFn).latestBlockhash()
    ).rejects.toThrow('The Solana RPC answered 429');
    await expect(createSolanaRpc(URL, fakeFetch({}).fetchFn).send('AAAA')).rejects.toThrow(
      /no result/
    );
    function offline(): ReturnType<RpcFetch> {
      return Promise.reject(new Error('Failed to fetch'));
    }
    await expect(createSolanaRpc(URL, offline).send('AAAA')).rejects.toThrow(
      'Could not reach the Solana RPC: Failed to fetch'
    );
  });

  it('gives up on a call that never answers, by default after 15 seconds', async () => {
    vi.useFakeTimers();
    try {
      const signals: (AbortSignal | null | undefined)[] = [];
      function hanging(_url: string, init: RequestInit): ReturnType<RpcFetch> {
        signals.push(init.signal);
        return new Promise(() => undefined);
      }
      const pending = createSolanaRpc(URL, hanging).blockHeight();
      const outcome = expect(pending).rejects.toThrow(
        'Could not reach the Solana RPC: No answer from https://rpc.example/solana within 15 seconds'
      );
      await vi.advanceTimersByTimeAsync(SOLANA_RPC_TIMEOUT_MS);
      await outcome;
      expect(signals[0]?.aborted).toBe(true);
      const quick = createSolanaRpc(URL, hanging, { timeoutMs: 2_000 }).blockHeight();
      const quickOutcome = expect(quick).rejects.toThrow(/within 2 seconds/);
      await vi.advanceTimersByTimeAsync(2_000);
      await quickOutcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a base64 transaction with preflight on', async () => {
    const { bodies, fetchFn } = fakeFetch({ result: 'sig' });
    expect(await createSolanaRpc(URL, fetchFn).send('AAAA')).toBe('sig');
    expect(bodies[0]).toMatchObject({
      method: 'sendTransaction',
      params: ['AAAA', { encoding: 'base64', skipPreflight: false }],
    });
  });

  it('looks up a signature status across history, and null when unknown', async () => {
    const found = fakeFetch({
      result: { value: [{ err: null, confirmationStatus: 'finalized', slot: 9 }] },
    });
    expect(await createSolanaRpc(URL, found.fetchFn).signatureStatus('sig')).toEqual({
      err: null,
      confirmation: 'finalized',
    });
    expect(found.bodies[0]).toMatchObject({
      method: 'getSignatureStatuses',
      params: [['sig'], { searchTransactionHistory: true }],
    });
    const failed = fakeFetch({ result: { value: [{ err: { InstructionError: [0, 'x'] } }] } });
    expect((await createSolanaRpc(URL, failed.fetchFn).signatureStatus('sig'))?.err).toBe(
      '{"InstructionError":[0,"x"]}'
    );
    const unknown = fakeFetch({ result: { value: [null] } });
    expect(await createSolanaRpc(URL, unknown.fetchFn).signatureStatus('sig')).toBeNull();
    await expect(
      createSolanaRpc(URL, fakeFetch({ result: { value: [] } }).fetchFn).signatureStatus('sig')
    ).rejects.toThrow(/no signature status/);
  });

  it('reads the confirmed block height', async () => {
    const { bodies, fetchFn } = fakeFetch({ result: 1234 });
    expect(await createSolanaRpc(URL, fetchFn).blockHeight()).toBe(1234n);
    expect(bodies[0]).toMatchObject({
      method: 'getBlockHeight',
      params: [{ commitment: 'confirmed' }],
    });
  });
});
