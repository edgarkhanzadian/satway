import { Cl, type ClarityValue } from '@stacks/transactions';

import {
  type FetchLike,
  type NetworkConfig,
  type WithdrawalConfig,
  errorMessage,
} from '../shared/index.js';
import {
  asciiOf,
  boolOf,
  bufferHexOf,
  fieldOf,
  optionalOf,
  parseClarityHex,
  principalOf,
  responseOf,
  safeUintOf,
  tupleOf,
} from './clarity-values.js';
import { fetchEmilyWithdrawal } from './emily-withdrawal.js';
import {
  type StacksTransaction,
  callReadOnly,
  fetchStacksTransaction,
  fetchTransactionsAtNonce,
  normalizeStacksTxid,
} from './stacks-api.js';
import { type WithdrawalRecipient, sameRecipient } from './withdrawal-recipient.js';
import { decodeWithdrawalArguments, encodeWithdrawalArguments } from './withdrawal-request.js';

export type WithdrawalStatusConfig = Pick<
  NetworkConfig,
  'stxApiUrl' | 'sbtcApiUrl' | 'sbtcContract'
> &
  Pick<
    WithdrawalConfig,
    'withdrawalContractName' | 'withdrawalFunctionName' | 'registryContractName'
  >;

export interface WithdrawalCreateEvent {
  requestId: number;
  amountSats: number;
  maxFeeSats: number;
  sender: string;
  recipient: WithdrawalRecipient;
  burnHeight: number;
}

export type OnChainRequestStatus = 'pending' | 'accepted' | 'rejected';

export interface OnChainWithdrawalRequest {
  requestId: number;
  amountSats: number;
  maxFeeSats: number;
  sender: string;
  recipient: WithdrawalRecipient;
  burnHeight: number;
  status: OnChainRequestStatus;
}

export interface WithdrawalSweepData {
  sweepTxid: string;
  sweepBurnHash: string;
  sweepBurnHeight: number;
}

export interface WithdrawalAcceptEvent {
  requestId: number;
  bitcoinTxid: string;
  outputIndex: number;
  feeSats: number;
  sweepTxid: string;
  burnHash: string;
  burnHeight: number;
}

export type WithdrawalFailureCode =
  | 'invalid-recipient-version'
  | 'invalid-recipient-hashbytes'
  | 'below-dust'
  | 'insufficient-balance'
  | 'not-active-contract'
  | 'post-condition'
  | 'other';

export interface WithdrawalTxFailure {
  code: WithdrawalFailureCode;
  clarityError: string | null;
  message: string;
}

export interface WithdrawalTxCall {
  sender: string;
  amountSats: number;
  maxFeeSats: number;
  recipient: WithdrawalRecipient;
}

export type WithdrawalTxReading =
  | { kind: 'tx-pending' }
  | { kind: 'tx-dropped'; txStatus: string }
  | { kind: 'tx-failed'; failure: WithdrawalTxFailure }
  | { kind: 'not-a-withdrawal'; message: string }
  | {
      kind: 'tx-succeeded';
      requestId: number;
      call: WithdrawalTxCall;
      event: WithdrawalCreateEvent | null;
      blockHeight: number | null;
      burnBlockHeight: number | null;
    };

export class WithdrawalDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WithdrawalDataError';
  }
}

function contractIdOf(config: Pick<WithdrawalStatusConfig, 'sbtcContract'>, name: string): string {
  return `${config.sbtcContract}.${name}`;
}

