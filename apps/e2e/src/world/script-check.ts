import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { createHash } from 'node:crypto';

import { parseDepositScript, parseReclaimScript } from './sbtc-scripts.js';

export const TAP_LEAF_VERSION = 0xc0;
const SEQUENCE_DISABLE_FLAG = 0x8000_0000;
const SEQUENCE_TYPE_FLAG = 0x0040_0000;
const SEQUENCE_MASK = 0x0000_ffff;

export interface PrevOutput {
  script: string;
  value: number;
}

export interface SpendContext {
  prevout(o: { txid: string; vout: number }): PrevOutput | null;
  heightOf(txid: string): number | null;
  nextHeight: number;
}

function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = createHash('sha256');
  for (const part of parts) h.update(part);
  return Uint8Array.from(h.digest());
}

function taggedHash(tag: string, ...parts: Uint8Array[]): Uint8Array {
  const t = sha256(new TextEncoder().encode(tag));
  return sha256(t, t, ...parts);
}

function hash160(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash('ripemd160').update(sha256(bytes)).digest());
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return a.length - b.length;
}

function compactSize(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  return Uint8Array.of(0xfd, n & 0xff, n >> 8);
}

export function tapLeafHash(script: Uint8Array): Uint8Array {
  return taggedHash('TapLeaf', Uint8Array.of(TAP_LEAF_VERSION), compactSize(script.length), script);
}

const MISSING = 'bad-txns-inputs-missingorspent';
const SCRIPT_FAILED = 'mandatory-script-verify-flag-failed';

function relativeLockOf(sequence: number): number | null {
  if ((sequence & SEQUENCE_DISABLE_FLAG) !== 0) return null;
  if ((sequence & SEQUENCE_TYPE_FLAG) !== 0) return null;
  return sequence & SEQUENCE_MASK;
}

function controlBlockCommits(
  control: Uint8Array,
  leafScript: Uint8Array,
  outputScript: string
): boolean {
  if (control.length < 33 || (control.length - 33) % 32 !== 0) return false;
  const first = control[0] ?? 0;
  if ((first & 0xfe) !== TAP_LEAF_VERSION) return false;
  const internal = control.subarray(1, 33);
  let node = tapLeafHash(leafScript);
  for (let offset = 33; offset < control.length; offset += 32) {
    const sibling = control.subarray(offset, offset + 32);
    node =
      compareBytes(node, sibling) <= 0
        ? taggedHash('TapBranch', node, sibling)
        : taggedHash('TapBranch', sibling, node);
  }
  const [tweaked, parity] = btc.utils.taprootTweakPubkey(internal, node);
  return outputScript === `5120${hex.encode(tweaked)}` && parity === (first & 1);
}

function schnorrSigOk(
  tx: btc.Transaction,
  index: number,
  scripts: Uint8Array[],
  amounts: bigint[],
  sig: Uint8Array,
  key: Uint8Array,
  leaf: Uint8Array | undefined
): boolean {
  if (sig.length !== 64 && sig.length !== 65) return false;
  const hashType = sig.length === 65 ? (sig[64] ?? 0) : 0;
  if (sig.length === 65 && hashType === 0) return false;
  const msg = tx.preimageWitnessV1(
    index,
    scripts,
    hashType,
    amounts,
    undefined,
    leaf,
    leaf === undefined ? undefined : TAP_LEAF_VERSION
  );
  try {
    return schnorr.verify(sig.subarray(0, 64), msg, key);
  } catch {
    return false;
  }
}

function leafKey(script: string): { key: string; lock: number | null } | null {
  const reclaim = parseReclaimScript(script);
  if (reclaim) return { key: reclaim.key, lock: reclaim.lockTime };
  const deposit = parseDepositScript(script);
  if (deposit) return { key: deposit.signerKey, lock: null };
  return null;
}

