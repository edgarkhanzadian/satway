import { ed25519 } from '@noble/curves/ed25519';
import { base58, base64 } from '@scure/base';
import { createHash } from 'node:crypto';

import { type Reply, field, json } from './http.js';
import { verifyEd25519 } from './keys.js';
import type { Rng } from './random.js';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const NATIVE_SOL_ASSET = 'nep141:sol.omft.near';
const SIGNATURE_FEE = 5_000n;
const TOKEN_ACCOUNT_RENT = 2_039_280n;
const U64_MAX = 2n ** 64n - 1n;

export interface SolanaAccount {
  lamports: bigint;
  owner: string;
  data: Uint8Array;
  executable: boolean;
}

export interface DecodedInstruction {
  programId: string;
  accounts: string[];
  data: Uint8Array;
}

export interface DecodedTransaction {
  signatures: Uint8Array[];
  message: Uint8Array;
  requiredSignatures: number;
  accountKeys: string[];
  recentBlockhash: string;
  instructions: DecodedInstruction[];
}

export type Effect =
  | { kind: 'sol'; from: string; to: string; lamports: bigint }
  | { kind: 'create-ata'; payer: string; ata: string; owner: string; mint: string }
  | {
      kind: 'token';
      source: string;
      destination: string;
      authority: string;
      mint: string;
      amount: bigint;
      decimals: number;
    };

class Reader {
  private offset = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get position(): number {
    return this.offset;
  }

  u8(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw new Error('Transaction is truncated');
    this.offset += 1;
    return value;
  }

  shortVec(): number {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = this.u8();
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      if (shift > 14) throw new Error('Bad compact-u16');
    }
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new Error('Transaction is truncated');
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  done(): boolean {
    return this.offset === this.bytes.length;
  }
}

export function decodeTransaction(wire: Uint8Array): DecodedTransaction {
  const r = new Reader(wire);
  const sigCount = r.shortVec();
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < sigCount; i++) signatures.push(r.take(64));
  const messageStart = r.position;
  const first = r.u8();
  if (first & 0x80) throw new Error('Only legacy transactions are simulated by the world');
  const requiredSignatures = first;
  r.u8();
  r.u8();
  const keyCount = r.shortVec();
  const accountKeys: string[] = [];
  for (let i = 0; i < keyCount; i++) accountKeys.push(base58.encode(r.take(32)));
  const recentBlockhash = base58.encode(r.take(32));
  const instructionCount = r.shortVec();
  const instructions: DecodedInstruction[] = [];
  for (let i = 0; i < instructionCount; i++) {
    const programIndex = r.u8();
    const accountCount = r.shortVec();
    const accounts: string[] = [];
    for (let j = 0; j < accountCount; j++) {
      const key = accountKeys[r.u8()];
      if (!key) throw new Error('Instruction refers to a missing account');
      accounts.push(key);
    }
    const data = r.take(r.shortVec());
    const programId = accountKeys[programIndex];
    if (!programId) throw new Error('Instruction refers to a missing program');
    instructions.push({ programId, accounts, data: Uint8Array.from(data) });
  }
  if (!r.done()) throw new Error('Transaction has trailing bytes');
  return {
    signatures: signatures.map(s => Uint8Array.from(s)),
    message: Uint8Array.from(wire.subarray(messageStart)),
    requiredSignatures,
    accountKeys,
    recentBlockhash,
    instructions,
  };
}

function byteAt(data: Uint8Array, index: number): number {
  const byte = data[index];
  if (byte === undefined) throw new Error('Instruction data is truncated');
  return byte;
}

function u64At(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(byteAt(data, offset + i));
  return value;
}

function u32At(data: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 3; i >= 0; i--) value = value * 256 + byteAt(data, offset + i);
  return value;
}

function u64Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rest = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