const ERROR_CODES: Readonly<Record<number, { code: WithdrawalFailureCode; message: string }>> =
  Object.freeze({
    1: {
      code: 'insufficient-balance',
      message:
        'Your sBTC balance was too low to lock the amount plus the fee cap, so nothing was withdrawn.',
    },
    400: {
      code: 'not-active-contract',
      message:
        'The sBTC registry refused the request because this withdrawal contract is no longer the active one. Nothing was withdrawn.',
    },
    500: {
      code: 'invalid-recipient-version',
      message:
        'The withdrawal contract rejected the Bitcoin address version. Nothing was withdrawn.',
    },
    501: {
      code: 'invalid-recipient-hashbytes',
      message:
        'The withdrawal contract rejected the Bitcoin address length. Nothing was withdrawn.',
    },
    502: {
      code: 'below-dust',
      message:
        'The withdrawal contract rejected the amount as at or below its 546-sat dust limit. Nothing was withdrawn.',
    },
  });

function errorCodeOf(tx: StacksTransaction): number | null {
  if (!tx.tx_result) return null;
  try {
    const response = responseOf(parseClarityHex(tx.tx_result.hex, 'transaction result'), 'result');
    if (response.ok) return null;
    return safeUintOf(response.value, 'error code');
  } catch {
    return null;
  }
}

export function describeWithdrawalTxFailure(tx: StacksTransaction): WithdrawalTxFailure {
  const clarityError = tx.tx_result?.repr ?? tx.tx_result?.hex ?? null;
  if (tx.tx_status === 'abort_by_post_condition') {
    return {
      code: 'post-condition',
      clarityError,
      message:
        'The Stacks transaction was stopped by its post-condition, so no sBTC moved. This usually means the sBTC balance was too low to lock the amount plus the fee cap.',
    };
  }
  const code = errorCodeOf(tx);
  const known = code === null ? undefined : ERROR_CODES[code];
  if (known) return { ...known, clarityError };
  return {
    code: 'other',
    clarityError,
    message: `The withdrawal request failed on chain${clarityError ? ` with ${clarityError}` : ''}. No sBTC moved.`,
  };
}

function recipientOf(value: ClarityValue, what: string): WithdrawalRecipient {
  const fields = tupleOf(value, what);
  return {
    version: bufferHexOf(fieldOf(fields, 'version', what), `${what} version`),
    hashbytes: bufferHexOf(fieldOf(fields, 'hashbytes', what), `${what} hashbytes`),
  };
}

function printTuple(hexValue: string, what: string): Record<string, ClarityValue> {
  return tupleOf(parseClarityHex(hexValue, what), what);
}

export function parseWithdrawalCreateEvent(hexValue: string): WithdrawalCreateEvent {
  const what = 'withdrawal-create event';
  const fields = printTuple(hexValue, what);
  if (asciiOf(fieldOf(fields, 'topic', what), 'topic') !== 'withdrawal-create') {
    throw new WithdrawalDataError('Event is not a withdrawal-create event');
  }
  return {
    requestId: safeUintOf(fieldOf(fields, 'request-id', what), 'request-id'),
    amountSats: safeUintOf(fieldOf(fields, 'amount', what), 'amount'),
    maxFeeSats: safeUintOf(fieldOf(fields, 'max-fee', what), 'max-fee'),
    sender: principalOf(fieldOf(fields, 'sender', what), 'sender'),
    recipient: recipientOf(fieldOf(fields, 'recipient', what), 'recipient'),
    burnHeight: safeUintOf(fieldOf(fields, 'block-height', what), 'block-height'),
  };
}

export function parseWithdrawalAcceptEvent(hexValue: string): WithdrawalAcceptEvent {
  const what = 'withdrawal-accept event';
  const fields = printTuple(hexValue, what);
  if (asciiOf(fieldOf(fields, 'topic', what), 'topic') !== 'withdrawal-accept') {
    throw new WithdrawalDataError('Event is not a withdrawal-accept event');
  }
  return {
    requestId: safeUintOf(fieldOf(fields, 'request-id', what), 'request-id'),
    bitcoinTxid: bufferHexOf(fieldOf(fields, 'bitcoin-txid', what), 'bitcoin-txid', 32),
    outputIndex: safeUintOf(fieldOf(fields, 'output-index', what), 'output-index'),
    feeSats: safeUintOf(fieldOf(fields, 'fee', what), 'fee'),
    sweepTxid: bufferHexOf(fieldOf(fields, 'sweep-txid', what), 'sweep-txid', 32),
    burnHash: bufferHexOf(fieldOf(fields, 'burn-hash', what), 'burn-hash', 32),
    burnHeight: safeUintOf(fieldOf(fields, 'burn-height', what), 'burn-height'),
  };
}

