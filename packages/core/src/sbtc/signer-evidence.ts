import { z } from '../shared/index.js';
import { depositAddressFromScripts, depositLeafControlBlock } from './deposit-address.js';

export const evidenceDepositsSchema = z.looseObject({
  deposits: z.array(
    z.looseObject({
      bitcoinTxid: z.string(),
      bitcoinTxOutputIndex: z.number(),
      depositScript: z.string(),
      reclaimScript: z.string(),
    })
  ),
});

export type EvidenceDeposit = z.infer<typeof evidenceDepositsSchema>['deposits'][number];

export const evidenceOutspendSchema = z.looseObject({
  spent: z.boolean(),
  txid: z.string().optional(),
  vin: z.number().optional(),
  status: z.looseObject({ confirmed: z.boolean(), block_height: z.number().optional() }).optional(),
});

export type EvidenceOutspend = z.infer<typeof evidenceOutspendSchema>;

export const sweepTransactionSchema = z.looseObject({
  txid: z.string(),
  vin: z.array(
    z.looseObject({
      txid: z.string(),
      vout: z.number(),
      witness: z.array(z.string()).optional(),
      prevout: z.looseObject({ scriptpubkey: z.string(), value: z.number() }).nullable().optional(),
    })
  ),
  vout: z.array(z.looseObject({ scriptpubkey: z.string(), value: z.number() })),
  status: z.looseObject({ confirmed: z.boolean(), block_height: z.number().optional() }),
});

export type SweepTransaction = z.infer<typeof sweepTransactionSchema>;

export interface SignerEvidence {
  txid: string;
  vout: number;
  sweptAtHeight: number;
  blocksAgo: number;
  sweepTxid: string;
  sweepInput: number;
  signerUtxoSats: number;
}

export class EvidenceRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceRejected';
  }
}

const TXID = /^[0-9a-f]{64}$/;
const SCHNORR_SIGNATURE_HEX_LENGTHS = new Set([128, 130]);
const TAPROOT_OUTPUT = /^5120[0-9a-f]{64}$/;

export interface SpendRules {
  tipHeight: number;
  maxAgeBlocks: number;
  minSignerUtxoSats: number;
}

export function spendingTxidOf(deposit: EvidenceDeposit, outspend: EvidenceOutspend): string {
  if (!outspend.spent) throw new EvidenceRejected('the deposit output is not spent');
  const txid = outspend.txid?.toLowerCase();
  if (txid === undefined || !TXID.test(txid)) {
    throw new EvidenceRejected('the Bitcoin API did not say which transaction spent the deposit');
  }
  if (txid === deposit.bitcoinTxid.toLowerCase()) {
    throw new EvidenceRejected('the deposit is reported as spent by its own transaction');
  }
  return txid;
}

function signerUtxoSatsOf(
  sweep: SweepTransaction,
  depositInput: number,
  rules: SpendRules
): number {
  if (depositInput === 0) {
    throw new EvidenceRejected(
      'the deposit is the first input, where sweeps spend the signer UTXO'
    );
  }
  const carriedIn = sweep.vin[0]?.prevout?.scriptpubkey.toLowerCase();
  const carriedOut = sweep.vout[0];
  if (
    carriedIn === undefined ||
    carriedOut === undefined ||
    !TAPROOT_OUTPUT.test(carriedIn) ||
    carriedOut.scriptpubkey.toLowerCase() !== carriedIn
  ) {
    throw new EvidenceRejected(
      'the spend does not carry a signer UTXO from its first input to its first output'
    );
  }
  if (!Number.isSafeInteger(carriedOut.value) || carriedOut.value < rules.minSignerUtxoSats) {
    throw new EvidenceRejected(
      `the signer UTXO carried by the spend holds ${carriedOut.value} sats, under the ${rules.minSignerUtxoSats} required`
    );
  }
  return carriedOut.value;
}

export function checkDepositSweep(
  deposit: EvidenceDeposit,
  outspend: EvidenceOutspend,
  sweep: SweepTransaction,
  rules: SpendRules
): SignerEvidence {
  const sweepTxid = spendingTxidOf(deposit, outspend);
  if (sweep.txid.toLowerCase() !== sweepTxid) {
    throw new EvidenceRejected(`the Bitcoin API returned ${sweep.txid} instead of ${sweepTxid}`);
  }
  const depositTxid = deposit.bitcoinTxid.toLowerCase();
  const sweepInput = sweep.vin.findIndex(
    input => input.txid.toLowerCase() === depositTxid && input.vout === deposit.bitcoinTxOutputIndex
  );
  if (sweepInput < 0) throw new EvidenceRejected(`${sweepTxid} does not spend the deposit`);
  if (outspend.vin !== undefined && outspend.vin !== sweepInput) {
    throw new EvidenceRejected(
      `${sweepTxid} spends the deposit in a different input than reported`
    );
  }
  const input = sweep.vin[sweepInput];
  const depositScript = deposit.depositScript.toLowerCase();
  const expected = depositAddressFromScripts(depositScript, deposit.reclaimScript.toLowerCase());
  if (input?.prevout?.scriptpubkey.toLowerCase() !== expected.scriptPubKey) {
    throw new EvidenceRejected(`${sweepTxid} spends an output that is not the deposit address`);
  }
  const witness = (input.witness ?? []).map(item => item.toLowerCase());
  const [signature, script, controlBlock] = witness;
  if (witness.length !== 3 || signature === undefined || script !== depositScript) {
    throw new EvidenceRejected(`${sweepTxid} did not spend the deposit through its deposit script`);
  }
  if (!SCHNORR_SIGNATURE_HEX_LENGTHS.has(signature.length)) {
    throw new EvidenceRejected(`${sweepTxid} does not carry one Schnorr signature for the deposit`);
  }
  if (controlBlock !== depositLeafControlBlock(depositScript, deposit.reclaimScript)) {
    throw new EvidenceRejected(`${sweepTxid} reveals a control block for a different taproot tree`);
  }
  const height = sweep.status.block_height;
  if (!sweep.status.confirmed || height === undefined) {
    throw new EvidenceRejected(`${sweepTxid} is not confirmed`);
  }
  const blocksAgo = rules.tipHeight - height;
  if (blocksAgo < 0 || blocksAgo > rules.maxAgeBlocks) {
    throw new EvidenceRejected(
      `${sweepTxid} confirmed ${blocksAgo} blocks ago, outside the ${rules.maxAgeBlocks}-block window`
    );
  }
  const signerUtxoSats = signerUtxoSatsOf(sweep, sweepInput, rules);
  return {
    txid: depositTxid,
    vout: deposit.bitcoinTxOutputIndex,
    sweptAtHeight: height,
    blocksAgo,
    sweepTxid,
    sweepInput,
    signerUtxoSats,
  };
}