export function effectsOf(tx: DecodedTransaction): Effect[] {
  return tx.instructions.map(ix => {
    if (ix.programId === SYSTEM_PROGRAM && ix.data.length === 12 && u32At(ix.data, 0) === 2) {
      const [from, to] = ix.accounts;
      if (!from || !to) throw new Error('System transfer is missing accounts');
      return { kind: 'sol', from, to, lamports: u64At(ix.data, 4) };
    }
    if (ix.programId === ATA_PROGRAM && (ix.data.length === 0 || ix.data[0] === 1)) {
      const [payer, ata, owner, mint] = ix.accounts;
      if (!payer || !ata || !owner || !mint) throw new Error('Create ATA is missing accounts');
      return { kind: 'create-ata', payer, ata, owner, mint };
    }
    if (ix.programId === TOKEN_PROGRAM && ix.data[0] === 12 && ix.data.length === 10) {
      const [source, mint, destination, authority] = ix.accounts;
      if (!source || !mint || !destination || !authority)
        throw new Error('TransferChecked is missing accounts');
      return {
        kind: 'token',
        source,
        destination,
        authority,
        mint,
        amount: u64At(ix.data, 1),
        decimals: byteAt(ix.data, 9),
      };
    }
    throw new Error(`The world does not simulate this instruction of ${ix.programId}`);
  });
}

export function encodeMint(input: {
  decimals: number;
  supply: bigint;
  authority: string;
}): Uint8Array {
  const out = new Uint8Array(82);
  out.set([1, 0, 0, 0], 0);
  out.set(base58.decode(input.authority), 4);
  out.set(u64Bytes(input.supply), 36);
  out[44] = input.decimals;
  out[45] = 1;
  return out;
}

export function encodeTokenAccount(input: {
  mint: string;
  owner: string;
  amount: bigint;
}): Uint8Array {
  const out = new Uint8Array(165);
  out.set(base58.decode(input.mint), 0);
  out.set(base58.decode(input.owner), 32);
  out.set(u64Bytes(input.amount), 64);
  out[108] = 1;
  return out;
}

export function decodeTokenAccount(data: Uint8Array): {
  mint: string;
  owner: string;
  amount: bigint;
} {
  if (data.length !== 165) throw new Error('Not a token account');
  return {
    mint: base58.encode(data.subarray(0, 32)),
    owner: base58.encode(data.subarray(32, 64)),
    amount: u64At(data, 64),
  };
}

function onCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}

export function associatedTokenAddress(owner: string, mint: string): string {
  for (let bump = 255; bump >= 0; bump--) {
    const hash = createHash('sha256')
      .update(base58.decode(owner))
      .update(base58.decode(TOKEN_PROGRAM))
      .update(base58.decode(mint))
      .update(Uint8Array.of(bump))
      .update(base58.decode(ATA_PROGRAM))
      .update('ProgramDerivedAddress')
      .digest();
    const candidate = Uint8Array.from(hash);
    if (!onCurve(candidate)) return base58.encode(candidate);
  }
  throw new Error('No associated token address');
}

export interface Credit {
  owner: string;
  assetMint: string | null;
  amount: bigint;
  signature: string;
}

export interface SolanaSubmission {
  signature: string;
  transaction: DecodedTransaction;
  effects: Effect[];
  via: 'rpc' | 'wallet';
}

export type Commitment = 'processed' | 'confirmed' | 'finalized';

interface SignatureStatus {
  slot: number;
  err: unknown;
  commitment: Commitment;
}

interface IssuedBlockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}

export type SendReplyFault = 'accept-then-error' | 'drop-then-error';

export const BLOCKHASH_VALID_BLOCKS = 150;

export class SolanaChain {
  readonly accounts = new Map<string, SolanaAccount>();
  readonly submissions: SolanaSubmission[] = [];
  readonly simulations: DecodedTransaction[] = [];
  readonly rpcSends: string[] = [];
  readonly sendReplyFaults: SendReplyFault[] = [];
  landAs: Commitment = 'finalized';
  private readonly statuses = new Map<string, SignatureStatus>();
  private readonly blockhashes: IssuedBlockhash[] = [];
  private slot = 331_000_000;
  blockHeight = 309_000_000;
  private readonly rng: Rng;
  private readonly onCredit: (credit: Credit) => void;

