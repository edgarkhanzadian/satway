import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { MAINNET, buildSbtcReclaimTx } from 'sbtc';

import { type AddressOutput, type Payout, outpointOf } from '../bitcoin/index.js';
import { MAX_FEE_RATE_SATS_PER_VBYTE, feeRateAboveCapMessage } from '../shared/index.js';
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

export function blocksUntilReclaimFor(
  output: Pick<Payout, 'confirmed' | 'blockHeight'>,
  tipHeight: number | null,
  reclaimLockBlocks: number
): number | null {
  if (!output.confirmed || output.blockHeight === null || tipHeight === null) return null;
  const confirmations = tipHeight - output.blockHeight + 1;
  return Math.max(0, reclaimLockBlocks - confirmations);
}

export const RECLAIM_MIN_OUTPUT_SATS = 546;

const RECLAIM_CONTROL_BLOCK_BYTES = 65;
const SCHNORR_SIGNATURE_MAX_BYTES = 65;

function compactSizeBytes(n: number): number {
  if (n < 0xfd) return 1;
  return n <= 0xffff ? 3 : 5;
}

function pushedBytes(n: number): number {
  return compactSizeBytes(n) + n;
}

export function reclaimTxVsize(bitcoinAddress: string, reclaimLockBlocks: number): number {
  const outputScript = btc.OutScript.encode(btc.Address(btc.NETWORK).decode(bitcoinAddress));
  const reclaimScript = btc.Script.encode([
    reclaimLockBlocks,
    'CHECKSEQUENCEVERIFY',
    'DROP',
    new Uint8Array(32),
    'CHECKSIG',
  ]);
  const input = 32 + 4 + 1 + 4;
  const output = 8 + pushedBytes(outputScript.length);
  const base = 4 + 1 + input + 1 + output + 4;
  const witness =
    2 +
    1 +
    pushedBytes(SCHNORR_SIGNATURE_MAX_BYTES) +
    pushedBytes(reclaimScript.length) +
    pushedBytes(RECLAIM_CONTROL_BLOCK_BYTES);
  return Math.ceil((base * 4 + witness) / 4);
}

export function reclaimFeeSats(feeRate: number, vsize: number): number {
  return Math.ceil(vsize * feeRate);
}

export interface ReclaimFeeQuote {
  feeRate: number;
  vsize: number;
  feeSats: number;
  netSats: number;
}

export function reclaimFeeQuote(
  amountSats: number,
  feeRate: number,
  vsize: number
): ReclaimFeeQuote {
  const feeSats = reclaimFeeSats(feeRate, vsize);
  return { feeRate, vsize, feeSats, netSats: amountSats - feeSats };
}

export function reclaimAmountProblem(
  amountSats: number,
  feeRate: number,
  vsize: number
): string | null {
  const fee = reclaimFeeSats(feeRate, vsize);
  if (amountSats - fee >= RECLAIM_MIN_OUTPUT_SATS) return null;
  return `This output holds ${amountSats} sats, which cannot cover the reclaim fee of about ${fee} sats at ${feeRate} sat/vB and still leave a spendable amount. It is not worth reclaiming at this fee rate.`;
}

export interface ReclaimOption {
  output: AddressOutput;
  blocksUntilReclaim: number | null;
  ready: boolean;
}

export interface ReclaimPlan {
  target: ReclaimOption | null;
  options: ReclaimOption[];
  nothingLeft: boolean;
}

export function planReclaim(input: {
  outputs: readonly AddressOutput[];
  selected: Pick<AddressOutput, 'txid' | 'vout'> | null;
  tipHeight: number | null;
  reclaimLockBlocks: number;
}): ReclaimPlan {
  const options = input.outputs
    .filter(o => !o.spent)
    .map(output => {
      const blocks = blocksUntilReclaimFor(output, input.tipHeight, input.reclaimLockBlocks);
      return { output, blocksUntilReclaim: blocks, ready: blocks === 0 };
    })
    .sort(
      (a, b) =>
        b.output.amountSats - a.output.amountSats ||
        outpointOf(a.output).localeCompare(outpointOf(b.output))
    );
  const selected = input.selected ? outpointOf(input.selected) : null;
  return {
    target: options.find(o => outpointOf(o.output) === selected) ?? null,
    options,
    nothingLeft: options.length === 0,
  };
}

export function findReclaimOption(plan: ReclaimPlan, outpoint: string): ReclaimOption | null {
  const wanted = outpoint.trim().toLowerCase();
  return plan.options.find(o => outpointOf(o.output) === wanted) ?? null;
}

export function buildReclaimPsbt(input: ReclaimInput): {
  psbtHex: string;
  depositAddress: string;
  fee: ReclaimFeeQuote;
} {
  assertMainnetStandardAddress(input.stacksAddress);
  if (!(input.feeRate > 0)) throw new Error('Fee rate must be positive');
  if (input.feeRate > MAX_FEE_RATE_SATS_PER_VBYTE)
    throw new Error(feeRateAboveCapMessage(input.feeRate));
  const vsize = reclaimTxVsize(input.bitcoinAddress, input.reclaimLockBlocks);
  const problem = reclaimAmountProblem(input.payout.amountSats, input.feeRate, vsize);
  if (problem) throw new Error(problem);
  const fee = reclaimFeeQuote(input.payout.amountSats, input.feeRate, vsize);

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
  tx.updateOutput(0, { amount: BigInt(fee.netSats) });

  return { psbtHex: hex.encode(tx.toPSBT()), depositAddress: deposit.address, fee };
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