function topicOf(hexValue: string): string | null {
  try {
    const fields = printTuple(hexValue, 'print event');
    const topic = fields.topic;
    return topic === undefined ? null : asciiOf(topic, 'topic');
  } catch {
    return null;
  }
}

function registryPrints(
  tx: StacksTransaction,
  config: Pick<WithdrawalStatusConfig, 'sbtcContract' | 'registryContractName'>,
  topic: string
): string[] {
  const registry = contractIdOf(config, config.registryContractName);
  return (tx.events ?? []).flatMap(e => {
    const log = e.contract_log;
    if (e.event_type !== 'smart_contract_log' || !log) return [];
    if (log.contract_id !== registry || log.topic !== 'print') return [];
    return topicOf(log.value.hex) === topic ? [log.value.hex] : [];
  });
}

export function requestIdOfResult(resultHex: string): number {
  const response = responseOf(parseClarityHex(resultHex, 'transaction result'), 'result');
  if (!response.ok) throw new WithdrawalDataError('The transaction result is an error');
  return safeUintOf(response.value, 'request id');
}

const ABORTED: ReadonlySet<string> = new Set(['abort_by_response', 'abort_by_post_condition']);

export function readWithdrawalRequestTransaction(
  tx: StacksTransaction,
  config: Pick<
    WithdrawalStatusConfig,
    'sbtcContract' | 'withdrawalContractName' | 'withdrawalFunctionName' | 'registryContractName'
  >
): WithdrawalTxReading {
  const call = tx.contract_call;
  if (
    tx.tx_type !== 'contract_call' ||
    !call ||
    call.contract_id !== contractIdOf(config, config.withdrawalContractName) ||
    call.function_name !== config.withdrawalFunctionName
  ) {
    return {
      kind: 'not-a-withdrawal',
      message: `This Stacks transaction is not a call to ${contractIdOf(config, config.withdrawalContractName)}::${config.withdrawalFunctionName}.`,
    };
  }
  if (tx.tx_status.startsWith('dropped')) return { kind: 'tx-dropped', txStatus: tx.tx_status };
  if (ABORTED.has(tx.tx_status)) {
    return { kind: 'tx-failed', failure: describeWithdrawalTxFailure(tx) };
  }
  if (tx.tx_status !== 'success') return { kind: 'tx-pending' };
  if (!tx.tx_result) throw new WithdrawalDataError('A successful transaction has no result');

  const requestId = requestIdOfResult(tx.tx_result.hex);
  const args = decodeWithdrawalArguments((call.function_args ?? []).map(a => a.hex));
  const events = registryPrints(tx, config, 'withdrawal-create').map(parseWithdrawalCreateEvent);
  const mine = events.filter(e => e.requestId === requestId);
  if (events.length > 0 && mine.length !== 1) {
    throw new WithdrawalDataError(
      `The transaction result says request ${requestId}, but its withdrawal-create event does not`
    );
  }
  const event = mine[0] ?? null;
  return {
    kind: 'tx-succeeded',
    requestId,
    call: {
      sender: tx.sender_address,
      amountSats: args.amountSats,
      maxFeeSats: args.maxFeeSats,
      recipient: args.recipient,
    },
    event,
    blockHeight: tx.block_height ?? null,
    burnBlockHeight: tx.burn_block_height ?? null,
  };
}