  constructor(rng: Rng, onCredit: (credit: Credit) => void) {
    this.rng = rng;
    this.onCredit = onCredit;
    this.issueBlockhash();
  }

  private issueBlockhash(): void {
    this.blockhashes.push({
      blockhash: this.rng.base58(32),
      lastValidBlockHeight: this.blockHeight + BLOCKHASH_VALID_BLOCKS,
    });
  }

  blockhashValid(blockhash: string): boolean {
    const issued = this.blockhashes.find(b => b.blockhash === blockhash);
    return issued !== undefined && this.blockHeight <= issued.lastValidBlockHeight;
  }

  commitmentOf(signature: string): Commitment | null {
    return this.statuses.get(signature)?.commitment ?? null;
  }

  promote(signature: string, commitment: Commitment): void {
    const status = this.statuses.get(signature);
    if (!status) throw new Error(`Solana has no transaction ${signature}`);
    status.commitment = commitment;
  }

  fund(address: string, lamports: bigint): void {
    const existing = this.accounts.get(address);
    this.accounts.set(address, {
      lamports: (existing?.lamports ?? 0n) + lamports,
      owner: existing?.owner ?? SYSTEM_PROGRAM,
      data: existing?.data ?? new Uint8Array(0),
      executable: false,
    });
  }

  createMint(mint: string, decimals: number, authority: string): void {
    this.accounts.set(mint, {
      lamports: 1_461_600n,
      owner: TOKEN_PROGRAM,
      data: encodeMint({ decimals, supply: 10n ** 15n, authority }),
      executable: false,
    });
  }

  fundToken(owner: string, mint: string, amount: bigint): string {
    const ata = associatedTokenAddress(owner, mint);
    const current = this.accounts.get(ata);
    const held = current ? decodeTokenAccount(current.data).amount : 0n;
    this.accounts.set(ata, {
      lamports: TOKEN_ACCOUNT_RENT,
      owner: TOKEN_PROGRAM,
      data: encodeTokenAccount({ mint, owner, amount: held + amount }),
      executable: false,
    });
    return ata;
  }

  tokenBalance(owner: string, mint: string): bigint | null {
    const account = this.accounts.get(associatedTokenAddress(owner, mint));
    return account ? decodeTokenAccount(account.data).amount : null;
  }

  lamports(address: string): bigint {
    return this.accounts.get(address)?.lamports ?? 0n;
  }

  private get latestBlockhash(): IssuedBlockhash {
    const last = this.blockhashes.at(-1);
    if (!last) throw new Error('No blockhash');
    return last;
  }

  advance(blocks: number): void {
    if (blocks <= 0) return;
    this.blockHeight += blocks;
    this.slot += blocks;
    for (const status of this.statuses.values()) {
      if (status.commitment !== 'finalized' && this.slot - status.slot >= 32)
        status.commitment = 'finalized';
    }
    this.issueBlockhash();
  }

