import {
  Cl,
  ClarityType,
  type ClarityValue,
  cvToString,
  deserializeCV,
  postConditionToHex,
  serializeCV,
} from '@stacks/transactions';

import { decodeWithdrawalArguments } from '@satway/core';

import { SBTC_DEPLOYER } from './hiro.js';
import { type Reply, field, json, parseJson } from './http.js';
import type { Rng } from './random.js';

export const WITHDRAWAL_CONTRACT = `${SBTC_DEPLOYER}.sbtc-withdrawal`;
export const REGISTRY_CONTRACT = `${SBTC_DEPLOYER}.sbtc-registry`;
export const SBTC_ASSET = `${SBTC_DEPLOYER}.sbtc-token::sbtc-token`;
export const WITHDRAWAL_FUNCTION = 'initiate-withdrawal-request';
export const SIGNER_STACKS_ADDRESS = 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8';
export const FIRST_REQUEST_ID = 5_300;

const READ_PREFIX = `/v2/contracts/call-read/${SBTC_DEPLOYER}/sbtc-registry/`;
const BALANCE = /^\/extended\/v2\/addresses\/([^/]+)\/balances\/ft\/(.+)$/;
const TX = /^\/extended\/v1\/tx\/0x([0-9a-f]{64})$/;

export interface ContractCall {
  sender: string;
  contract: string;
  functionName: string;
  functionArgs: string[];
  postConditions: string[];
  postConditionMode: string;
}

export interface StacksTx {
  txid: string;
  sender: string;
  contract: string;
  functionName: string;
  functionArgs: string[];
  postConditions: string[];
  postConditionMode: string;
  status: string;
  blockHeight: number | null;
  burnBlockHeight: number | null;
  result: ClarityValue | null;
  prints: ClarityValue[];
}

export interface WithdrawalRequestRecord {
  requestId: number;
  txid: string;
  amountSats: number;
  maxFeeSats: number;
  sender: string;
  recipient: { version: string; hashbytes: string };
  burnHeight: number;
  status: boolean | null;
  sweep: { sweepTxid: string; sweepBurnHash: string; sweepBurnHeight: number } | null;
  accept: {
    acceptTxid: string;
    bitcoinTxid: string;
    outputIndex: number;
    feeSats: number;
  } | null;
}

export type ConfirmOutcome = 'success' | 'insufficient-balance' | 'post-condition' | 'dropped';

function hexCv(value: ClarityValue): string {
  return `0x${serializeCV(value)}`;
}

function recipientCv(r: { version: string; hashbytes: string }): ClarityValue {
  return Cl.tuple({
    version: Cl.bufferFromHex(r.version),
    hashbytes: Cl.bufferFromHex(r.hashbytes),
  });
}

export class StacksChain {
  readonly txs = new Map<string, StacksTx>();
  readonly requests = new Map<number, WithdrawalRequestRecord>();
  readonly balances = new Map<string, number>();
  readonly locked = new Map<string, number>();
  readonly calls: ContractCall[] = [];
  activeWithdrawalContract: string | null = WITHDRAWAL_CONTRACT;
  private nextRequestId = FIRST_REQUEST_ID;
  private height = 9_500_000;
  private readonly rng: Rng;
  private readonly burnHeight: () => number;

  constructor(rng: Rng, burnHeight: () => number) {
    this.rng = rng;
    this.burnHeight = burnHeight;
  }

  balanceOf(address: string): number {
    return this.balances.get(address) ?? 0;
  }

  fund(address: string, sats: number): void {
    this.balances.set(address, this.balanceOf(address) + sats);
  }

  submit(call: ContractCall): StacksTx {
    this.calls.push(call);
    const tx: StacksTx = {
      txid: this.rng.hex(32),
      ...call,
      status: 'pending',
      blockHeight: null,
      burnBlockHeight: null,
      result: null,
      prints: [],
    };
    this.txs.set(tx.txid, tx);
    return tx;
  }

  latestCall(): StacksTx {
    const last = [...this.txs.values()].filter(t => t.functionName === WITHDRAWAL_FUNCTION).at(-1);
    if (!last) throw new Error('No withdrawal request was submitted to the Stacks chain');
    return last;
  }

  tx(txid: string): StacksTx {
    const tx = this.txs.get(txid.replace(/^0x/, ''));
    if (!tx) throw new Error(`The Stacks chain has no transaction ${txid}`);
    return tx;
  }

  private mineTx(tx: StacksTx): void {
    this.height += 1;
    tx.blockHeight = this.height;
    tx.burnBlockHeight = this.burnHeight();
  }

