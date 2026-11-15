import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import { type BitcoinChain, depositOutputScript, outpointKey } from './bitcoin.js';
import { type Reply, field, json, notFound, numberField, parseJson, stringField } from './http.js';
import { parseDepositScript, parseReclaimScript } from './sbtc-scripts.js';

export type EmilyStatus = 'pending' | 'reprocessing' | 'accepted' | 'confirmed' | 'failed' | 'rbf';

export interface EmilyDeposit {
  bitcoinTxid: string;
  bitcoinTxOutputIndex: number;
  recipient: string;
  amount: number;
  lastUpdateHeight: number;
  lastUpdateBlockHash: string;
  status: EmilyStatus;
  statusMessage: string;
  parameters: { maxFee: number; lockTime: number };
  reclaimScript: string;
  depositScript: string;
  fulfillment?: Record<string, unknown>;
}

export interface EmilyPost {
  body: unknown;
  reply: Reply;
}

export const EMILY_LIMITS = {
  pegCap: 2_100_000_000_000_000,
  perDepositMinimum: 10_000,
  perDepositCap: 2_100_000_000_000_000,
  perWithdrawalCap: 5_100_000_000,
  rollingWithdrawalBlocks: 150,
  rollingWithdrawalCap: 15_100_000_000,
  availableToWithdraw: 14_929_166_462,
  accountCaps: {},
  throttleModeInitiator: null,
};

const HEX = /^(?:[0-9a-f]{2})+$/;
const TXID = /^[0-9a-f]{64}$/;

export class Emily {
  readonly deposits = new Map<string, EmilyDeposit>();
  readonly posts: EmilyPost[] = [];
  private readonly chain: BitcoinChain;
  private readonly signerKey: () => string;

  constructor(chain: BitcoinChain, signerKey: () => string) {
    this.chain = chain;
    this.signerKey = signerKey;
  }

  get(txid: string, vout: number): EmilyDeposit | null {
    return this.deposits.get(outpointKey({ txid, vout })) ?? null;
  }

  setStatus(txid: string, vout: number, status: EmilyStatus, statusMessage: string): EmilyDeposit {
    const deposit = this.get(txid, vout);
    if (!deposit) throw new Error(`Emily has no deposit ${txid}:${vout}`);
    deposit.status = status;
    deposit.statusMessage = statusMessage;
    deposit.lastUpdateHeight = this.chain.tip.height;
    deposit.lastUpdateBlockHash = this.chain.tip.hash;
    return deposit;
  }

  remove(txid: string, vout: number): void {
    this.deposits.delete(outpointKey({ txid, vout }));
  }

  seed(deposit: EmilyDeposit): void {
    this.deposits.set(
      outpointKey({ txid: deposit.bitcoinTxid, vout: deposit.bitcoinTxOutputIndex }),
      deposit
    );
  }

  serve(method: string, path: string, query: URLSearchParams, body: string): Reply {
    const parts = path.split('/').filter(Boolean);
    if (method === 'GET' && parts.length === 1 && parts[0] === 'limits') return json(EMILY_LIMITS);
    if (parts[0] !== 'deposit') return notFound('Not found');
    if (method === 'POST' && parts.length === 1) {
      const parsed = parseJson(body);
      const reply = this.create(parsed);
      this.posts.push({ body: parsed, reply });
      return reply;
    }
    if (method !== 'GET') return notFound('Not found');
    if (parts.length === 1) {
      const status = query.get('status');
      const pageSize = Number(query.get('pageSize') ?? '20');
      const list = [...this.deposits.values()]
        .filter(d => status === null || d.status === status)
        .sort((a, b) => b.lastUpdateHeight - a.lastUpdateHeight)
        .slice(0, Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 20);
      return json({ deposits: list.map(d => this.summary(d)), nextToken: null });
    }
    const [, txid, voutText] = parts;
    if (parts.length === 3 && txid && voutText !== undefined) {
      const deposit = this.get(txid, Number(voutText));
      return deposit ? json(deposit) : notFound('Deposit not found');
    }
    return notFound('Not found');
  }

  private summary(d: EmilyDeposit): Record<string, unknown> {
    return {
      bitcoinTxid: d.bitcoinTxid,
      bitcoinTxOutputIndex: d.bitcoinTxOutputIndex,
      recipient: d.recipient,
      amount: d.amount,
      lastUpdateHeight: d.lastUpdateHeight,
      lastUpdateBlockHash: d.lastUpdateBlockHash,
      status: d.status,
      reclaimScript: d.reclaimScript,
      depositScript: d.depositScript,
    };
  }

  private create(body: unknown): Reply {
    const txid = stringField(body, 'bitcoinTxid');
    const vout = numberField(body, 'bitcoinTxOutputIndex');
    const depositScript = stringField(body, 'depositScript');
    const reclaimScript = stringField(body, 'reclaimScript');
    const transactionHex = stringField(body, 'transactionHex');
    if (field(body, 'transactionHex') === undefined)
      return json({ message: 'missing field `transactionHex`' }, 400);
    if (!txid || !TXID.test(txid)) return json({ message: 'invalid bitcoinTxid' }, 400);
    if (vout === undefined || !Number.isSafeInteger(vout) || vout < 0)
      return json({ message: 'invalid bitcoinTxOutputIndex' }, 400);
    if (!depositScript || !HEX.test(depositScript))
      return json({ message: 'invalid depositScript' }, 400);
    if (!reclaimScript || !HEX.test(reclaimScript))
      return json({ message: 'invalid reclaimScript' }, 400);
    if (!transactionHex || !HEX.test(transactionHex))
      return json({ message: 'invalid transactionHex' }, 400);
    const parsedDeposit = parseDepositScript(depositScript);
    if (!parsedDeposit) return json({ message: 'invalid deposit script' }, 400);
    if (parsedDeposit.signerKey !== this.signerKey())
      return json({ message: 'deposit script is not locked to the current signer key' }, 400);
    const parsedReclaim = parseReclaimScript(reclaimScript);
    if (!parsedReclaim) return json({ message: 'invalid reclaim script' }, 400);
    let tx: btc.Transaction;
    try {
      tx = btc.Transaction.fromRaw(hex.decode(transactionHex), {
        allowUnknownInputs: true,
        allowUnknownOutputs: true,
        disableScriptCheck: true,
      });
    } catch {
      return json({ message: 'transactionHex does not parse' }, 400);
    }
    if (tx.id !== txid) return json({ message: 'transactionHex does not match bitcoinTxid' }, 400);
    if (vout >= tx.outputsLength) return json({ message: 'output index out of range' }, 400);
    const output = tx.getOutput(vout);
    if (
      !output.script ||
      output.amount === undefined ||
      hex.encode(output.script) !== depositOutputScript(depositScript, reclaimScript)
    )
      return json({ message: 'output does not pay the deposit address of these scripts' }, 400);
    if (this.get(txid, vout)) return json({ message: 'Deposit already exists' }, 409);
    const deposit: EmilyDeposit = {
      bitcoinTxid: txid,
      bitcoinTxOutputIndex: vout,
      recipient: parsedDeposit.recipient,
      amount: Number(output.amount),
      lastUpdateHeight: this.chain.tip.height,
      lastUpdateBlockHash: this.chain.tip.hash,
      status: 'pending',
      statusMessage: 'Just received deposit',
      parameters: { maxFee: parsedDeposit.maxFee, lockTime: parsedReclaim.lockTime },
      reclaimScript,
      depositScript,
    };
    this.seed(deposit);
    return json(deposit, 201);
  }
}