  private apply(
    tx: DecodedTransaction,
    accounts: Map<string, SolanaAccount>
  ): { effects: Effect[]; credits: Omit<Credit, 'signature'>[] } {
    const effects = effectsOf(tx);
    const feePayer = tx.accountKeys[0];
    if (!feePayer) throw new Error('Transaction has no fee payer');
    const credits: Omit<Credit, 'signature'>[] = [];
    function account(address: string): SolanaAccount | null {
      return accounts.get(address) ?? null;
    }
    function debit(address: string, lamports: bigint, what: string): void {
      const held = account(address);
      if (!held || held.lamports < lamports)
        throw new SimulationError(`Transfer: insufficient lamports for ${what}`);
      accounts.set(address, { ...held, lamports: held.lamports - lamports });
    }
    function credit(address: string, lamports: bigint): void {
      const held = account(address);
      accounts.set(address, {
        lamports: (held?.lamports ?? 0n) + lamports,
        owner: held?.owner ?? SYSTEM_PROGRAM,
        data: held?.data ?? new Uint8Array(0),
        executable: false,
      });
    }
    debit(feePayer, SIGNATURE_FEE * BigInt(tx.requiredSignatures), 'the fee');
    for (const effect of effects) {
      if (effect.kind === 'sol') {
        if (!tx.accountKeys.slice(0, tx.requiredSignatures).includes(effect.from))
          throw new SimulationError('Transfer: from account must sign');
        if (effect.lamports > U64_MAX) throw new SimulationError('Transfer: amount too large');
        debit(effect.from, effect.lamports, 'the transfer');
        credit(effect.to, effect.lamports);
        credits.push({ owner: effect.to, assetMint: null, amount: effect.lamports });
      } else if (effect.kind === 'create-ata') {
        if (associatedTokenAddress(effect.owner, effect.mint) !== effect.ata)
          throw new SimulationError('Associated address does not match seed derivation');
        if (account(effect.ata)) continue;
        debit(effect.payer, TOKEN_ACCOUNT_RENT, 'the token account rent');
        accounts.set(effect.ata, {
          lamports: TOKEN_ACCOUNT_RENT,
          owner: TOKEN_PROGRAM,
          data: encodeTokenAccount({ mint: effect.mint, owner: effect.owner, amount: 0n }),
          executable: false,
        });
      } else {
        const source = account(effect.source);
        const destination = account(effect.destination);
        const mint = account(effect.mint);
        if (!source || !destination || !mint) throw new SimulationError('Token: account not found');
        const from = decodeTokenAccount(source.data);
        const to = decodeTokenAccount(destination.data);
        if (from.owner !== effect.authority)
          throw new SimulationError('Token: owner does not match');
        if (from.mint !== effect.mint || to.mint !== effect.mint)
          throw new SimulationError('Token: mint mismatch');
        if (mint.data[44] !== effect.decimals)
          throw new SimulationError('Token: decimals mismatch');
        if (from.amount < effect.amount) throw new SimulationError('Token: insufficient funds');
        accounts.set(effect.source, {
          ...source,
          data: encodeTokenAccount({ ...from, amount: from.amount - effect.amount }),
        });
        accounts.set(effect.destination, {
          ...destination,
          data: encodeTokenAccount({ ...to, amount: to.amount + effect.amount }),
        });
        credits.push({ owner: to.owner, assetMint: effect.mint, amount: effect.amount });
      }
    }
    return { effects, credits };
  }

  submit(wire: Uint8Array, via: 'rpc' | 'wallet'): string {
    const tx = decodeTransaction(wire);
    const signature = tx.signatures[0];
    if (!signature) throw new RpcError(-32602, 'Transaction has no signatures');
    for (let i = 0; i < tx.requiredSignatures; i++) {
      const key = tx.accountKeys[i];
      const sig = tx.signatures[i];
      if (!key || !sig || !verifyEd25519(base58.decode(key), tx.message, sig))
        throw new RpcError(-32003, 'Transaction signature verification failure');
    }
    if (!this.blockhashValid(tx.recentBlockhash))
      throw new RpcError(-32002, 'Transaction simulation failed: Blockhash not found');
    const id = base58.encode(signature);
    if (this.statuses.has(id)) return id;
    const scratch = new Map(this.accounts);
    let applied: ReturnType<SolanaChain['apply']>;
    try {
      applied = this.apply(tx, scratch);
    } catch (err) {
      if (err instanceof SimulationError)
        throw new RpcError(-32002, `Transaction simulation failed: ${err.message}`);
      throw err;
    }
    for (const [key, value] of scratch) this.accounts.set(key, value);
    this.slot += 1;
    this.statuses.set(id, { slot: this.slot, err: null, commitment: this.landAs });
    this.submissions.push({ signature: id, transaction: tx, effects: applied.effects, via });
    for (const c of applied.credits) this.onCredit({ ...c, signature: id });
    return id;
  }

