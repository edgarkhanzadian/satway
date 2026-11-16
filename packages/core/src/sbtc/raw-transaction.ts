import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

export function parseTransaction(transactionHex: string): btc.Transaction | null {
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

export function txidOf(tx: btc.Transaction): string | null {
  try {
    return tx.id;
  } catch {
    return null;
  }
}