export function findWithdrawalAcceptEvent(
  tx: StacksTransaction,
  config: Pick<WithdrawalStatusConfig, 'sbtcContract' | 'registryContractName'>,
  requestId: number
): WithdrawalAcceptEvent | null {
  if (tx.tx_status !== 'success') return null;
  const events = registryPrints(tx, config, 'withdrawal-accept')
    .map(parseWithdrawalAcceptEvent)
    .filter(e => e.requestId === requestId);
  if (events.length > 1) {
    throw new WithdrawalDataError(`Several withdrawal-accept events for request ${requestId}`);
  }
  return events[0] ?? null;
}

export function parseWithdrawalRequestValue(
  value: ClarityValue,
  requestId: number
): OnChainWithdrawalRequest | null {
  const what = 'get-withdrawal-request';
  const inner = optionalOf(value, what);
  if (inner === null) return null;
  const fields = tupleOf(inner, what);
  const status = optionalOf(fieldOf(fields, 'status', what), 'status');
  let state: OnChainRequestStatus = 'pending';
  if (status !== null) state = boolOf(status, 'status') ? 'accepted' : 'rejected';
  return {
    requestId,
    amountSats: safeUintOf(fieldOf(fields, 'amount', what), 'amount'),
    maxFeeSats: safeUintOf(fieldOf(fields, 'max-fee', what), 'max-fee'),
    sender: principalOf(fieldOf(fields, 'sender', what), 'sender'),
    recipient: recipientOf(fieldOf(fields, 'recipient', what), 'recipient'),
    burnHeight: safeUintOf(fieldOf(fields, 'block-height', what), 'block-height'),
    status: state,
  };
}

export function parseSweepDataValue(value: ClarityValue): WithdrawalSweepData | null {
  const what = 'get-completed-withdrawal-sweep-data';
  const inner = optionalOf(value, what);
  if (inner === null) return null;
  const fields = tupleOf(inner, what);
  return {
    sweepTxid: bufferHexOf(fieldOf(fields, 'sweep-txid', what), 'sweep-txid', 32),
    sweepBurnHash: bufferHexOf(fieldOf(fields, 'sweep-burn-hash', what), 'sweep-burn-hash', 32),
    sweepBurnHeight: safeUintOf(fieldOf(fields, 'sweep-burn-height', what), 'sweep-burn-height'),
  };
}

function assertRequestId(requestId: number): void {
  if (!Number.isSafeInteger(requestId) || requestId < 1) {
    throw new Error('A withdrawal request id is a positive integer');
  }
}

export async function fetchOnChainWithdrawalRequest(
  config: Pick<WithdrawalStatusConfig, 'stxApiUrl' | 'sbtcContract' | 'registryContractName'>,
  requestId: number,
  fetchFn?: FetchLike
): Promise<OnChainWithdrawalRequest | null> {
  assertRequestId(requestId);
  const value = await callReadOnly(
    config.stxApiUrl,
    contractIdOf(config, config.registryContractName),
    'get-withdrawal-request',
    [Cl.uint(requestId)],
    fetchFn
  );
  return parseWithdrawalRequestValue(value, requestId);
}

export async function fetchWithdrawalSweepData(
  config: Pick<WithdrawalStatusConfig, 'stxApiUrl' | 'sbtcContract' | 'registryContractName'>,
  requestId: number,
  fetchFn?: FetchLike
): Promise<WithdrawalSweepData | null> {
  assertRequestId(requestId);
  const value = await callReadOnly(
    config.stxApiUrl,
    contractIdOf(config, config.registryContractName),
    'get-completed-withdrawal-sweep-data',
    [Cl.uint(requestId)],
    fetchFn
  );
  return parseSweepDataValue(value);
}

export const WITHDRAWAL_ROLE = '02';

export async function fetchActiveWithdrawalContract(
  config: Pick<WithdrawalStatusConfig, 'stxApiUrl' | 'sbtcContract' | 'registryContractName'>,
  fetchFn?: FetchLike
): Promise<string | null> {
  const value = await callReadOnly(
    config.stxApiUrl,
    contractIdOf(config, config.registryContractName),
    'get-active-protocol',
    [Cl.bufferFromHex(WITHDRAWAL_ROLE)],
    fetchFn
  );
  const inner = optionalOf(value, 'get-active-protocol');
  return inner === null ? null : principalOf(inner, 'active withdrawal contract');
}

