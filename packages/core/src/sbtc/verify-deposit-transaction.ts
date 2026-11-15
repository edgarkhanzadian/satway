import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import { depositAddressFromScripts } from './deposit-address.js';

export interface DepositOutpoint {
  txid: string;
  vout: number;
  depositScript: string;
  reclaimScript: string;
}

function parseTransaction(transactionHex: string): btc.Transaction | null {
  try {
    const bytes = hex.decode(transactionHex);
    if (hex.encode(btc.RawTx.encode(btc.RawTx.decode(bytes))) !== transactionHex) return null;
    return btc.Transaction.fromRaw(bytes, {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
      disableScriptCheck: true,
    });
  } catch {
    return null;
  }
}

function txidOf(tx: btc.Transaction): string | null {
  try {
    return tx.id;
  } catch {
    return null;
  }
}

export class DepositCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DepositCheckError';
  }
}

export function verifyDepositTransaction(transactionHex: string, expected: DepositOutpoint): void {
  const where = `${expected.txid}:${expected.vout}`;
  const tx = parseTransaction(transactionHex.toLowerCase());
  if (!tx)
    throw new DepositCheckError(
      `Transaction data for ${where} does not parse as a Bitcoin transaction`
    );
  const txid = txidOf(tx);
  if (txid === null)
    throw new DepositCheckError(`Could not compute the txid of the transaction for ${where}`);
  if (txid !== expected.txid.toLowerCase()) {
    throw new DepositCheckError(`Transaction data for ${where} has txid ${txid} instead`);
  }
  if (
    !Number.isSafeInteger(expected.vout) ||
    expected.vout < 0 ||
    expected.vout >= tx.outputsLength
  ) {
    throw new DepositCheckError(`Transaction ${expected.txid} has no output ${expected.vout}`);
  }
  const script = tx.getOutput(expected.vout).script;
  const wanted = depositAddressFromScripts(expected.depositScript, expected.reclaimScript);
  if (!script || hex.encode(script) !== wanted.scriptPubKey) {
    throw new DepositCheckError(
      `Output ${where} does not pay the deposit address ${wanted.address}`
    );
  }
}
