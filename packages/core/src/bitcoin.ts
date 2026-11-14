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
