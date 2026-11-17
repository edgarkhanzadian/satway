import {
  type FetchLike,
  HttpError,
  SLOW_REQUEST_TIMEOUT_MS,
  defaultFetch,
  requestJson,
  requestText,
  z,
} from '../shared/index.js';

export interface BtcTxOutput {
  scriptpubkey: string;
  value: number;
}

export interface BtcTxStatus {
  confirmed: boolean;
  block_height?: number;
  block_time?: number;
}

export interface BtcTx {
  txid: string;
  vout: BtcTxOutput[];
  status: BtcTxStatus;
}

const btcTxStatusSchema: z.ZodType<BtcTxStatus> = z.looseObject({
  confirmed: z.boolean(),
  block_height: z.number().optional(),
  block_time: z.number().optional(),
});

const btcTxSchema: z.ZodType<BtcTx> = z.looseObject({
  txid: z.string(),
  vout: z.array(z.looseObject({ scriptpubkey: z.string(), value: z.number() })),
  status: btcTxStatusSchema,
});

const btcTxListSchema = z.array(btcTxSchema);

interface BtcUtxo {
  txid: string;
  vout: number;
  value: number;
  status: BtcTxStatus;
}

const btcUtxoListSchema: z.ZodType<BtcUtxo[]> = z.array(
  z.looseObject({
    txid: z.string(),
    vout: z.number(),
    value: z.number(),
    status: btcTxStatusSchema,
  })
);

const outspendSchema = z.looseObject({ spent: z.boolean() });

export interface Payout {
  txid: string;
  vout: number;
  amountSats: number;
  confirmed: boolean;
  blockHeight: number | null;
}

export interface SeenOutput extends Payout {
  blockTime: number | null;
}

export interface AddressOutput extends SeenOutput {
  spent: boolean;
}

export function outpointOf(output: Pick<Payout, 'txid' | 'vout'>): string {
  return `${output.txid.toLowerCase()}:${output.vout}`;
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

function seenInTx(tx: BtcTx, depositScriptPubKey: string): SeenOutput[] {
  return payoutsInTx(tx, depositScriptPubKey).map(p => ({
    ...p,
    blockTime: tx.status.block_time ?? null,
  }));
}

export const ESPLORA_CHAIN_PAGE_SIZE = 25;
export const ESPLORA_MEMPOOL_LIMIT = 50;
export const DEFAULT_HISTORY_PAGES = 8;
export const MAX_DIRECT_TX_LOOKUPS = 4;

export class TooManyOutputsError extends Error {
  constructor(readonly address: string) {
    super(
      `The Bitcoin API refuses to list the unspent outputs of ${address} because there are too many. Check the address in a block explorer.`
    );
    this.name = 'TooManyOutputsError';
  }
}

export async function fetchUnspentOutputs(
  btcApiUrl: string,
  depositAddress: string,
  fetchFn: FetchLike = defaultFetch
): Promise<AddressOutput[]> {
  let utxos: BtcUtxo[];
  try {
    utxos = await requestJson(
      fetchFn,
      `${btcApiUrl}/address/${depositAddress}/utxo`,
      btcUtxoListSchema
    );
  } catch (err) {
    if (err instanceof HttpError && err.status === 400 && /too many/i.test(err.body)) {
      throw new TooManyOutputsError(depositAddress);
    }
    throw err;
  }
  return utxos.map(u => ({
    txid: u.txid.toLowerCase(),
    vout: u.vout,
    amountSats: u.value,
    confirmed: u.status.confirmed,
    blockHeight: u.status.block_height ?? null,
    blockTime: u.status.block_time ?? null,
    spent: false,
  }));
}

export interface AddressHistory {
  outputs: SeenOutput[];
  truncated: boolean;
  requests: number;
}

export async function fetchAddressHistory(
  btcApiUrl: string,
  depositAddress: string,
  depositScriptPubKey: string,
  options: { maxPages?: number; fetchFn?: FetchLike } = {}
): Promise<AddressHistory> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_HISTORY_PAGES);
  const base = `${btcApiUrl}/address/${depositAddress}/txs`;
  const mempool = await requestJson(fetchFn, `${base}/mempool`, btcTxListSchema);
  const txs: BtcTx[] = [...mempool];
  let truncated = mempool.length >= ESPLORA_MEMPOOL_LIMIT;
  let pages = 0;
  let lastSeen: string | null = null;
  for (;;) {
    const url: string = lastSeen === null ? `${base}/chain` : `${base}/chain/${lastSeen}`;
    const page = await requestJson(fetchFn, url, btcTxListSchema);
    pages += 1;
    txs.push(...page);
    const last = page.at(-1);
    if (!last || page.length < ESPLORA_CHAIN_PAGE_SIZE || last.txid === lastSeen) break;
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    lastSeen = last.txid;
  }
  return {
    outputs: txs.flatMap(tx => seenInTx(tx, depositScriptPubKey)),
    truncated,
    requests: pages + 1,
  };
}

