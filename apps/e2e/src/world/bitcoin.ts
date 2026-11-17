import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import { type Reply, json, notFound, text } from './http.js';
import { type BitcoinKey, p2trOf, p2wpkhOf } from './keys.js';
import type { Rng } from './random.js';
import { checkSpend } from './script-check.js';

export const SBTC_UNSPENDABLE_KEY =
  '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

const CHAIN_PAGE_SIZE = 25;
const MEMPOOL_LIMIT = 50;
const BLOCK_SECONDS = 600;

export interface ChainOutput {
  script: string;
  address: string | null;
  value: number;
}

export interface ChainInput {
  txid: string;
  vout: number;
  witness: string[];
  sequence: number;
}

export interface ChainTx {
  txid: string;
  hex: string;
  inputs: ChainInput[];
  outputs: ChainOutput[];
  vsize: number;
  height: number | null;
  seq: number;
}

export interface Block {
  height: number;
  hash: string;
  time: number;
}

export interface Outpoint {
  txid: string;
  vout: number;
}

export function outpointKey(o: Outpoint): string {
  return `${o.txid}:${o.vout}`;
}

export function addressOfScript(script: string): string | null {
  try {
    return btc.Address(btc.NETWORK).encode(btc.OutScript.decode(hex.decode(script)));
  } catch {
    return null;
  }
}

export function scriptOfAddress(address: string): string {
  return hex.encode(btc.OutScript.encode(btc.Address(btc.NETWORK).decode(address)));
}

function heightRank(tx: { height: number | null }): number {
  return tx.height === null ? Number.MAX_SAFE_INTEGER : tx.height;
}

function scriptType(script: string): string {
  if (/^5120[0-9a-f]{64}$/.test(script)) return 'v1_p2tr';
  if (/^0014[0-9a-f]{40}$/.test(script)) return 'v0_p2wpkh';
  if (/^0020[0-9a-f]{64}$/.test(script)) return 'v0_p2wsh';
  return 'unknown';
}