export async function assertActiveWithdrawalContract(
  config: Pick<
    WithdrawalStatusConfig,
    'stxApiUrl' | 'sbtcContract' | 'registryContractName' | 'withdrawalContractName'
  >,
  fetchFn?: FetchLike
): Promise<void> {
  const active = await fetchActiveWithdrawalContract(config, fetchFn);
  const expected = contractIdOf(config, config.withdrawalContractName);
  if (active !== expected) {
    throw new Error(
      `The sBTC registry names ${active ?? 'no contract'} as the withdrawal contract, not ${expected}; refusing to build a request`
    );
  }
}

export interface ExpectedWithdrawal {
  sender: string;
  amountSats: number;
  maxFeeSats: number;
  recipient: WithdrawalRecipient;
}

interface Comparable {
  sender: string;
  amountSats: number;
  maxFeeSats: number;
  recipient: WithdrawalRecipient;
}

export function withdrawalDifferences(
  expected: ExpectedWithdrawal,
  actual: Comparable,
  source: string
): string[] {
  const problems: string[] = [];
  if (actual.sender !== expected.sender) {
    problems.push(`${source}: sender is ${actual.sender}, expected ${expected.sender}`);
  }
  if (actual.amountSats !== expected.amountSats) {
    problems.push(
      `${source}: amount is ${actual.amountSats} sats, expected ${expected.amountSats}`
    );
  }
  if (actual.maxFeeSats !== expected.maxFeeSats) {
    problems.push(
      `${source}: fee cap is ${actual.maxFeeSats} sats, expected ${expected.maxFeeSats}`
    );
  }
  if (!sameRecipient(actual.recipient, expected.recipient)) {
    problems.push(`${source}: the Bitcoin recipient differs from the one that was signed`);
  }
  return problems;
}

export type PayoutSource = 'accept-event';

export interface AcceptedPayout {
  bitcoinTxid: string;
  outputIndex: number;
  feeSats: number;
  acceptStacksTxid: string;
  source: PayoutSource;
}

export type WithdrawalStatus =
  | { kind: 'unknown-tx' }
  | { kind: 'tx-pending' }
  | { kind: 'tx-dropped'; txStatus: string; lookupError: string | null }
  | { kind: 'tx-failed'; failure: WithdrawalTxFailure }
  | { kind: 'not-a-withdrawal'; message: string }
  | { kind: 'mismatch'; requestId: number | null; problems: string[]; soft: boolean }
  | { kind: 'requested'; request: OnChainWithdrawalRequest; stacksBlockHeight: number | null }
  | { kind: 'rejected'; request: OnChainWithdrawalRequest }
  | {
      kind: 'accepted';
      request: OnChainWithdrawalRequest;
      sweep: WithdrawalSweepData | null;
      payout: AcceptedPayout | null;
      payoutError: string | null;
    };

async function acceptedPayoutOf(
  config: WithdrawalStatusConfig,
  requestId: number,
  sweep: WithdrawalSweepData | null,
  fetchFn: FetchLike | undefined
): Promise<AcceptedPayout> {
  const hint = await fetchEmilyWithdrawal(config.sbtcApiUrl, requestId, fetchFn);
  const stacksTxid = hint?.fulfillment?.StacksTxid;
  if (!stacksTxid) throw new Error('The sBTC API does not yet name the acceptance transaction');
  const acceptTx = await fetchStacksTransaction(config.stxApiUrl, stacksTxid, fetchFn);
  if (!acceptTx) throw new Error('The acceptance transaction named by the sBTC API was not found');
  const event = findWithdrawalAcceptEvent(acceptTx, config, requestId);
  if (!event) {
    throw new Error(
      'The acceptance transaction named by the sBTC API has no acceptance event for this request'
    );
  }
  if (sweep && sweep.sweepTxid !== event.sweepTxid) {
    throw new WithdrawalDataError(
      'The acceptance event and the registry disagree about the sweep transaction'
    );
  }
  return {
    bitcoinTxid: event.bitcoinTxid,
    outputIndex: event.outputIndex,
    feeSats: event.feeSats,
    acceptStacksTxid: normalizeStacksTxid(acceptTx.tx_id),
    source: 'accept-event',
  };
}

