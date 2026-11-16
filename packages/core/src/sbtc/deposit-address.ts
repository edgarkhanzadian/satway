import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { Address, ClarityType, validateStacksAddress } from '@stacks/transactions';
import { MAINNET, UNSPENDABLE_PUB, buildSbtcDepositAddress } from 'sbtc';

import { DEPOSIT_INDEX_LIMIT, type NetworkConfig } from '../shared/index.js';
import { parseClarityHex } from './clarity-values.js';

export interface DepositAddressInput {
  stacksAddress: string;
  reclaimPublicKey: string;
  signersPublicKey: string;
  maxSignerFeeSats: number;
  reclaimLockBlocks: number;
}

export interface DepositAddress {
  address: string;
  scriptPubKey: string;
  depositScript: string;
  reclaimScript: string;
}

const MAINNET_STANDARD_VERSIONS = new Set([22, 20]);

export function toXOnly(publicKeyHex: string): string {
  const clean = publicKeyHex.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]*$/.test(clean)) throw new Error('Public key is not hex');
  if (clean.length === 64) return clean;
  if (clean.length === 66 && (clean.startsWith('02') || clean.startsWith('03'))) {
    return clean.slice(2);
  }
  throw new Error('Public key must be 32 bytes (x-only) or 33 bytes (compressed)');
}

export function assertMainnetStandardAddress(stacksAddress: string): void {
  if (!validateStacksAddress(stacksAddress)) {
    throw new Error('Not a valid Stacks address');
  }
  const parsed = Address.parse(stacksAddress);
  if (parsed.contractName !== undefined) {
    throw new Error('Contract principals are not supported as recipients');
  }
  if (!MAINNET_STANDARD_VERSIONS.has(parsed.version)) {
    throw new Error('Recipient must be a mainnet Stacks address (SP… or SM…)');
  }
}

export function buildDepositAddress(input: DepositAddressInput): DepositAddress {
  assertMainnetStandardAddress(input.stacksAddress);
  const reclaimPublicKey = toXOnly(input.reclaimPublicKey);
  const signersPublicKey = toXOnly(input.signersPublicKey);
  if (reclaimPublicKey === signersPublicKey) {
    throw new Error('Reclaim key must be the user’s key, not the signers key');
  }
  if (!Number.isSafeInteger(input.maxSignerFeeSats) || input.maxSignerFeeSats <= 0) {
    throw new Error('maxSignerFeeSats must be a positive integer');
  }
  if (
    !Number.isSafeInteger(input.reclaimLockBlocks) ||
    input.reclaimLockBlocks < 1 ||
    input.reclaimLockBlocks > 0xffff
  ) {
    throw new Error('reclaimLockBlocks must be between 1 and 65535');
  }

  const built = buildSbtcDepositAddress({
    network: MAINNET,
    stacksAddress: input.stacksAddress,
    signersPublicKey,
    reclaimPublicKey,
    maxSignerFee: input.maxSignerFeeSats,
    reclaimLockTime: input.reclaimLockBlocks,
  });

  return {
    address: built.address,
    scriptPubKey: hex.encode(built.trOut.script),
    depositScript: built.depositScript,
    reclaimScript: built.reclaimScript,
  };
}

export type DepositIndexConfig = Pick<NetworkConfig, 'baseSignerFeeSats' | 'reclaimLockBlocks'>;

export interface IndexedDepositAddressInput {
  stacksAddress: string;
  reclaimPublicKey: string;
  signersPublicKey: string;
  depositIndex: number;
}

export interface IndexedDepositAddress extends DepositAddress {
  depositIndex: number;
  maxSignerFeeSats: number;
}

export function isDepositIndex(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0 && n < DEPOSIT_INDEX_LIMIT;
}

export function signerFeeCapFor(depositIndex: number, baseSignerFeeSats: number): number {
  if (!isDepositIndex(depositIndex)) {
    throw new Error(
      `The deposit index must be a whole number from 0 to ${DEPOSIT_INDEX_LIMIT - 1}`
    );
  }
  return baseSignerFeeSats + depositIndex;
}

export function depositIndexOfFeeCap(
  maxSignerFeeSats: number,
  baseSignerFeeSats: number
): number | null {
  const n = maxSignerFeeSats - baseSignerFeeSats;
  return isDepositIndex(n) ? n : null;
}

