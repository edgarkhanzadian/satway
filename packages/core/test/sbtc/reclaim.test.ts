import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { describe, expect, it } from 'vitest';

import {
  buildDepositAddress,
  buildReclaimPsbt,
  finalizeSignedReclaim,
  reclaimFeeQuote,
  signReclaimPsbt,
} from '../../src/index.js';
import { REAL_DEPOSIT as D, defined } from '../fixtures.js';

const DEST = 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys';
const input = {
  payout: { txid: D.txid, vout: D.vout, amountSats: 200_000 },
  bitcoinAddress: DEST,
  stacksAddress: D.stacksAddress,
  reclaimPublicKey: D.reclaimPublicKey,
  signersPublicKey: D.signersPublicKey,
  maxSignerFeeSats: D.maxSignerFeeSats,
  reclaimLockBlocks: D.reclaimLockBlocks,
  feeRate: 5,
};

describe('buildReclaimPsbt', () => {
  const { psbtHex, depositAddress } = buildReclaimPsbt(input);
  const tx = btc.Transaction.fromPSBT(hex.decode(psbtHex), { allowUnknownOutputs: true });

  it('spends exactly the payout output', () => {
    expect(depositAddress).toBe(D.address);
    expect(tx.inputsLength).toBe(1);
    const inp = tx.getInput(0);
    expect(hex.encode(defined(inp.txid))).toBe(D.txid);
    expect(inp.index).toBe(D.vout);
    const utxo = defined(inp.witnessUtxo);
    expect(hex.encode(utxo.script)).toBe(D.scriptPubKey);
    expect(utxo.amount).toBe(200_000n);
  });

  it('carries the relative timelock, so it cannot confirm early', () => {
    expect(tx.getInput(0).sequence).toBe(D.reclaimLockBlocks);
  });

  it('spends through the reclaim script leaf', () => {
    const leaves = tx.getInput(0).tapLeafScript ?? [];
    expect(leaves).toHaveLength(1);
    expect(hex.encode(defined(leaves[0])[1]).startsWith(D.reclaimScript)).toBe(true);
  });

  it('pays the user and nobody else, minus a sane fee', () => {
    expect(tx.outputsLength).toBe(1);
    const out = tx.getOutput(0);
    expect(btc.Address().encode(btc.OutScript.decode(defined(out.script)))).toBe(DEST);
    const fee = 200_000n - defined(out.amount);
    expect(fee).toBeGreaterThan(0n);
    expect(fee).toBeLessThan(5_000n);
  });

  it('refuses an output whose value cannot cover the fee, with a clear message', () => {
    expect(() =>
      buildReclaimPsbt({ ...input, payout: { ...input.payout, amountSats: 546 } })
    ).toThrow(/cannot cover the reclaim fee of about 630 sats/);
    expect(() =>
      buildReclaimPsbt({ ...input, payout: { ...input.payout, amountSats: 2_000 } })
    ).not.toThrow();
  });

  it('refuses a fee rate above the shared cap', () => {
    expect(() => buildReclaimPsbt({ ...input, feeRate: 501 })).toThrow(
      /above the 500 sat\/vB this page pays for a reclaim/
    );
    expect(() => buildReclaimPsbt({ ...input, feeRate: 500 })).not.toThrow();
  });

  it('quotes the fee it will pay and what is left, matching the built transaction', () => {
    const quote = reclaimFeeQuote(200_000, 5);
    expect(quote).toEqual({ feeRate: 5, vsize: 126, feeSats: 630, netSats: 199_370 });
    expect(tx.getOutput(0).amount).toBe(BigInt(quote.netSats));
  });

  it('rejects a non-positive fee rate and a bad recipient', () => {
    expect(() => buildReclaimPsbt({ ...input, feeRate: 0 })).toThrow();
    expect(() =>
      buildReclaimPsbt({ ...input, stacksAddress: 'ST000000000000000000002AMW42H' })
    ).toThrow();
  });
});

describe('signReclaimPsbt', () => {
  const priv = hex.decode('11'.repeat(32));
  const reclaimPublicKey = hex.encode(btc.utils.pubSchnorr(priv));
  const mine = { ...input, reclaimPublicKey };

  it('produces a fully signed transaction through the reclaim leaf', () => {
    const { psbtHex } = buildReclaimPsbt(mine);
    const { txHex, txid } = signReclaimPsbt(psbtHex, priv);
    const tx = btc.Transaction.fromRaw(hex.decode(txHex), { allowUnknownOutputs: true });
    expect(tx.id).toBe(txid);
    expect(tx.getInput(0).sequence).toBe(D.reclaimLockBlocks);
    const witness = defined(tx.getInput(0).finalScriptWitness);
    expect(witness).toHaveLength(3);
    expect(witness[0]).toHaveLength(64);
    const expected = buildDepositAddress({
      stacksAddress: D.stacksAddress,
      reclaimPublicKey,
      signersPublicKey: D.signersPublicKey,
      maxSignerFeeSats: D.maxSignerFeeSats,
      reclaimLockBlocks: D.reclaimLockBlocks,
    });
    expect(hex.encode(defined(witness[1]))).toBe(expected.reclaimScript);
  });

  it('finalises a PSBT that a wallet signed but did not finalise', () => {
    const { psbtHex } = buildReclaimPsbt(mine);
    const tx = btc.Transaction.fromPSBT(hex.decode(psbtHex), {
      allowUnknownOutputs: true,
      allowUnknownInputs: true,
    });
    tx.sign(priv);
    const fromWallet = finalizeSignedReclaim(tx.toPSBT());
    expect(fromWallet.txid).toBe(signReclaimPsbt(psbtHex, priv).txid);
    expect(() => finalizeSignedReclaim(hex.decode(psbtHex))).toThrow();
  });

  it('cannot be signed by a different key', () => {
    const { psbtHex } = buildReclaimPsbt(mine);
    expect(() => signReclaimPsbt(psbtHex, hex.decode('22'.repeat(32)))).toThrow();
  });
});
