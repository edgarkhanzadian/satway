import { DEPOSIT_INDEX_LIMIT, type NetworkConfig } from '@satway/core';

import { BadRequest } from './errors.js';

export type ScriptConfig = Pick<NetworkConfig, 'baseSignerFeeSats' | 'reclaimLockBlocks'>;

const DEPOSIT_SCRIPT = /^1e([0-9a-f]{16})05(?:16|14)[0-9a-f]{40}7520([0-9a-f]{64})ac$/;
const RECLAIM_TAIL = /^b27520([0-9a-f]{64})ac$/;

function byteHex(n: number): string {
  return n.toString(16).padStart(2, '0');
}

export function lockPushHex(blocks: number): string {
  if (!Number.isSafeInteger(blocks) || blocks < 1) throw new Error('Bad lock');
  if (blocks <= 16) return byteHex(0x50 + blocks);
  const bytes: number[] = [];
  let rest = blocks;
  while (rest > 0) {
    bytes.push(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  if ((bytes.at(-1) ?? 0) & 0x80) bytes.push(0);
  return byteHex(bytes.length) + bytes.map(byteHex).join('');
}

export interface DepositScripts {
  signerKey: string;
  reclaimKey: string;
}

export function checkScriptShape(
  depositScript: string,
  reclaimScript: string,
  config: ScriptConfig
): DepositScripts {
  const deposit = DEPOSIT_SCRIPT.exec(depositScript);
  const feeHex = deposit?.[1];
  const signerKey = deposit?.[2];
  if (feeHex === undefined || signerKey === undefined) {
    throw new BadRequest('"depositScript" is not an sBTC deposit script this app creates');
  }
  const fee = BigInt(`0x${feeHex}`);
  const base = BigInt(config.baseSignerFeeSats);
  if (fee < base || fee >= base + BigInt(DEPOSIT_INDEX_LIMIT)) {
    throw new BadRequest('"depositScript" does not use a fee cap this app sets');
  }
  const lock = lockPushHex(config.reclaimLockBlocks);
  const reclaimKey = reclaimScript.startsWith(lock)
    ? RECLAIM_TAIL.exec(reclaimScript.slice(lock.length))?.[1]
    : undefined;
  if (reclaimKey === undefined) {
    throw new BadRequest('"reclaimScript" is not a reclaim script with the lock this app sets');
  }
  if (reclaimKey === signerKey) {
    throw new BadRequest('"reclaimScript" must use the depositor’s key, not the signers key');
  }
  return { signerKey, reclaimKey };
}