  confirm(txid: string, outcome: ConfirmOutcome = 'success'): WithdrawalRequestRecord | null {
    const tx = this.tx(txid);
    if (tx.status !== 'pending') throw new Error(`Transaction ${txid} is already ${tx.status}`);
    if (outcome === 'dropped') {
      tx.status = 'dropped_replace_by_fee';
      return null;
    }
    this.mineTx(tx);
    const args = decodeWithdrawalArguments(tx.functionArgs);
    const lockedSats = args.amountSats + args.maxFeeSats;
    const expectedCondition = postConditionToHex({
      type: 'ft-postcondition',
      address: tx.sender,
      condition: 'eq',
      asset: SBTC_ASSET,
      amount: String(lockedSats),
    });
    const conditionHolds =
      tx.postConditionMode === 'deny' &&
      tx.postConditions.length === 1 &&
      tx.postConditions[0]?.replace(/^0x/, '') === expectedCondition;
    const funded = this.balanceOf(tx.sender) >= lockedSats;
    if (outcome === 'insufficient-balance' || !funded) {
      tx.status = 'abort_by_response';
      tx.result = Cl.error(Cl.uint(1));
      return null;
    }
    if (outcome === 'post-condition' || !conditionHolds) {
      tx.status = 'abort_by_post_condition';
      tx.result = Cl.ok(Cl.uint(this.nextRequestId));
      return null;
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    this.balances.set(tx.sender, this.balanceOf(tx.sender) - lockedSats);
    this.locked.set(tx.sender, (this.locked.get(tx.sender) ?? 0) + lockedSats);
    const record: WithdrawalRequestRecord = {
      requestId,
      txid: tx.txid,
      amountSats: args.amountSats,
      maxFeeSats: args.maxFeeSats,
      sender: tx.sender,
      recipient: args.recipient,
      burnHeight: tx.burnBlockHeight ?? this.burnHeight(),
      status: null,
      sweep: null,
      accept: null,
    };
    this.requests.set(requestId, record);
    tx.status = 'success';
    tx.result = Cl.ok(Cl.uint(requestId));
    tx.prints.push(
      Cl.tuple({
        topic: Cl.stringAscii('withdrawal-create'),
        'request-id': Cl.uint(requestId),
        amount: Cl.uint(args.amountSats),
        'max-fee': Cl.uint(args.maxFeeSats),
        sender: Cl.principal(tx.sender),
        recipient: recipientCv(args.recipient),
        'block-height': Cl.uint(record.burnHeight),
      })
    );
    return record;
  }

  request(requestId: number): WithdrawalRequestRecord {
    const r = this.requests.get(requestId);
    if (!r) throw new Error(`The sBTC registry has no withdrawal request ${requestId}`);
    return r;
  }

  accept(
    requestId: number,
    payout: {
      bitcoinTxid: string;
      outputIndex: number;
      feeSats: number;
      burnHash: string;
      burnHeight: number;
    }
  ): StacksTx {
    const r = this.request(requestId);
    if (r.status !== null) throw new Error(`Request ${requestId} is already decided`);
    const acceptTx: StacksTx = {
      txid: this.rng.hex(32),
      sender: SIGNER_STACKS_ADDRESS,
      contract: WITHDRAWAL_CONTRACT,
      functionName: 'accept-withdrawal-request',
      functionArgs: [hexCv(Cl.uint(requestId))],
      postConditions: [],
      postConditionMode: 'allow',
      status: 'success',
      blockHeight: null,
      burnBlockHeight: null,
      result: Cl.ok(Cl.bool(true)),
      prints: [
        Cl.tuple({
          topic: Cl.stringAscii('withdrawal-accept'),
          'request-id': Cl.uint(requestId),
          'bitcoin-txid': Cl.bufferFromHex(payout.bitcoinTxid),
          'output-index': Cl.uint(payout.outputIndex),
          fee: Cl.uint(payout.feeSats),
          'sweep-txid': Cl.bufferFromHex(payout.bitcoinTxid),
          'burn-hash': Cl.bufferFromHex(payout.burnHash),
          'burn-height': Cl.uint(payout.burnHeight),
          'signer-bitmap': Cl.uint(0),
        }),
      ],
    };
    this.mineTx(acceptTx);
    this.txs.set(acceptTx.txid, acceptTx);
    r.status = true;
    r.sweep = {
      sweepTxid: payout.bitcoinTxid,
      sweepBurnHash: payout.burnHash,
      sweepBurnHeight: payout.burnHeight,
    };
    r.accept = {
      acceptTxid: acceptTx.txid,
      bitcoinTxid: payout.bitcoinTxid,
      outputIndex: payout.outputIndex,
      feeSats: payout.feeSats,
    };
    const lockedSats = r.amountSats + r.maxFeeSats;
    this.locked.set(r.sender, (this.locked.get(r.sender) ?? 0) - lockedSats);
    this.fund(r.sender, r.maxFeeSats - payout.feeSats);
    return acceptTx;
  }

  reject(requestId: number): void {
    const r = this.request(requestId);
    if (r.status !== null) throw new Error(`Request ${requestId} is already decided`);
    r.status = false;
    const lockedSats = r.amountSats + r.maxFeeSats;
    this.locked.set(r.sender, (this.locked.get(r.sender) ?? 0) - lockedSats);
    this.fund(r.sender, lockedSats);
  }

  private txJson(tx: StacksTx): Record<string, unknown> {
    return {
      tx_id: `0x${tx.txid}`,
      tx_status: tx.status,
      tx_type: 'contract_call',
      sender_address: tx.sender,
      ...(tx.blockHeight === null ? {} : { block_height: tx.blockHeight }),
      ...(tx.burnBlockHeight === null ? {} : { burn_block_height: tx.burnBlockHeight }),
      ...(tx.result === null
        ? {}
        : {
            tx_result: { hex: hexCv(tx.result), repr: cvToString(tx.result) },
          }),
      contract_call: {
        contract_id: tx.contract,
        function_name: tx.functionName,
        function_args: tx.functionArgs.map(a => ({ hex: a.startsWith('0x') ? a : `0x${a}` })),
      },
      post_condition_mode: tx.postConditionMode,
      events: tx.prints.map((value, i) => ({
        event_index: i,
        event_type: 'smart_contract_log',
        tx_id: `0x${tx.txid}`,
        contract_log: {
          contract_id: REGISTRY_CONTRACT,
          topic: 'print',
          value: { hex: hexCv(value) },
        },
      })),
    };
  }

  private readOnly(fn: string, body: string): Reply {
    const args = field(parseJson(body), 'arguments');
    const first: unknown = Array.isArray(args) ? args[0] : undefined;
    if (typeof first !== 'string') return json({ okay: false, cause: 'missing argument' }, 400);
    const arg = deserializeCV(first.replace(/^0x/, ''));
    if (fn === 'get-active-protocol') {
      const role = arg.type === ClarityType.Buffer ? arg.value : '';
      if (role !== '02' || this.activeWithdrawalContract === null) {
        return json({ okay: true, result: hexCv(Cl.none()) });
      }
      return json({
        okay: true,
        result: hexCv(Cl.some(Cl.principal(this.activeWithdrawalContract))),
      });
    }
    if (arg.type !== ClarityType.UInt) return json({ okay: false, cause: 'expected a uint' }, 400);
    const r = this.requests.get(Number(arg.value));
    if (fn === 'get-withdrawal-request') {
      if (!r) return json({ okay: true, result: hexCv(Cl.none()) });
      return json({
        okay: true,
        result: hexCv(
          Cl.some(
            Cl.tuple({
              amount: Cl.uint(r.amountSats),
              'max-fee': Cl.uint(r.maxFeeSats),
              sender: Cl.principal(r.sender),
              recipient: recipientCv(r.recipient),
              'block-height': Cl.uint(r.burnHeight),
              status: r.status === null ? Cl.none() : Cl.some(Cl.bool(r.status)),
            })
          )
        ),
      });
    }
    if (fn === 'get-completed-withdrawal-sweep-data') {
      if (!r?.sweep) return json({ okay: true, result: hexCv(Cl.none()) });
      return json({
        okay: true,
        result: hexCv(
          Cl.some(
            Cl.tuple({
              'sweep-txid': Cl.bufferFromHex(r.sweep.sweepTxid),
              'sweep-burn-hash': Cl.bufferFromHex(r.sweep.sweepBurnHash),
              'sweep-burn-height': Cl.uint(r.sweep.sweepBurnHeight),
            })
          )
        ),
      });
    }
    return json({ okay: false, cause: `unknown function ${fn}` }, 400);
  }

  serve(method: string, path: string, body: string): Reply | null {
    if (method === 'POST' && path.startsWith(READ_PREFIX)) {
      const fn = path.slice(READ_PREFIX.length);
      if (fn === 'get-current-aggregate-pubkey') return null;
      return this.readOnly(fn, body);
    }
    if (method !== 'GET') return null;
    const tx = TX.exec(path);
    if (tx?.[1] !== undefined) {
      const found = this.txs.get(tx[1]);
      return found ? json(this.txJson(found)) : null;
    }
    const balance = BALANCE.exec(path);
    if (balance?.[1] !== undefined && balance[2] !== undefined) {
      if (decodeURIComponent(balance[2]) !== SBTC_ASSET) return json({ balance: '0' });
      return json({ balance: String(this.balanceOf(balance[1])) });
    }
    return null;
  }
}