export function buildIndexedDepositAddress(
  input: IndexedDepositAddressInput,
  config: DepositIndexConfig
): IndexedDepositAddress {
  const maxSignerFeeSats = signerFeeCapFor(input.depositIndex, config.baseSignerFeeSats);
  const built = buildDepositAddress({
    stacksAddress: input.stacksAddress,
    reclaimPublicKey: input.reclaimPublicKey,
    signersPublicKey: input.signersPublicKey,
    maxSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
  });
  return { ...built, depositIndex: input.depositIndex, maxSignerFeeSats };
}

export interface DepositScriptParameters {
  stacksAddress: string;
  reclaimPublicKey: string;
  signersPublicKey: string;
  maxSignerFeeSats: number;
  reclaimLockBlocks: number;
}

const STANDARD_DEPOSIT_SCRIPT = /^1e([0-9a-f]{16})(05[0-9a-f]{42})7520([0-9a-f]{64})ac$/;
const RECLAIM_SCRIPT_TAIL = /b27520([0-9a-f]{64})ac$/;

function lockOfReclaimScript(reclaimScript: string): number | null {
  const [lock] = btc.Script.decode(hex.decode(reclaimScript));
  if (typeof lock === 'number') return lock;
  if (lock instanceof Uint8Array) return Number(btc.ScriptNum().decode(lock));
  return null;
}

export function depositParametersOf(
  depositScript: string,
  reclaimScript: string
): DepositScriptParameters | null {
  const deposit = STANDARD_DEPOSIT_SCRIPT.exec(depositScript.toLowerCase());
  const reclaim = RECLAIM_SCRIPT_TAIL.exec(reclaimScript.toLowerCase());
  const [, feeHex, principalHex, signersPublicKey] = deposit ?? [];
  const reclaimPublicKey = reclaim?.[1];
  if (!feeHex || !principalHex || !signersPublicKey || !reclaimPublicKey) return null;
  try {
    const principal = parseClarityHex(principalHex, 'The deposit recipient');
    const lock = lockOfReclaimScript(reclaimScript.toLowerCase());
    if (principal.type !== ClarityType.PrincipalStandard || lock === null) return null;
    const parameters: DepositScriptParameters = {
      stacksAddress: principal.value,
      reclaimPublicKey,
      signersPublicKey,
      maxSignerFeeSats: Number(BigInt(`0x${feeHex}`)),
      reclaimLockBlocks: lock,
    };
    const rebuilt = buildDepositAddress(parameters);
    return rebuilt.depositScript === depositScript.toLowerCase() &&
      rebuilt.reclaimScript === reclaimScript.toLowerCase()
      ? parameters
      : null;
  } catch {
    return null;
  }
}

export function scriptPubKeyOf(address: string): string {
  return hex.encode(btc.OutScript.encode(btc.Address(MAINNET).decode(address)));
}

export function isMainnetTaproot(address: string): boolean {
  try {
    return btc.Address(MAINNET).decode(address).type === 'tr';
  } catch {
    return false;
  }
}

export function depositAddressFromScripts(
  depositScript: string,
  reclaimScript: string
): { address: string; scriptPubKey: string } {
  const out = btc.p2tr(
    UNSPENDABLE_PUB,
    [{ script: hex.decode(depositScript) }, { script: hex.decode(reclaimScript) }],
    MAINNET,
    true
  );
  if (!out.address) throw new Error('Could not derive an address from the scripts');
  return { address: out.address, scriptPubKey: hex.encode(out.script) };
}

function leafControlBlock(depositScript: string, reclaimScript: string, leafScript: string) {
  const wanted = leafScript.toLowerCase();
  const out = btc.p2tr(
    UNSPENDABLE_PUB,
    [
      { script: hex.decode(depositScript.toLowerCase()) },
      { script: hex.decode(reclaimScript.toLowerCase()) },
    ],
    MAINNET,
    true
  );
  const leaf = (out.tapLeafScript ?? []).find(
    ([, script]) => hex.encode(script.slice(0, -1)) === wanted
  );
  if (!leaf) throw new Error('The script is not a leaf of its own taproot tree');
  return hex.encode(btc.TaprootControlBlock.encode(leaf[0]));
}

export function depositLeafControlBlock(depositScript: string, reclaimScript: string): string {
  return leafControlBlock(depositScript, reclaimScript, depositScript);
}

export function reclaimLeafControlBlock(depositScript: string, reclaimScript: string): string {
  return leafControlBlock(depositScript, reclaimScript, reclaimScript);
}
