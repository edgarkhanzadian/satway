import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import { buildDepositAddress, buildReclaimPsbt, finalizeSignedReclaim } from '@satway/core';

import type { Wallets } from '../src/browser/harness.js';
import { expect, test } from '../src/fixtures.js';
import { outpointKey } from '../src/world/bitcoin.js';
import { field, parseJson, stringField } from '../src/world/http.js';
import type { World } from '../src/world/world.js';

function rpcError(code: number, message: string): string {
  return `sendrawtransaction RPC error: ${JSON.stringify({ code, message })}`;
}

function depositFor(world: World, wallets: Wallets) {
  const account = wallets.stacks.account;
  return buildDepositAddress({
    stacksAddress: account.stacksAddress,
    reclaimPublicKey: account.paymentKey.xOnly,
    signersPublicKey: world.signer.xOnly,
    maxSignerFeeSats: 80_000,
    reclaimLockBlocks: 950,
  });
}

async function signedReclaim(
  world: World,
  wallets: Wallets,
  payout: { txid: string; vout: number; amountSats: number },
  edit: (tx: btc.Transaction) => void = () => undefined
): Promise<{ txHex: string; txid: string }> {
  const account = wallets.stacks.account;
  const { psbtHex } = buildReclaimPsbt({
    payout,
    bitcoinAddress: account.paymentAddress,
    stacksAddress: account.stacksAddress,
    reclaimPublicKey: account.paymentKey.xOnly,
    signersPublicKey: world.signer.xOnly,
    maxSignerFeeSats: 80_000,
    reclaimLockBlocks: 950,
    feeRate: world.bitcoin.feeRates.halfHourFee,
  });
  const unsigned = btc.Transaction.fromPSBT(hex.decode(psbtHex), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
  });
  edit(unsigned);
  const reply = await wallets.stacks.handle({
    method: 'signPsbt',
    params: {
      psbt: base64.encode(unsigned.toPSBT()),
      signInputs: [{ index: 0, address: account.paymentAddress }],
      broadcast: false,
      network: 'mainnet',
    },
  });
  const signed = stringField(field(reply, 'result'), 'psbt');
  if (!signed) throw new Error(`The wallet did not sign: ${JSON.stringify(reply)}`);
  return finalizeSignedReclaim(base64.decode(signed));
}

