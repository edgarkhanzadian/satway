import { describe, expect, it } from 'vitest';

import { type RpcFetch, createSolanaRpc, readAccount } from '../src/solana-rpc.js';

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

  it('sends a base64 transaction with preflight on', async () => {
    const { bodies, fetchFn } = fakeFetch({ result: 'sig' });
    expect(await createSolanaRpc(URL, fetchFn).send('AAAA')).toBe('sig');
    expect(bodies[0]).toMatchObject({
      method: 'sendTransaction',
      params: ['AAAA', { encoding: 'base64', skipPreflight: false }],
    });
  });
});
