import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import { depositAddressFromScripts } from './deposit-address.js';
import { type FetchLike, defaultFetch, requestJson, requestText } from './http.js';
import { z } from './schema.js';

export interface BtcTxOutput {
  scriptpubkey: string;
  value: number;
}

export interface BtcTx {
  txid: string;
  vout: BtcTxOutput[];
  status: { confirmed: boolean; block_height?: number };
}

const btcTxSchema: z.ZodType<BtcTx> = z.looseObject({
  txid: z.string(),
  vout: z.array(z.looseObject({ scriptpubkey: z.string(), value: z.number() })),
  status: z.looseObject({ confirmed: z.boolean(), block_height: z.number().optional() }),
});

const btcTxListSchema = z.array(btcTxSchema);

const outspendSchema = z.looseObject({ spent: z.boolean() });

export interface Payout {
  txid: string;
  vout: number;
  amountSats: number;
  confirmed: boolean;
  blockHeight: number | null;
}

export function payoutsInTx(tx: BtcTx, depositScriptPubKey: string): Payout[] {
  const wanted = depositScriptPubKey.toLowerCase();
  const found: Payout[] = [];
  tx.vout.forEach((out, vout) => {
    if (out.scriptpubkey.toLowerCase() === wanted) {
      found.push({
        txid: tx.txid,
        vout,
        amountSats: out.value,
        confirmed: tx.status.confirmed,
        blockHeight: tx.status.block_height ?? null,
      });
    }
  });
  return found;
}

export async function findPayouts(
  btcApiUrl: string,
  depositAddress: string,
  depositScriptPubKey: string,
  fetchFn: FetchLike = defaultFetch
): Promise<Payout[]> {
  const txs = await requestJson(
    fetchFn,
    `${btcApiUrl}/address/${depositAddress}/txs`,
    btcTxListSchema
  );
  return txs.flatMap(tx => payoutsInTx(tx, depositScriptPubKey));
}

export async function fetchTipHeight(
  btcApiUrl: string,
  fetchFn: FetchLike = defaultFetch
): Promise<number> {
  const text = await requestText(fetchFn, `${btcApiUrl}/blocks/tip/height`);
  const height = Number(text);
  if (!Number.isSafeInteger(height)) throw new Error('Bitcoin API returned a bad tip height');
  return height;
}

const TXID = /^[0-9a-f]{64}$/;
const EVEN_HEX = /^(?:[0-9a-f]{2})+$/;

export async function fetchTransactionHex(
  btcApiUrl: string,
  txid: string,
  fetchFn: FetchLike = defaultFetch
): Promise<string> {
  const wanted = txid.toLowerCase();
  if (!TXID.test(wanted)) throw new Error(`Not a Bitcoin txid: ${txid}`);
  const text = await requestText(fetchFn, `${btcApiUrl}/tx/${wanted}/hex`);
  const raw = text.trim().toLowerCase();
  if (!EVEN_HEX.test(raw)) throw new Error(`Bitcoin API returned non-hex data for tx ${wanted}`);
  return raw;
}

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

export function verifyDepositTransaction(transactionHex: string, expected: DepositOutpoint): void {
  const where = `${expected.txid}:${expected.vout}`;
  const tx = parseTransaction(transactionHex.toLowerCase());
  if (!tx) throw new Error(`Transaction data for ${where} does not parse as a Bitcoin transaction`);
  const txid = txidOf(tx);
  if (txid === null) throw new Error(`Could not compute the txid of the transaction for ${where}`);
  if (txid !== expected.txid.toLowerCase()) {
    throw new Error(`Transaction data for ${where} has txid ${txid} instead`);
  }
  if (
    !Number.isSafeInteger(expected.vout) ||
    expected.vout < 0 ||
    expected.vout >= tx.outputsLength
  ) {
    throw new Error(`Transaction ${expected.txid} has no output ${expected.vout}`);
  }
  const script = tx.getOutput(expected.vout).script;
  const wanted = depositAddressFromScripts(expected.depositScript, expected.reclaimScript);
  if (!script || hex.encode(script) !== wanted.scriptPubKey) {
    throw new Error(`Output ${where} does not pay the deposit address ${wanted.address}`);
  }
}

export async function isOutputSpent(
  btcApiUrl: string,
  txid: string,
  vout: number,
  fetchFn: FetchLike = defaultFetch
): Promise<boolean> {
  const res = await requestJson(
    fetchFn,
    `${btcApiUrl}/tx/${txid}/outspend/${vout}`,
    outspendSchema
  );
  return res.spent;
}