export function parseRawTransaction(rawHex: string): Omit<ChainTx, 'height' | 'seq'> {
  const bytes = hex.decode(rawHex);
  const tx = btc.Transaction.fromRaw(bytes, {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  const inputs: ChainInput[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    if (!input.txid || input.index === undefined)
      throw new Error('Transaction input is incomplete');
    inputs.push({
      txid: hex.encode(input.txid),
      vout: input.index,
      sequence: input.sequence ?? 0xffffffff,
      witness: (input.finalScriptWitness ?? []).map(w => hex.encode(w)),
    });
  }
  const outputs: ChainOutput[] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const output = tx.getOutput(i);
    if (!output.script || output.amount === undefined)
      throw new Error('Transaction output is incomplete');
    const script = hex.encode(output.script);
    outputs.push({ script, address: addressOfScript(script), value: Number(output.amount) });
  }
  return { txid: tx.id, hex: rawHex.toLowerCase(), inputs, outputs, vsize: tx.vsize };
}

function addressStats(script: string, txs: readonly ChainTx[]) {
  return {
    funded_txo_count: txs.reduce(
      (n, tx) => n + tx.outputs.filter(o => o.script === script).length,
      0
    ),
    tx_count: txs.length,
  };
}

export class BitcoinChain {
  readonly blocks: Block[] = [];
  private readonly txs = new Map<string, ChainTx>();
  private readonly spentBy = new Map<string, { txid: string; vin: number }>();
  private seq = 0;
  private readonly rng: Rng;
  private clockSeconds: number;
  readonly feeRates = { fastestFee: 6, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 };

  constructor(rng: Rng, startHeight: number, nowSeconds: number) {
    this.rng = rng;
    this.clockSeconds = nowSeconds - BLOCK_SECONDS * 200;
    for (let height = startHeight - 200; height <= startHeight; height++) this.appendBlock(height);
  }

  private appendBlock(height: number): Block {
    this.clockSeconds += BLOCK_SECONDS;
    const block = {
      height,
      hash: `00000000000000000000${this.rng.hex(22)}`,
      time: this.clockSeconds,
    };
    this.blocks.push(block);
    return block;
  }

  get tip(): Block {
    const last = this.blocks.at(-1);
    if (!last) throw new Error('The world chain has no blocks');
    return last;
  }

  blockAt(height: number): Block | null {
    return this.blocks.find(b => b.height === height) ?? null;
  }

  transaction(txid: string): ChainTx | null {
    return this.txs.get(txid.toLowerCase()) ?? null;
  }

  allTransactions(): ChainTx[] {
    return [...this.txs.values()];
  }

  isSpent(o: Outpoint): boolean {
    return this.spentBy.has(outpointKey(o));
  }

  output(o: Outpoint): ChainOutput | null {
    return this.txs.get(o.txid)?.outputs[o.vout] ?? null;
  }

  checkSpendable(tx: Omit<ChainTx, 'height' | 'seq'>, unchecked = false): string | null {
    if (this.txs.has(tx.txid)) return 'txn-already-known';
    for (const input of tx.inputs) {
      const prev = this.txs.get(input.txid);
      if (!prev) {
        if (unchecked) continue;
        return 'bad-txns-inputs-missingorspent';
      }
      if (!prev.outputs[input.vout]) return 'bad-txns-inputs-missingorspent';
      const spend = this.spentBy.get(outpointKey(input));
      if (spend) {
        const spender = this.txs.get(spend.txid);
        return spender?.height === null ? 'txn-mempool-conflict' : 'bad-txns-inputs-missingorspent';
      }
    }
    if (unchecked) return null;
    return checkSpend(tx.hex, {
      prevout: o => this.output(o),
      heightOf: txid => this.txs.get(txid)?.height ?? null,
      nextHeight: this.tip.height + 1,
    });
  }

  readonly hexOverrides = new Map<string, string>();
  readonly rejected: { hex: string; reason: string }[] = [];

  add(rawHex: string, options: { confirmedAt?: number; unchecked?: boolean } = {}): ChainTx {
    const parsed = parseRawTransaction(rawHex);
    const problem = this.checkSpendable(parsed, options.unchecked === true);
    if (problem) {
      this.rejected.push({ hex: rawHex, reason: problem });
      throw new Error(problem);
    }
    this.seq += 1;
    const tx: ChainTx = { ...parsed, height: options.confirmedAt ?? null, seq: this.seq };
    this.txs.set(tx.txid, tx);
    tx.inputs.forEach((input, vin) => this.spentBy.set(outpointKey(input), { txid: tx.txid, vin }));
    return tx;
  }

  private readonly dropped = new Set<string>();

  drop(txid: string): ChainTx {
    const tx = this.txs.get(txid);
    if (!tx) throw new Error(`Unknown transaction ${txid}`);
    if (tx.height !== null) throw new Error(`Transaction ${txid} is already confirmed`);
    if ([...this.txs.values()].some(t => t.inputs.some(i => i.txid === txid)))
      throw new Error(`Transaction ${txid} has descendants`);
    this.txs.delete(txid);
    this.dropped.add(txid);
    for (const input of tx.inputs) this.spentBy.delete(outpointKey(input));
    return tx;
  }

  replace(txid: string, rawHex: string): ChainTx {
    this.drop(txid);
    return this.add(rawHex);
  }

  mempool(): ChainTx[] {
    return [...this.txs.values()].filter(t => t.height === null);
  }

  mine(count = 1): Block[] {
    const mined: Block[] = [];
    for (let i = 0; i < count; i++) {
      const block = this.appendBlock(this.tip.height + 1);
      if (i === 0) for (const tx of this.mempool()) tx.height = block.height;
      mined.push(block);
    }
    return mined;
  }

  status(tx: ChainTx): Record<string, unknown> {
    const block = tx.height === null ? null : this.blockAt(tx.height);
    if (!block) return { confirmed: false };
    return {
      confirmed: true,
      block_height: block.height,
      block_hash: block.hash,
      block_time: block.time,
    };
  }

  private esploraTx(tx: ChainTx): Record<string, unknown> {
    let inValue = 0;
    const vin = tx.inputs.map(input => {
      const prev = this.output(input);
      inValue += prev?.value ?? 0;
      return {
        txid: input.txid,
        vout: input.vout,
        prevout: prev
          ? {
              scriptpubkey: prev.script,
              scriptpubkey_type: scriptType(prev.script),
              scriptpubkey_address: prev.address ?? undefined,
              value: prev.value,
            }
          : null,
        scriptsig: '',
        witness: input.witness,
        is_coinbase: false,
        sequence: input.sequence,
      };
    });
    const outValue = tx.outputs.reduce((sum, o) => sum + o.value, 0);
    return {
      txid: tx.txid,
      version: 2,
      locktime: 0,
      vin,
      vout: tx.outputs.map(o => ({
        scriptpubkey: o.script,
        scriptpubkey_type: scriptType(o.script),
        ...(o.address ? { scriptpubkey_address: o.address } : {}),
        value: o.value,
      })),
      size: tx.hex.length / 2,
      weight: tx.vsize * 4,
      fee: Math.max(0, inValue - outValue),
      status: this.status(tx),
    };
  }

  private touches(tx: ChainTx, script: string): boolean {
    return (
      tx.outputs.some(o => o.script === script) ||
      tx.inputs.some(i => this.output(i)?.script === script)
    );
  }

  private newestFirst(a: ChainTx, b: ChainTx): number {
    return heightRank(b) - heightRank(a) || b.seq - a.seq;
  }

  serve(method: string, path: string, body: string): Reply {
    const parts = path.split('/').filter(Boolean);
    if (parts[0] !== 'api') return notFound('Not found');
    const rest = parts.slice(1);
    if (method === 'POST' && rest.length === 1 && rest[0] === 'tx') return this.broadcast(body);
    if (method !== 'GET') return notFound('Not found');
    const [head, a, b, c, d] = rest;
    if (head === 'blocks' && a === 'tip' && b === 'height' && rest.length === 3) {
      return text(String(this.tip.height));
    }
    if (head === 'v1' && a === 'fees' && b === 'recommended' && rest.length === 3) {
      return json(this.feeRates);
    }
    if (head === 'address' && a) return this.serveAddress(a, rest.slice(3), b);
    if (head === 'tx' && a) {
      const tx = this.transaction(a);
      if (!/^[0-9a-f]{64}$/.test(a)) return text('Invalid hex string', 400);
      if (!tx) {
        const missing = text('Transaction not found', 404);
        return this.dropped.has(a) ? { ...missing, modelled404: true } : missing;
      }
      if (b === undefined) return json(this.esploraTx(tx));
      if (b === 'hex' && c === undefined) return text(this.hexOverrides.get(tx.txid) ?? tx.hex);
      if (b === 'status' && c === undefined) return json(this.status(tx));
      if (b === 'outspend' && c !== undefined && d === undefined) {
        const vout = Number(c);
        if (!tx.outputs[vout]) return text('Output not found', 404);
        const spend = this.spentBy.get(outpointKey({ txid: tx.txid, vout }));
        const spender = spend ? this.txs.get(spend.txid) : undefined;
        if (!spend || !spender) return json({ spent: false });
        return json({
          spent: true,
          txid: spend.txid,
          vin: spend.vin,
          status: this.status(spender),
        });
      }
    }
    return notFound('Not found');
  }

  readonly addressLookups: string[] = [];

  beforeAddressStats: ((address: string) => void) | null = null;

  private serveAddress(address: string, tail: string[], kind: string | undefined): Reply {
    let script: string;
    try {
      script = scriptOfAddress(address);
    } catch {
      return text(`Invalid Bitcoin address`, 400);
    }
    if (kind === undefined && tail.length === 0) {
      this.addressLookups.push(address);
      const hook = this.beforeAddressStats;
      if (hook) {
        this.beforeAddressStats = null;
        hook(address);
      }
      const involved = [...this.txs.values()].filter(tx => this.touches(tx, script));
      return json({
        address,
        chain_stats: addressStats(
          script,
          involved.filter(t => t.height !== null)
        ),
        mempool_stats: addressStats(
          script,
          involved.filter(t => t.height === null)
        ),
      });
    }
    if (kind === 'utxo' && tail.length === 0) {
      const utxos = [...this.txs.values()]
        .sort((x, y) => this.newestFirst(x, y))
        .flatMap(tx =>
          tx.outputs.flatMap((o, vout) =>
            o.script === script && !this.isSpent({ txid: tx.txid, vout })
              ? [{ txid: tx.txid, vout, status: this.status(tx), value: o.value }]
              : []
          )
        );
      return json(utxos);
    }
    if (kind !== 'txs') return notFound('Not found');
    const involved = [...this.txs.values()]
      .filter(tx => this.touches(tx, script))
      .sort((x, y) => this.newestFirst(x, y));
    if (tail[0] === 'mempool' && tail.length === 1) {
      return json(
        involved
          .filter(t => t.height === null)
          .slice(0, MEMPOOL_LIMIT)
          .map(t => this.esploraTx(t))
      );
    }
    if (tail[0] === 'chain' && tail.length <= 2) {
      const confirmed = involved.filter(t => t.height !== null);
      const after = tail[1];
      const start = after === undefined ? 0 : confirmed.findIndex(t => t.txid === after) + 1;
      if (after !== undefined && start === 0) return json([]);
      return json(confirmed.slice(start, start + CHAIN_PAGE_SIZE).map(t => this.esploraTx(t)));
    }
    return notFound('Not found');
  }

  readonly broadcasts: string[] = [];

  private broadcast(body: string): Reply {
    const raw = body.trim().toLowerCase();
    this.broadcasts.push(raw);
    if (!/^(?:[0-9a-f]{2})+$/.test(raw))
      return text('sendrawtransaction RPC error: {"code":-22,"message":"TX decode failed"}', 400);
    try {
      const tx = this.add(raw);
      return text(tx.txid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = message === 'bad-txns-inputs-missingorspent' ? -25 : -26;
      return text(`sendrawtransaction RPC error: ${JSON.stringify({ code, message })}`, 400);
    }
  }
}

export class Wallet {
  private readonly key: BitcoinKey;
  private readonly chain: BitcoinChain;
  private coins: { txid: string; vout: number; value: number }[] = [];
  readonly address: string;
  readonly script: string;

  constructor(chain: BitcoinChain, key: BitcoinKey, rng: Rng, fundSats: number) {
    this.chain = chain;
    this.key = key;
    const out = p2wpkhOf(key);
    this.address = out.address;
    this.script = out.script;
    const genesis = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
    genesis.addOutput({ script: hex.decode(this.script), amount: BigInt(fundSats) });
    genesis.addInput({
      txid: rng.bytes(32),
      index: 0,
      finalScriptSig: hex.decode('51'),
      sequence: 0xfffffffd,
    });
    const funded = chain.add(genesis.hex, {
      confirmedAt: chain.tip.height - 150,
      unchecked: true,
    });
    this.coins.push({ txid: funded.txid, vout: 0, value: fundSats });
  }

  private readonly funding = new Map<string, { txid: string; vout: number; value: number }>();

  private signed(
    coin: { txid: string; vout: number; value: number },
    outputs: readonly PaymentOutput[],
    fee: number,
    changeFirst: boolean
  ): { hex: string; changeVout: number; change: number } {
    const change = coin.value - outputs.reduce((sum, o) => sum + o.value, 0) - fee;
    if (change < 1000) throw new Error('The world treasury coin is too small for this payment');
    const tx = new btc.Transaction();
    tx.addInput({
      txid: coin.txid,
      index: coin.vout,
      witnessUtxo: { script: hex.decode(this.script), amount: BigInt(coin.value) },
      sequence: 0xfffffffd,
    });
    const own = { script: this.script, value: change };
    const all = changeFirst ? [own, ...outputs] : [...outputs, own];
    for (const o of all) tx.addOutput({ script: hex.decode(o.script), amount: BigInt(o.value) });
    tx.sign(this.key.privateKey);
    tx.finalize();
    return { hex: tx.hex, changeVout: changeFirst ? 0 : outputs.length, change };
  }

  pay(
    outputs: PaymentOutput[],
    options: { feeSats?: number; confirmedAt?: number; changeFirst?: boolean } = {}
  ): ChainTx {
    const fee = options.feeSats ?? 450;
    const needed = outputs.reduce((sum, o) => sum + o.value, 0) + fee;
    const coin = this.coins.find(c => c.value >= needed + 1000);
    if (!coin) throw new Error('The world treasury has no coin large enough');
    const built = this.signed(coin, outputs, fee, options.changeFirst === true);
    const added = this.chain.add(built.hex, { confirmedAt: options.confirmedAt });
    this.coins = this.coins.filter(c => c !== coin);
    this.coins.push({ txid: added.txid, vout: built.changeVout, value: built.change });
    this.funding.set(added.txid, coin);
    return added;
  }

  replace(
    txid: string,
    outputs: PaymentOutput[],
    options: { feeSats: number; changeFirst?: boolean }
  ): ChainTx {
    const coin = this.funding.get(txid);
    if (!coin) throw new Error(`The world treasury did not pay ${txid}`);
    const built = this.signed(coin, outputs, options.feeSats, options.changeFirst === true);
    const added = this.chain.replace(txid, built.hex);
    this.funding.delete(txid);
    this.funding.set(added.txid, coin);
    this.coins = this.coins.filter(c => c.txid !== txid);
    this.coins.push({ txid: added.txid, vout: built.changeVout, value: built.change });
    return added;
  }

  evict(txid: string): void {
    const coin = this.funding.get(txid);
    if (!coin) throw new Error(`The world treasury did not pay ${txid}`);
    this.chain.drop(txid);
    this.funding.delete(txid);
    this.coins = [...this.coins.filter(c => c.txid !== txid), coin];
  }
}

export interface PaymentOutput {
  script: string;
  value: number;
}

export function depositOutputScript(depositScript: string, reclaimScript: string): string {
  const out = btc.p2tr(
    hex.decode(SBTC_UNSPENDABLE_KEY),
    [{ script: hex.decode(depositScript) }, { script: hex.decode(reclaimScript) }],
    btc.NETWORK,
    true
  );
  return hex.encode(out.script);
}

export interface SignerCoin {
  txid: string;
  vout: number;
  value: number;
}

export function fundSignerCoin(input: {
  chain: BitcoinChain;
  signerKey: BitcoinKey;
  rng: Rng;
  sats: number;
  confirmedAt: number;
}): SignerCoin {
  const genesis = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
  genesis.addOutput({
    script: hex.decode(p2trOf(input.signerKey).script),
    amount: BigInt(input.sats),
  });
  genesis.addInput({
    txid: input.rng.bytes(32),
    index: 0,
    finalScriptSig: hex.decode('51'),
    sequence: 0xfffffffd,
  });
  const funded = input.chain.add(genesis.hex, { confirmedAt: input.confirmedAt, unchecked: true });
  return { txid: funded.txid, vout: 0, value: input.sats };
}

export function sweepDeposit(input: {
  chain: BitcoinChain;
  outpoint: Outpoint;
  depositScript: string;
  reclaimScript: string;
  signerKey: BitcoinKey;
  signerCoin: SignerCoin | null;
  feeSats: number;
  confirmedAt?: number;
}): { tx: ChainTx; signerCoin: SignerCoin } {
  const prev = input.chain.output(input.outpoint);
  if (!prev) throw new Error(`Unknown outpoint ${outpointKey(input.outpoint)}`);
  const signerScript = p2trOf(input.signerKey).script;
  const tree = btc.p2tr(
    hex.decode(SBTC_UNSPENDABLE_KEY),
    [{ script: hex.decode(input.depositScript) }, { script: hex.decode(input.reclaimScript) }],
    btc.NETWORK,
    true
  );
  const leaf = tree.tapLeafScript?.find(
    ([, script]) => hex.encode(script.subarray(0, -1)) === input.depositScript
  );
  if (!leaf) throw new Error('The deposit script is not a leaf of the deposit address');
  const tx = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
  const coin = input.signerCoin;
  if (coin) {
    tx.addInput({
      txid: coin.txid,
      index: coin.vout,
      witnessUtxo: { script: hex.decode(signerScript), amount: BigInt(coin.value) },
      tapInternalKey: hex.decode(input.signerKey.xOnly),
      sequence: 0xfffffffd,
    });
  }
  tx.addInput({
    txid: input.outpoint.txid,
    index: input.outpoint.vout,
    witnessUtxo: { script: hex.decode(prev.script), amount: BigInt(prev.value) },
    tapLeafScript: [leaf],
    sequence: 0xfffffffd,
  });
  const carried = (coin?.value ?? 0) + prev.value - input.feeSats;
  tx.addOutput({ script: hex.decode(signerScript), amount: BigInt(carried) });
  for (let i = 0; i < tx.inputsLength; i++) tx.signIdx(input.signerKey.privateKey, i);
  tx.finalize();
  const added = input.chain.add(tx.hex, { confirmedAt: input.confirmedAt });
  return { tx: added, signerCoin: { txid: added.txid, vout: 0, value: carried } };
}