export interface ContractCallIdentity {
  contractId: string;
  functionName: string;
  sender: string;
  args: readonly string[];
}

function plainArgs(args: readonly string[]): string {
  return JSON.stringify(args.map(arg => arg.toLowerCase().replace(/^0x/, '')));
}

export function contractCallOf(tx: StacksTransaction): ContractCallIdentity | null {
  const call = tx.contract_call;
  if (tx.tx_type !== 'contract_call' || !call) return null;
  return {
    contractId: call.contract_id,
    functionName: call.function_name,
    sender: tx.sender_address,
    args: (call.function_args ?? []).map(arg => arg.hex),
  };
}

export function sameContractCall(a: ContractCallIdentity, b: ContractCallIdentity): boolean {
  return (
    a.contractId === b.contractId &&
    a.functionName === b.functionName &&
    a.sender === b.sender &&
    plainArgs(a.args) === plainArgs(b.args)
  );
}

export function expectedWithdrawalCall(
  config: Pick<
    WithdrawalStatusConfig,
    'sbtcContract' | 'withdrawalContractName' | 'withdrawalFunctionName'
  >,
  expected: ExpectedWithdrawal
): ContractCallIdentity {
  return {
    contractId: contractIdOf(config, config.withdrawalContractName),
    functionName: config.withdrawalFunctionName,
    sender: expected.sender,
    args: encodeWithdrawalArguments(expected.amountSats, expected.recipient, expected.maxFeeSats),
  };
}

export async function findReplacementTransaction(
  config: Pick<WithdrawalStatusConfig, 'stxApiUrl'>,
  dropped: StacksTransaction,
  fetchFn?: FetchLike
): Promise<StacksTransaction | null> {
  if (dropped.nonce === undefined) return null;
  const droppedId = normalizeStacksTxid(dropped.tx_id);
  const candidates = await fetchTransactionsAtNonce(
    config.stxApiUrl,
    dropped.sender_address,
    dropped.nonce,
    fetchFn
  );
  const original = contractCallOf(dropped);
  const match = candidates.find(tx => {
    const call = contractCallOf(tx);
    return (
      normalizeStacksTxid(tx.tx_id) !== droppedId &&
      !tx.tx_status.startsWith('dropped') &&
      original !== null &&
      call !== null &&
      sameContractCall(original, call)
    );
  });
  if (!match) return null;
  return (await fetchStacksTransaction(config.stxApiUrl, match.tx_id, fetchFn)) ?? match;
}

