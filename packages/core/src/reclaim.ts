import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { MAINNET, buildSbtcReclaimTx } from 'sbtc';

import type { Payout } from './bitcoin.js';
import { assertMainnetStandardAddress, buildDepositAddress, toXOnly } from './deposit-address.js';

export interface ReclaimInput {
  payout: Pick<Payout, 'txid' | 'vout' | 'amountSats'>;
  bitcoinAddress: string;
  stacksAddress: string;
  reclaimPublicKey: string;
  signersPublicKey: string;
  maxSignerFeeSats: number;
  reclaimLockBlocks: number;
  feeRate: number;
}

export function buildReclaimPsbt(input: ReclaimInput): { psbtHex: string; depositAddress: string } {
  assertMainnetStandardAddress(input.stacksAddress);
  if (!(input.feeRate > 0)) throw new Error('Fee rate must be positive');

  const deposit = buildDepositAddress({
    stacksAddress: input.stacksAddress,
    reclaimPublicKey: input.reclaimPublicKey,
    signersPublicKey: input.signersPublicKey,
    maxSignerFeeSats: input.maxSignerFeeSats,
    reclaimLockBlocks: input.reclaimLockBlocks,
  });

  const tx = buildSbtcReclaimTx({
    network: MAINNET,
    amountSats: input.payout.amountSats,
    bitcoinAddress: input.bitcoinAddress,
    stacksAddress: input.stacksAddress,
    signersPublicKey: toXOnly(input.signersPublicKey),
    maxSignerFee: input.maxSignerFeeSats,
    reclaimLockTime: input.reclaimLockBlocks,
    reclaimPublicKey: toXOnly(input.reclaimPublicKey),
    txid: input.payout.txid,
    vout: input.payout.vout,
    feeRate: input.feeRate,
  });

  return { psbtHex: hex.encode(tx.toPSBT()), depositAddress: deposit.address };
}

export function signReclaimPsbt(
  psbtHex: string,
  privateKey: Uint8Array
): { txHex: string; txid: string } {
  const tx = btc.Transaction.fromPSBT(hex.decode(psbtHex), {
    allowUnknownOutputs: true,
    allowUnknownInputs: true,
  });
  tx.sign(privateKey);
  tx.finalize();
  return { txHex: tx.hex, txid: tx.id };
}

export function finalizeSignedReclaim(signedPsbt: Uint8Array): { txHex: string; txid: string } {
  const tx = btc.Transaction.fromPSBT(signedPsbt, {
    allowUnknownOutputs: true,
    allowUnknownInputs: true,
  });
  if (!tx.isFinal) tx.finalize();
  return { txHex: tx.hex, txid: tx.id };
}