  serve(body: unknown): Reply {
    const id = field(body, 'id') ?? null;
    const method = field(body, 'method');
    const params = field(body, 'params');
    const list: unknown[] = Array.isArray(params) ? params : [];
    try {
      return json({ jsonrpc: '2.0', id, result: this.call(String(method), list) });
    } catch (err) {
      if (err instanceof RpcError)
        return json({ jsonrpc: '2.0', id, error: { code: err.code, message: err.message } });
      return json({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private context(): { slot: number; apiVersion: string } {
    return { slot: this.slot, apiVersion: '2.2.7' };
  }

  private accountJson(account: SolanaAccount | undefined): Record<string, unknown> | null {
    if (!account) return null;
    return {
      data: [base64.encode(account.data), 'base64'],
      executable: account.executable,
      lamports: Number(account.lamports),
      owner: account.owner,
      rentEpoch: 18_446_744_073_709_552_000,
      space: account.data.length,
    };
  }

  private call(method: string, params: unknown[]): unknown {
    switch (method) {
      case 'getLatestBlockhash':
        return { context: this.context(), value: { ...this.latestBlockhash } };
      case 'getBlockHeight':
        return this.blockHeight;
      case 'getBalance':
        return { context: this.context(), value: Number(this.lamports(String(params[0]))) };
      case 'getAccountInfo':
        return {
          context: this.context(),
          value: this.accountJson(this.accounts.get(String(params[0]))),
        };
      case 'getMultipleAccounts': {
        const addresses = Array.isArray(params[0]) ? params[0] : [];
        return {
          context: this.context(),
          value: addresses.map(a => this.accountJson(this.accounts.get(String(a)))),
        };
      }
      case 'getMinimumBalanceForRentExemption': {
        const space = typeof params[0] === 'number' ? params[0] : 0;
        return (128 + space) * 6_960;
      }
      case 'simulateTransaction':
        return this.simulate(String(params[0]));
      case 'sendTransaction': {
        const wire = String(params[0]);
        this.rpcSends.push(wire);
        const fault = this.sendReplyFaults.shift();
        if (fault === 'drop-then-error')
          throw new RpcError(-32603, 'Internal error: the node dropped the transaction');
        const signature = this.submit(base64.decode(wire), 'rpc');
        if (fault === 'accept-then-error')
          throw new RpcError(-32603, 'Internal error: the reply was lost');
        return signature;
      }
      case 'getSignatureStatuses': {
        const signatures = Array.isArray(params[0]) ? params[0] : [];
        return {
          context: this.context(),
          value: signatures.map(s => {
            const status = this.statuses.get(String(s));
            if (!status) return null;
            return {
              slot: status.slot,
              err: status.err,
              status: status.err === null ? { Ok: null } : { Err: status.err },
              confirmationStatus: status.commitment,
              confirmations: status.commitment === 'finalized' ? null : this.slot - status.slot,
            };
          }),
        };
      }
      default:
        throw new RpcError(-32601, 'Method not found');
    }
  }

  private simulate(wireBase64: string): unknown {
    const tx = decodeTransaction(base64.decode(wireBase64));
    this.simulations.push(tx);
    const programs = [...new Set(tx.instructions.map(i => i.programId))];
    try {
      this.apply(tx, new Map(this.accounts));
    } catch (err) {
      if (!(err instanceof SimulationError)) throw err;
      return {
        context: this.context(),
        value: {
          err: { InstructionError: [0, { Custom: 1 }] },
          logs: [
            `Program ${programs[0] ?? SYSTEM_PROGRAM} invoke [1]`,
            `Program log: Error: ${err.message}`,
          ],
          unitsConsumed: 150,
          accounts: null,
          returnData: null,
        },
      };
    }
    return {
      context: this.context(),
      value: {
        err: null,
        logs: programs.flatMap(p => [`Program ${p} invoke [1]`, `Program ${p} success`]),
        unitsConsumed: 150 * tx.instructions.length,
        accounts: null,
        returnData: null,
      },
    };
  }
}

class SimulationError extends Error {}

export class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