async function statusOfTransaction(
  config: WithdrawalStatusConfig,
  tx: StacksTransaction,
  expected: ExpectedWithdrawal,
  fetchFn: FetchLike | undefined
): Promise<WithdrawalStatus> {
  const reading = readWithdrawalRequestTransaction(tx, config);
  if (reading.kind === 'tx-dropped') return { ...reading, lookupError: null };
  if (reading.kind !== 'tx-succeeded') return reading;

  const { requestId } = reading;
  const problems = withdrawalDifferences(expected, reading.call, 'Signed transaction');
  if (reading.event) {
    problems.push(...withdrawalDifferences(expected, reading.event, 'withdrawal-create event'));
  }
  const request = await fetchOnChainWithdrawalRequest(config, requestId, fetchFn);
  if (!request) {
    return {
      kind: 'mismatch',
      requestId,
      problems: [...problems, `The sBTC registry has no withdrawal request ${requestId}`],
      soft: problems.length === 0,
    };
  }
  problems.push(...withdrawalDifferences(expected, request, 'sBTC registry'));
  if (problems.length > 0) return { kind: 'mismatch', requestId, problems, soft: false };

  if (request.status === 'pending') {
    return { kind: 'requested', request, stacksBlockHeight: reading.blockHeight };
  }
  if (request.status === 'rejected') return { kind: 'rejected', request };

  const sweep = await fetchWithdrawalSweepData(config, requestId, fetchFn);
  try {
    const payout = await acceptedPayoutOf(config, requestId, sweep, fetchFn);
    return { kind: 'accepted', request, sweep, payout, payoutError: null };
  } catch (err) {
    if (err instanceof WithdrawalDataError) {
      return { kind: 'mismatch', requestId, problems: [err.message], soft: true };
    }
    return {
      kind: 'accepted',
      request,
      sweep,
      payout: null,
      payoutError: errorMessage(err) ?? String(err),
    };
  }
}

export interface FollowedWithdrawalStatus {
  stacksTxid: string;
  status: WithdrawalStatus;
}

export async function followWithdrawalStatus(
  config: WithdrawalStatusConfig,
  stacksTxid: string,
  expected: ExpectedWithdrawal,
  fetchFn?: FetchLike
): Promise<FollowedWithdrawalStatus> {
  const id = normalizeStacksTxid(stacksTxid);
  const tx = await fetchStacksTransaction(config.stxApiUrl, id, fetchFn);
  if (!tx) return { stacksTxid: id, status: { kind: 'unknown-tx' } };
  const status = await statusOfTransaction(config, tx, expected, fetchFn);
  if (status.kind !== 'tx-dropped') return { stacksTxid: id, status };
  let replacement: StacksTransaction | null;
  try {
    replacement = await findReplacementTransaction(config, tx, fetchFn);
  } catch (err) {
    return { stacksTxid: id, status: { ...status, lookupError: errorMessage(err) ?? String(err) } };
  }
  if (!replacement) return { stacksTxid: id, status };
  return {
    stacksTxid: normalizeStacksTxid(replacement.tx_id),
    status: await statusOfTransaction(config, replacement, expected, fetchFn),
  };
}

export async function fetchWithdrawalStatus(
  config: WithdrawalStatusConfig,
  stacksTxid: string,
  expected: ExpectedWithdrawal,
  fetchFn?: FetchLike
): Promise<WithdrawalStatus> {
  return (await followWithdrawalStatus(config, stacksTxid, expected, fetchFn)).status;
}

export type PastedWithdrawalCheck =
  | { kind: 'matches'; stacksTxid: string }
  | { kind: 'not-found' }
  | { kind: 'different'; message: string };

export async function checkPastedWithdrawalTransaction(
  config: WithdrawalStatusConfig,
  stacksTxid: string,
  expected: ExpectedWithdrawal,
  fetchFn?: FetchLike
): Promise<PastedWithdrawalCheck> {
  const id = normalizeStacksTxid(stacksTxid);
  const tx = await fetchStacksTransaction(config.stxApiUrl, id, fetchFn);
  if (!tx) return { kind: 'not-found' };
  const want = expectedWithdrawalCall(config, expected);
  const call = contractCallOf(tx);
  if (!call || call.contractId !== want.contractId || call.functionName !== want.functionName) {
    return {
      kind: 'different',
      message: `It is not a call to ${want.contractId}::${want.functionName}.`,
    };
  }
  if (call.sender !== want.sender) {
    return {
      kind: 'different',
      message: `It was sent from ${call.sender}, not from ${want.sender}.`,
    };
  }
  if (!sameContractCall(call, want)) {
    return {
      kind: 'different',
      message: 'It withdraws a different amount, fee cap or Bitcoin address than this withdrawal.',
    };
  }
  return { kind: 'matches', stacksTxid: id };
}
