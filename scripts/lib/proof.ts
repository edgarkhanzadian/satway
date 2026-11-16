import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAINNET } from 'sbtc';

import {
  type DepositAddress,
  type OneClickQuoteResponse,
  type WatchedDepositContext,
  oneClickQuoteResponseSchema,
  parseWith,
  z,
} from '@satway/core';

import { repoRoot, required } from './env.js';

export interface ProofRecord {
  createdAt: string;
  stacksAddress: string;
  reclaimPublicKey: string;
  signersPublicKey: string;
  depositIndex: number;
  maxSignerFeeSats: number;
  reclaimLockBlocks: number;
  deposit: DepositAddress;
  origin: { chain: string; symbol: string; assetId: string };
  refundTo: string;
  quoteResponse: OneClickQuoteResponse;
  notify: boolean;
  events: { at: string; stage: string; note?: string }[];
  result?: {
    payoutTxid: string;
    payoutVout: number;
    payoutSats: number;
    mintStatus: string;
    finishedAt: string;
  };
}

const proofRecordSchema: z.ZodType<ProofRecord> = z.looseObject({
  createdAt: z.string(),
  stacksAddress: z.string(),
  reclaimPublicKey: z.string(),
  signersPublicKey: z.string(),
  depositIndex: z.number(),
  maxSignerFeeSats: z.number(),
  reclaimLockBlocks: z.number(),
  deposit: z.looseObject({
    address: z.string(),
    scriptPubKey: z.string(),
    depositScript: z.string(),
    reclaimScript: z.string(),
  }),
  origin: z.looseObject({ chain: z.string(), symbol: z.string(), assetId: z.string() }),
  refundTo: z.string(),
  quoteResponse: oneClickQuoteResponseSchema,
  notify: z.boolean(),
  events: z.array(
    z.looseObject({ at: z.string(), stage: z.string(), note: z.string().optional() })
  ),
  result: z
    .looseObject({
      payoutTxid: z.string(),
      payoutVout: z.number(),
      payoutSats: z.number(),
      mintStatus: z.string(),
      finishedAt: z.string(),
    })
    .optional(),
});

const dir = resolve(repoRoot, '.proofs');

export function saveProof(name: string, record: ProofRecord): string {
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, name);
  writeFileSync(path, JSON.stringify(record, null, 2));
  return path;
}

export function loadProof(arg?: string): { path: string; record: ProofRecord } {
  let path: string;
  if (arg) {
    path = existsSync(arg) ? resolve(arg) : resolve(dir, arg);
  } else {
    const files = existsSync(dir)
      ? readdirSync(dir)
          .filter(f => f.endsWith('.json'))
          .sort()
      : [];
    const latest = files.at(-1);
    if (!latest) {
      console.error('No proof records found. Run "pnpm deposit-proof quote ..." first.');
      process.exit(1);
    }
    path = resolve(dir, latest);
  }
  const record = parseWith(proofRecordSchema, JSON.parse(readFileSync(path, 'utf8')), path);
  return { path, record };
}

export function reclaimKeyFromEnv(): { privateKey: Uint8Array; publicKey: string } {
  const wif = required('TEST_BTC_WIF');
  const privateKey = btc.WIF(MAINNET).decode(wif);
  return { privateKey, publicKey: hex.encode(btc.utils.pubSchnorr(privateKey)) };
}

export function log(record: ProofRecord, stage: string, note?: string): void {
  const last = record.events.at(-1);
  if (last?.stage === stage && last.note === note) return;
  record.events.push({ at: new Date().toISOString(), stage, note });
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${stage}${note ? `  ${note}` : ''}`);
}

export function contextOfProof(record: ProofRecord): WatchedDepositContext {
  return {
    depositAddress: record.deposit.address,
    depositScriptPubKey: record.deposit.scriptPubKey,
    depositScript: record.deposit.depositScript,
    reclaimScript: record.deposit.reclaimScript,
    reclaimLockBlocks: record.reclaimLockBlocks,
  };
}