function checkInput(
  tx: btc.Transaction,
  index: number,
  scripts: Uint8Array[],
  amounts: bigint[],
  prev: PrevOutput
): string | null {
  const input = tx.getInput(index);
  const witness = input.finalScriptWitness ?? [];
  const sequence = input.sequence ?? 0xffffffff;
  if (/^0014[0-9a-f]{40}$/.test(prev.script)) {
    const [sig, pub] = witness;
    if (witness.length !== 2 || !sig || !pub)
      return `${SCRIPT_FAILED} (Witness program hash mismatch)`;
    if (hex.encode(hash160(pub)) !== prev.script.slice(4))
      return `${SCRIPT_FAILED} (Witness program hash mismatch)`;
    const hashType = sig[sig.length - 1] ?? 0;
    const scriptCode = hex.decode(`76a914${prev.script.slice(4)}88ac`);
    const digest = tx.preimageWitnessV0(index, scriptCode, hashType, BigInt(prev.value));
    let ok = false;
    try {
      ok = secp256k1.verify(sig.subarray(0, -1), digest, pub, { prehash: false, format: 'der' });
    } catch {
      ok = false;
    }
    return ok
      ? null
      : `${SCRIPT_FAILED} (Signature must be zero for failed CHECK(MULTI)SIG operation)`;
  }
  if (/^5120[0-9a-f]{64}$/.test(prev.script)) {
    const outputKey = hex.decode(prev.script.slice(4));
    const stack =
      witness.length >= 2 && witness.at(-1)?.[0] === 0x50 ? witness.slice(0, -1) : witness;
    if (stack.length === 1) {
      const [sig] = stack;
      return sig && schnorrSigOk(tx, index, scripts, amounts, sig, outputKey, undefined)
        ? null
        : `${SCRIPT_FAILED} (Invalid Schnorr signature)`;
    }
    const control = stack.at(-1);
    const leaf = stack.at(-2);
    const args = stack.slice(0, -2);
    if (!control || !leaf) return `${SCRIPT_FAILED} (Witness program was passed an empty witness)`;
    if (!controlBlockCommits(control, leaf, prev.script))
      return `${SCRIPT_FAILED} (Witness program hash mismatch)`;
    const template = leafKey(hex.encode(leaf));
    if (!template) return `${SCRIPT_FAILED} (the e2e world does not run this tapscript)`;
    if (template.lock !== null) {
      const relative = relativeLockOf(sequence);
      if (tx.version < 2 || relative === null || relative < template.lock)
        return `${SCRIPT_FAILED} (Locktime requirement not satisfied)`;
    }
    const [sig] = args;
    if (args.length !== 1 || !sig)
      return `${SCRIPT_FAILED} (Operation not valid with the current stack size)`;
    return schnorrSigOk(tx, index, scripts, amounts, sig, hex.decode(template.key), leaf)
      ? null
      : `${SCRIPT_FAILED} (Invalid Schnorr signature)`;
  }
  return `${SCRIPT_FAILED} (the e2e world does not run this output type)`;
}

export function checkSpend(rawHex: string, context: SpendContext): string | null {
  const tx = btc.Transaction.fromRaw(hex.decode(rawHex), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  const prevs: PrevOutput[] = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    if (!input.txid || input.index === undefined) return MISSING;
    const prev = context.prevout({ txid: hex.encode(input.txid), vout: input.index });
    if (!prev) return MISSING;
    prevs.push(prev);
  }
  let outValue = 0n;
  for (let i = 0; i < tx.outputsLength; i++) outValue += tx.getOutput(i).amount ?? 0n;
  const inValue = prevs.reduce((sum, p) => sum + BigInt(p.value), 0n);
  if (outValue > inValue) return 'bad-txns-in-belowout';
  if (inValue - outValue < BigInt(tx.vsize)) return 'min relay fee not met';
  if (tx.version >= 2) {
    for (let i = 0; i < tx.inputsLength; i++) {
      const input = tx.getInput(i);
      const relative = relativeLockOf(input.sequence ?? 0xffffffff);
      if (relative === null || !input.txid) continue;
      const height = context.heightOf(hex.encode(input.txid));
      if (height === null || context.nextHeight - height < relative) return 'non-BIP68-final';
    }
  }
  const scripts = prevs.map(p => hex.decode(p.script));
  const amounts = prevs.map(p => BigInt(p.value));
  for (let i = 0; i < prevs.length; i++) {
    const prev = prevs[i];
    if (!prev) return MISSING;
    const problem = checkInput(tx, i, scripts, amounts, prev);
    if (problem) return problem;
  }
  return null;
}

export function witnessScriptOf(rawHex: string, index: number): string | null {
  const tx = btc.Transaction.fromRaw(hex.decode(rawHex), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  });
  const witness = tx.getInput(index).finalScriptWitness ?? [];
  const leaf = witness.at(-2);
  return witness.length >= 3 && leaf ? hex.encode(leaf) : null;
}