export async function fetchTransaction(
  btcApiUrl: string,
  txid: string,
  fetchFn: FetchLike = defaultFetch
): Promise<BtcTx | null> {
  const wanted = txid.toLowerCase();
  if (!TXID.test(wanted)) throw new Error(`Not a Bitcoin txid: ${txid}`);
  try {
    return await requestJson(fetchFn, `${btcApiUrl}/tx/${wanted}`, btcTxSchema);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

export interface DepositOutputs {
  outputs: AddressOutput[];
  truncated: boolean;
  foreignTxids: string[];
  missingTxids: string[];
  requests: number;
}

export interface DepositOutputsOptions {
  txids?: readonly string[];
  maxPages?: number;
  fetchFn?: FetchLike;
}

function addSeen(into: Map<string, SeenOutput>, outputs: readonly SeenOutput[]): void {
  for (const o of outputs) {
    const key = outpointOf(o);
    if (!into.has(key)) into.set(key, { ...o, txid: o.txid.toLowerCase() });
  }
}

export async function fetchDepositOutputs(
  btcApiUrl: string,
  depositAddress: string,
  depositScriptPubKey: string,
  options: DepositOutputsOptions = {}
): Promise<DepositOutputs> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const seen = new Map<string, SeenOutput>();
  const history = await fetchAddressHistory(btcApiUrl, depositAddress, depositScriptPubKey, {
    maxPages: options.maxPages,
    fetchFn,
  });
  let requests = history.requests;
  addSeen(seen, history.outputs);
  const unspent = await fetchUnspentOutputs(btcApiUrl, depositAddress, fetchFn);
  requests += 1;
  const seenTxids = new Set([...seen.values(), ...unspent].map(o => o.txid.toLowerCase()));
  const txids = [...new Set((options.txids ?? []).map(t => t.toLowerCase()))].filter(
    t => TXID.test(t) && !seenTxids.has(t)
  );
  const foreignTxids: string[] = [];
  const missingTxids: string[] = [];
  for (const txid of txids.slice(0, MAX_DIRECT_TX_LOOKUPS)) {
    const tx = await fetchTransaction(btcApiUrl, txid, fetchFn);
    requests += 1;
    if (!tx) {
      missingTxids.push(txid);
      continue;
    }
    const found = seenInTx(tx, depositScriptPubKey);
    if (found.length === 0) foreignTxids.push(txid);
    addSeen(seen, found);
  }
  const unspentKeys = new Set(unspent.map(outpointOf));
  const outputs: AddressOutput[] = [...unspent];
  for (const [key, o] of seen) {
    if (unspentKeys.has(key)) continue;
    outputs.push({ ...o, spent: o.confirmed });
  }
  return { outputs, truncated: history.truncated, foreignTxids, missingTxids, requests };
}

const addressStatsSchema = z.looseObject({
  chain_stats: z.looseObject({ tx_count: z.number() }),
  mempool_stats: z.looseObject({ tx_count: z.number() }),
});

export async function fetchAddressTxCount(
  btcApiUrl: string,
  address: string,
  options: { fetchFn?: FetchLike; signal?: AbortSignal } = {}
): Promise<number> {
  const stats = await requestJson(
    options.fetchFn ?? defaultFetch,
    `${btcApiUrl}/address/${address}`,
    addressStatsSchema,
    { signal: options.signal }
  );
  return stats.chain_stats.tx_count + stats.mempool_stats.tx_count;
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

export async function broadcastTransaction(
  btcApiUrl: string,
  txHex: string,
  fetchFn: FetchLike = defaultFetch
): Promise<string> {
  try {
    const txid = await requestText(fetchFn, `${btcApiUrl}/tx`, {
      method: 'POST',
      body: txHex,
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS,
    });
    return txid.trim();
  } catch (err) {
    if (err instanceof HttpError) {
      throw new Error(`The Bitcoin network rejected the transaction: ${err.body}`, { cause: err });
    }
    throw err;
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