function withWitness(txHex: string, change: (witness: Uint8Array[]) => Uint8Array[]): string {
  const tx = btc.Transaction.fromRaw(hex.decode(txHex), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  const witness = tx.getInput(0).finalScriptWitness ?? [];
  tx.updateInput(0, { finalScriptWitness: change(witness.map(w => Uint8Array.from(w))) }, true);
  return tx.hex;
}

function broadcast(world: World, txHex: string) {
  return world.bitcoin.serve('POST', '/api/tx', txHex);
}

test.describe('harness self-checks: the Bitcoin world validates spends', () => {
  test('a reclaim is refused before its CSV timelock and accepted at it; spent outputs leave the UTXO set', async ({
    world,
    wallets,
  }) => {
    const deposit = depositFor(world, wallets);
    const payout = world.treasury.pay([{ script: deposit.scriptPubKey, value: 50_000 }]);
    world.mine(1);
    const confirmedAt = world.bitcoin.tip.height;
    world.mine(948);
    const reclaim = await signedReclaim(world, wallets, {
      txid: payout.txid,
      vout: 0,
      amountSats: 50_000,
    });
    expect(world.bitcoin.tip.height + 1 - confirmedAt).toBe(949);
    expect(broadcast(world, reclaim.txHex)).toMatchObject({
      status: 400,
      body: rpcError(-26, 'non-BIP68-final'),
    });
    expect(world.bitcoin.isSpent({ txid: payout.txid, vout: 0 })).toBe(false);

    world.mine(1);
    expect(broadcast(world, reclaim.txHex)).toMatchObject({ status: 200, body: reclaim.txid });
    expect(world.bitcoin.serve('GET', `/api/address/${deposit.address}/utxo`, '').body).toBe('[]');
    expect(
      parseJson(world.bitcoin.serve('GET', `/api/tx/${payout.txid}/outspend/0`, '').body)
    ).toEqual({ spent: true, txid: reclaim.txid, vin: 0, status: { confirmed: false } });
    const mempool = parseJson(
      world.bitcoin.serve('GET', `/api/address/${deposit.address}/txs/mempool`, '').body
    );
    expect(Array.isArray(mempool) ? mempool.map(t => field(t, 'txid')) : []).toEqual([
      reclaim.txid,
    ]);
    expect(broadcast(world, reclaim.txHex)).toMatchObject({
      status: 400,
      body: rpcError(-26, 'txn-already-known'),
    });

    world.mine(1);
    const status = parseJson(world.bitcoin.serve('GET', `/api/tx/${reclaim.txid}/status`, '').body);
    expect(field(status, 'confirmed')).toBe(true);
    expect(field(status, 'block_height')).toBe(world.bitcoin.tip.height);
    const utxos = parseJson(
      world.bitcoin.serve('GET', `/api/address/${wallets.stacks.account.paymentAddress}/utxo`, '')
        .body
    );
    expect(Array.isArray(utxos) ? utxos.map(u => field(u, 'value')) : []).toEqual([
      50_000 - Math.ceil(126 * world.bitcoin.feeRates.halfHourFee),
    ]);
  });

  test('a reclaim with a bad signature, an uncommitted script or a short nSequence is refused', async ({
    world,
    wallets,
  }) => {
    const deposit = depositFor(world, wallets);
    const payout = world.treasury.pay([{ script: deposit.scriptPubKey, value: 60_000 }]);
    world.mine(951);
    const outpoint = { txid: payout.txid, vout: 0, amountSats: 60_000 };
    const good = await signedReclaim(world, wallets, outpoint);

    const badSig = withWitness(good.txHex, ([sig, ...rest]) => {
      const flipped = Uint8Array.from(sig ?? []);
      flipped[10] = (flipped[10] ?? 0) ^ 0xff;
      return [flipped, ...rest];
    });
    expect(broadcast(world, badSig)).toMatchObject({
      status: 400,
      body: rpcError(-26, 'mandatory-script-verify-flag-failed (Invalid Schnorr signature)'),
    });

    const otherLock = buildDepositAddress({
      stacksAddress: wallets.stacks.account.stacksAddress,
      reclaimPublicKey: wallets.stacks.account.paymentKey.xOnly,
      signersPublicKey: world.signer.xOnly,
      maxSignerFeeSats: 80_000,
      reclaimLockBlocks: 10,
    });
    const swapped = withWitness(good.txHex, ([sig, , control]) => [
      sig ?? new Uint8Array(),
      hex.decode(otherLock.reclaimScript),
      control ?? new Uint8Array(),
    ]);
    expect(broadcast(world, swapped)).toMatchObject({
      status: 400,
      body: rpcError(-26, 'mandatory-script-verify-flag-failed (Witness program hash mismatch)'),
    });

    const short = await signedReclaim(world, wallets, outpoint, tx =>
      tx.updateInput(0, { sequence: 10 }, true)
    );
    expect(broadcast(world, short.txHex)).toMatchObject({
      status: 400,
      body: rpcError(
        -26,
        'mandatory-script-verify-flag-failed (Locktime requirement not satisfied)'
      ),
    });
    expect(world.bitcoin.isSpent({ txid: payout.txid, vout: 0 })).toBe(false);
    expect(broadcast(world, good.txHex)).toMatchObject({ status: 200, body: good.txid });
  });

  test('a spend of a missing or already spent output is refused', async ({ world, wallets }) => {
    const deposit = depositFor(world, wallets);
    const payout = world.treasury.pay([{ script: deposit.scriptPubKey, value: 70_000 }]);
    world.mine(951);
    const reclaim = await signedReclaim(world, wallets, {
      txid: payout.txid,
      vout: 0,
      amountSats: 70_000,
    });
    const missing = await signedReclaim(world, wallets, {
      txid: payout.txid,
      vout: 5,
      amountSats: 70_000,
    });
    expect(broadcast(world, missing.txHex)).toMatchObject({
      status: 400,
      body: rpcError(-25, 'bad-txns-inputs-missingorspent'),
    });

    world.emily.seed({
      bitcoinTxid: payout.txid,
      bitcoinTxOutputIndex: 0,
      recipient: '',
      amount: 70_000,
      lastUpdateHeight: world.bitcoin.tip.height,
      lastUpdateBlockHash: world.bitcoin.tip.hash,
      status: 'accepted',
      statusMessage: '',
      parameters: { maxFee: 80_000, lockTime: 950 },
      reclaimScript: deposit.reclaimScript,
      depositScript: deposit.depositScript,
    });
    const sweep = world.signers.sweep({ txid: payout.txid, vout: 0 });
    expect(broadcast(world, reclaim.txHex)).toMatchObject({
      status: 400,
      body: rpcError(-26, 'txn-mempool-conflict'),
    });
    world.mine(1);
    expect(world.bitcoin.transaction(sweep.txid)?.height).toBe(world.bitcoin.tip.height);
    expect(broadcast(world, reclaim.txHex)).toMatchObject({
      status: 400,
      body: rpcError(-25, 'bad-txns-inputs-missingorspent'),
    });
  });
});

test.describe('harness self-checks: the Bitcoin world replaces and evicts unconfirmed payments', () => {
  function seen(world: World, address: string, path: string): unknown[] {
    const body = parseJson(world.bitcoin.serve('GET', `/api/address/${address}/${path}`, '').body);
    return Array.isArray(body) ? body.map(t => field(t, 'txid')) : [];
  }

  test('a replacement spends the same coin, the original disappears and only the new one confirms', ({
    world,
    wallets,
  }) => {
    const deposit = depositFor(world, wallets);
    world.reportDeposit({ depositAddress: world.liveSwapFor(deposit.address).depositAddress });
    const original = world.completeSwap();
    const replacement = world.replacePayout(original, {
      amountSats: original.amountSats - 300,
      changeFirst: true,
    });
    expect(replacement.tx.txid).not.toBe(original.tx.txid);
    expect(replacement.tx.inputs.map(outpointKey)).toEqual(original.tx.inputs.map(outpointKey));
    expect(replacement.outpoint.vout).toBe(1);
    expect(world.bitcoin.serve('GET', `/api/tx/${original.tx.txid}`, '').status).toBe(404);
    expect(seen(world, deposit.address, 'txs/mempool')).toEqual([replacement.tx.txid]);
    expect(world.swap().destinationTxHashes).toEqual([replacement.tx.txid]);
    expect(broadcast(world, original.tx.hex)).toMatchObject({
      status: 400,
      body: rpcError(-26, 'txn-mempool-conflict'),
    });
    world.mine(1);
    expect(seen(world, deposit.address, 'txs/chain')).toEqual([replacement.tx.txid]);
    expect(seen(world, deposit.address, 'txs/mempool')).toEqual([]);
  });

  test('an evicted payment leaves no trace and its coin can be spent again', ({
    world,
    wallets,
  }) => {
    const deposit = depositFor(world, wallets);
    world.reportDeposit({ depositAddress: world.liveSwapFor(deposit.address).depositAddress });
    const payout = world.completeSwap();
    world.evictPayout(payout);
    expect(world.bitcoin.serve('GET', `/api/tx/${payout.tx.txid}`, '').status).toBe(404);
    expect(world.bitcoin.serve('GET', `/api/address/${deposit.address}/utxo`, '').body).toBe('[]');
    expect(world.swap().destinationTxHashes).toEqual([payout.tx.txid]);
    const again = world.payTo(deposit.address, 30_000);
    expect(again.tx.inputs.map(outpointKey)).toEqual(payout.tx.inputs.map(outpointKey));
  });
});
