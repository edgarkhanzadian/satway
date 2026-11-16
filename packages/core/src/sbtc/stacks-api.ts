import { type ClarityValue, serializeCV } from '@stacks/transactions';

import { type FetchLike, HttpError, defaultFetch, requestJson, z } from '../shared/index.js';
import { parseClarityHex } from './clarity-values.js';

export interface StacksTxResult {
  hex: string;
  repr?: string;
}

export interface StacksContractCall {
  contract_id: string;
  function_name: string;
  function_args?: { hex: string; name?: string }[];
}

export interface StacksContractLog {
  contract_id: string;
  topic: string;
  value: { hex: string };
}

export interface StacksTxEvent {
  event_type: string;
  contract_log?: StacksContractLog;
}

export interface StacksTransaction {
  tx_id: string;
  tx_status: string;
  tx_type: string;
  sender_address: string;
  nonce?: number;
  block_height?: number;
  burn_block_height?: number;
  tx_result?: StacksTxResult;
  contract_call?: StacksContractCall;
  post_condition_mode?: string;
  events?: StacksTxEvent[];
}

export const stacksTransactionSchema: z.ZodType<StacksTransaction> = z.looseObject({
  tx_id: z.string(),
  tx_status: z.string(),
  tx_type: z.string(),
  sender_address: z.string(),
  nonce: z.number().int().nonnegative().optional(),
  block_height: z.number().int().optional(),
  burn_block_height: z.number().int().optional(),
  tx_result: z.looseObject({ hex: z.string(), repr: z.string().optional() }).optional(),
  contract_call: z
    .looseObject({
      contract_id: z.string(),
      function_name: z.string(),
      function_args: z
        .array(z.looseObject({ hex: z.string(), name: z.string().optional() }))
        .optional(),
    })
    .optional(),
  post_condition_mode: z.string().optional(),
  events: z
    .array(
      z.looseObject({
        event_type: z.string(),
        contract_log: z
          .looseObject({
            contract_id: z.string(),
            topic: z.string(),
            value: z.looseObject({ hex: z.string() }),
          })
          .optional(),
      })
    )
    .optional(),
});

const STACKS_TXID = /^(?:0x)?([0-9a-f]{64})$/;

export function normalizeStacksTxid(txid: string): string {
  const match = STACKS_TXID.exec(txid.trim().toLowerCase());
  const body = match?.[1];
  if (body === undefined) throw new Error(`Not a Stacks transaction id: ${txid}`);
  return body;
}

export async function fetchStacksTransaction(
  stxApiUrl: string,
  txid: string,
  fetchFn: FetchLike = defaultFetch
): Promise<StacksTransaction | null> {
  const id = normalizeStacksTxid(txid);
  try {
    return await requestJson(
      fetchFn,
      `${stxApiUrl}/extended/v1/tx/0x${id}?event_limit=50`,
      stacksTransactionSchema
    );
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

const transactionListSchema = z.looseObject({ results: z.array(stacksTransactionSchema) });

export interface TransactionsAtNonce {
  confirmed: StacksTransaction[];
  pending: StacksTransaction[];
}

export async function fetchTransactionsAtNonce(
  stxApiUrl: string,
  sender: string,
  nonce: number,
  fetchFn: FetchLike = defaultFetch
): Promise<TransactionsAtNonce> {
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('A nonce is a whole number');
  const who = encodeURIComponent(sender);
  const [confirmed, pending] = await Promise.all([
    requestJson(
      fetchFn,
      `${stxApiUrl}/extended/v1/tx?from_address=${who}&nonce=${nonce}&limit=10`,
      transactionListSchema
    ),
    requestJson(
      fetchFn,
      `${stxApiUrl}/extended/v1/tx/mempool?sender_address=${who}&limit=50`,
      transactionListSchema
    ),
  ]);
  function atNonce(tx: StacksTransaction): boolean {
    return tx.sender_address === sender && tx.nonce === nonce;
  }
  return {
    confirmed: confirmed.results.filter(atNonce),
    pending: pending.results.filter(atNonce),
  };
}

const READ_ONLY_SENDER = 'SP000000000000000000002Q6VF78';

const readOnlyResultSchema = z.looseObject({
  okay: z.boolean(),
  result: z.string().optional(),
  cause: z.string().optional(),
});

export async function callReadOnly(
  stxApiUrl: string,
  contractId: string,
  functionName: string,
  args: readonly ClarityValue[],
  fetchFn: FetchLike = defaultFetch
): Promise<ClarityValue> {
  const [address, name] = contractId.split('.');
  if (!address || !name) throw new Error(`Not a contract id: ${contractId}`);
  const url = `${stxApiUrl}/v2/contracts/call-read/${address}/${name}/${functionName}`;
  const res = await requestJson(fetchFn, url, readOnlyResultSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: READ_ONLY_SENDER,
      arguments: args.map(a => `0x${serializeCV(a)}`),
    }),
  });
  if (!res.okay || res.result === undefined) {
    throw new Error(`Read-only call ${functionName} failed: ${res.cause ?? 'no result'}`);
  }
  return parseClarityHex(res.result, `${functionName} result`);
}
