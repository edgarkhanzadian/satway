import { base58, base64 } from '@scure/base';

import type { Wallets } from '../src/browser/harness.js';
import { expect, test } from '../src/fixtures.js';
import { field, parseJson } from '../src/world/http.js';
import { signEd25519 } from '../src/world/keys.js';
import { SYSTEM_PROGRAM } from '../src/world/solana.js';
import type { World } from '../src/world/world.js';

function rpc(world: World, method: string, params: unknown[]): unknown {
  return parseJson(world.solana.serve({ jsonrpc: '2.0', id: 1, method, params }).body);
}

function latestBlockhash(world: World): { blockhash: string; lastValidBlockHeight: number } {
  const value = field(field(rpc(world, 'getLatestBlockhash', []), 'result'), 'value');
  const blockhash = field(value, 'blockhash');
  const lastValidBlockHeight = field(value, 'lastValidBlockHeight');
  if (typeof blockhash !== 'string' || typeof lastValidBlockHeight !== 'number')
    throw new Error('No blockhash');
  return { blockhash, lastValidBlockHeight };
}

function transfer(wallets: Wallets, to: string, lamports: bigint, blockhash: string): string {
  const data = new Uint8Array(12);
  data[0] = 2;
  let rest = lamports;
  for (let i = 4; i < 12; i++) {
    data[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  const message = Uint8Array.from([
    1,
    0,
    1,
    3,
    ...base58.decode(wallets.solana.address),
    ...base58.decode(to),
    ...base58.decode(SYSTEM_PROGRAM),
    ...base58.decode(blockhash),
    1,
    2,
    2,
    0,
    1,
    12,
    ...data,
  ]);
  const signature = signEd25519(wallets.solana.key, message);
  return base64.encode(Uint8Array.from([1, ...signature, ...message]));
}

function signatureOf(wire: string): string {
  return base58.encode(base64.decode(wire).subarray(1, 65));
}

function status(world: World, signature: string): unknown {
  const value = field(field(rpc(world, 'getSignatureStatuses', [[signature]]), 'result'), 'value');
  return Array.isArray(value) ? value[0] : undefined;
}

test.describe('harness self-checks: the Solana RPC world', () => {
  test('a blockhash expires 150 blocks after it was issued, by advance or by world time', ({
    world,
    wallets,
  }) => {
    const to = world.rng.base58(32);
    const first = latestBlockhash(world);
    expect(first.lastValidBlockHeight).toBe(world.solana.blockHeight + 150);
    world.solana.advance(150);
    const ok = transfer(wallets, to, 1_000_000n, first.blockhash);
    expect(field(rpc(world, 'sendTransaction', [ok]), 'result')).toBe(signatureOf(ok));

    world.solana.advance(1);
    const late = transfer(wallets, to, 2_000_000n, first.blockhash);
    expect(field(rpc(world, 'sendTransaction', [late]), 'error')).toEqual({
      code: -32002,
      message: 'Transaction simulation failed: Blockhash not found',
    });

    const second = latestBlockhash(world);
    expect(second.blockhash).not.toBe(first.blockhash);
    world.advanceClock(150 * 400);
    const still = transfer(wallets, to, 3_000_000n, second.blockhash);
    expect(field(rpc(world, 'sendTransaction', [still]), 'result')).toBe(signatureOf(still));
    world.advanceClock(400);
    const expired = transfer(wallets, to, 4_000_000n, second.blockhash);
    expect(field(field(rpc(world, 'sendTransaction', [expired]), 'error'), 'code')).toBe(-32002);
    expect(world.solana.lamports(to)).toBe(4_000_000n);
  });

  test('a send whose reply errors may or may not have landed, and resends are recorded byte for byte', ({
    world,
    wallets,
  }) => {
    const to = world.rng.base58(32);
    const { blockhash } = latestBlockhash(world);
    const accepted = transfer(wallets, to, 1_000_000n, blockhash);
    world.solana.sendReplyFaults.push('accept-then-error');
    expect(field(field(rpc(world, 'sendTransaction', [accepted]), 'error'), 'code')).toBe(-32603);
    expect(field(status(world, signatureOf(accepted)), 'err')).toBeNull();
    expect(world.solana.lamports(to)).toBe(1_000_000n);

    const dropped = transfer(wallets, to, 2_000_000n, blockhash);
    world.solana.sendReplyFaults.push('drop-then-error');
    expect(field(field(rpc(world, 'sendTransaction', [dropped]), 'error'), 'code')).toBe(-32603);
    expect(status(world, signatureOf(dropped))).toBeNull();
    expect(field(rpc(world, 'sendTransaction', [dropped]), 'result')).toBe(signatureOf(dropped));
    expect(world.solana.lamports(to)).toBe(3_000_000n);
    expect(world.solana.rpcSends).toEqual([accepted, dropped, dropped]);
  });

  test('a landed transaction can be processed, then confirmed, then finalized', ({
    world,
    wallets,
  }) => {
    world.solana.landAs = 'processed';
    const wire = transfer(
      wallets,
      world.rng.base58(32),
      1_000_000n,
      latestBlockhash(world).blockhash
    );
    rpc(world, 'sendTransaction', [wire]);
    const signature = signatureOf(wire);
    expect(field(status(world, signature), 'confirmationStatus')).toBe('processed');
    world.solana.promote(signature, 'confirmed');
    expect(field(status(world, signature), 'confirmationStatus')).toBe('confirmed');
    world.solana.advance(32);
    expect(field(status(world, signature), 'confirmationStatus')).toBe('finalized');
  });
});
