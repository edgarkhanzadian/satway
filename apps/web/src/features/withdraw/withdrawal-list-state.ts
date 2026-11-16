import {
  type PastedWithdrawalCheck,
  type WithdrawalProgress,
  type WithdrawalStage,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
  errorMessage,
} from '@satway/core';

import {
  type FlowMachine,
  type Transition,
  type WithdrawalReceiptFile,
  nextRequest,
  transition,
  verifyLoadedWithdrawalReceipt,
  withStacksTxid,
  withdrawalId,
} from '../../shared/index.js';
import type { KnownStatus } from './entry-statuses.js';

export const NOT_A_RECEIPT = 'That file is not a withdrawal receipt.';
export const NEVER_SENT =
  'This browser never got a transaction ID from the wallet for this withdrawal.';
export const AUTO_CHECKED = 3;
export const MAX_CHECKS = 2;

export const FINAL_STAGES: ReadonlySet<WithdrawalStage> = new Set<WithdrawalStage>([
  'done',
  'refunded',
  'rejected',
  'request-failed',
]);

export type EntryStatus =
  | { kind: 'unsent' }
  | { kind: 'idle'; known: KnownStatus | null }
  | { kind: 'queued'; known: KnownStatus | null }
  | { kind: 'checking'; request: number; known: KnownStatus | null }
  | { kind: 'checked'; status: KnownStatus }
  | { kind: 'failed'; message: string; known: KnownStatus | null };

export type FileLoad =
  | { kind: 'idle' }
  | { kind: 'reading'; request: number }
  | { kind: 'resolving'; request: number; receipt: WithdrawalReceiptFile }
  | { kind: 'verifying'; request: number; receipt: WithdrawalReceiptFile }
  | { kind: 'failed'; message: string };

export interface Removal {
  id: string;
  stage: 'confirm' | 'confirm-again';
}

export interface ListState {
  last: number;
  opened: boolean;
  entries: readonly WithdrawalReceiptFile[];
  statuses: Readonly<Record<string, EntryStatus>>;
  file: FileLoad;
  removal: Removal | null;
}

export type ListEvent =
  | { type: 'opened' }
  | { type: 'check-requested'; id: string }
  | { type: 'checked'; request: number; id: string; progress: WithdrawalProgress }
  | { type: 'check-failed'; request: number; id: string; message: string }
  | { type: 'remove-requested'; id: string }
  | { type: 'remove-confirmed'; id: string }
  | { type: 'remove-cancelled' }
  | { type: 'file-chosen'; file: Blob }
  | { type: 'file-read'; request: number; text: string | null }
  | { type: 'file-resolved'; request: number; stored: WithdrawalReceiptFile | null }
  | { type: 'file-txid-checked'; request: number; check: PastedWithdrawalCheck }
  | { type: 'file-txid-check-failed'; request: number; message: string };

export type ListEffect =
  | { type: 'check'; request: number; receipt: WithdrawalReceiptFile; stacksTxid: string }
  | { type: 'remember-status'; receipt: WithdrawalReceiptFile; status: KnownStatus | null }
  | { type: 'read'; request: number; file: Blob }
  | { type: 'resolve'; request: number; receipt: WithdrawalReceiptFile }
  | { type: 'check-txid'; request: number; receipt: WithdrawalReceiptFile; txid: string }
  | { type: 'follow'; receipt: WithdrawalReceiptFile }
  | { type: 'remove'; receipt: WithdrawalReceiptFile };

type Step = Transition<ListState, ListEffect>;

export function isFinal(status: KnownStatus | null): boolean {
  return status !== null && FINAL_STAGES.has(status.stage);
}

function knownOf(status: EntryStatus | undefined): KnownStatus | null {
  switch (status?.kind) {
    case undefined:
    case 'unsent':
      return null;
    case 'checked':
      return status.status;
    case 'idle':
    case 'queued':
    case 'checking':
    case 'failed':
      return status.known;
    default:
      throw new Error(`Unknown entry status ${String(status satisfies never)}`);
  }
}

export function initialList(
  entries: readonly WithdrawalReceiptFile[],
  known: Readonly<Record<string, KnownStatus>> = {}
): ListState {
  const statuses: Record<string, EntryStatus> = {};
  let automatic = 0;
  for (const r of entries) {
    const id = withdrawalId(r);
    const last = known[id] ?? null;
    if (r.stacksTxid === null) statuses[id] = { kind: 'unsent' };
    else if (last !== null && isFinal(last)) statuses[id] = { kind: 'checked', status: last };
    else if (automatic < AUTO_CHECKED) {
      automatic += 1;
      statuses[id] = { kind: 'queued', known: last };
    } else statuses[id] = { kind: 'idle', known: last };
  }
  return { last: 0, opened: false, entries, statuses, file: { kind: 'idle' }, removal: null };
}

function pump(state: ListState, effects: readonly ListEffect[] = []): Step {
  let { last } = state;
  const statuses = { ...state.statuses };
  const started: ListEffect[] = [];
  let running = Object.values(statuses).filter(s => s.kind === 'checking').length;
  for (const receipt of state.entries) {
    if (running >= MAX_CHECKS) break;
    const id = withdrawalId(receipt);
    const status = statuses[id];
    if (status?.kind !== 'queued' || receipt.stacksTxid === null) continue;
    last = nextRequest(last);
    running += 1;
    statuses[id] = { kind: 'checking', request: last, known: status.known };
    started.push({ type: 'check', request: last, receipt, stacksTxid: receipt.stacksTxid });
  }
  if (started.length === 0 && effects.length === 0) return transition(state);
  return transition({ ...state, last, statuses }, [...effects, ...started]);
}

function entryOf(state: ListState, id: string): WithdrawalReceiptFile | null {
  return state.entries.find(r => withdrawalId(r) === id) ?? null;
}

function settle(
  state: ListState,
  request: number,
  id: string,
  next: (known: KnownStatus | null) => EntryStatus
): Step {
  const status = state.statuses[id];
  const receipt = entryOf(state, id);
  if (status?.kind !== 'checking' || status.request !== request || receipt === null) {
    return transition(state);
  }
  const settled = next(status.known);
  const updated = { ...state, statuses: { ...state.statuses, [id]: settled } };
  const remembered: ListEffect[] =
    settled.kind === 'checked'
      ? [{ type: 'remember-status', receipt, status: settled.status }]
      : [];
  return pump(updated, remembered);
}

function finished(status: EntryStatus | undefined): boolean {
  return isFinal(knownOf(status));
}

function removeConfirmed(state: ListState, id: string): Step {
  const receipt = entryOf(state, id);
  if (state.removal?.id !== id || receipt === null) return transition(state);
  if (state.removal.stage === 'confirm' && !finished(state.statuses[id])) {
    return transition({ ...state, removal: { id, stage: 'confirm-again' } });
  }
  const statuses = { ...state.statuses };
  delete statuses[id];
  return transition(
    {
      ...state,
      entries: state.entries.filter(r => withdrawalId(r) !== id),
      statuses,
      removal: null,
    },
    [
      { type: 'remove', receipt },
      { type: 'remember-status', receipt, status: null },
    ]
  );
}

function parsed(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

function fileRead(state: ListState, request: number, text: string | null): Step {
  if (state.file.kind !== 'reading' || state.file.request !== request) return transition(state);
  const value = text === null ? undefined : parsed(text);
  if (value === undefined) {
    return transition({ ...state, file: { kind: 'failed', message: NOT_A_RECEIPT } });
  }
  try {
    const receipt = verifyLoadedWithdrawalReceipt(config, value);
    return transition({ ...state, file: { kind: 'resolving', request, receipt } }, [
      { type: 'resolve', request, receipt },
    ]);
  } catch (err) {
    const message = errorMessage(err) ?? 'That receipt could not be read.';
    return transition({ ...state, file: { kind: 'failed', message } });
  }
}

export type FileDecision =
  | { kind: 'follow'; receipt: WithdrawalReceiptFile }
  | { kind: 'kept'; message: string }
  | { kind: 'verify'; txid: string };

export function fileDecision(
  loaded: WithdrawalReceiptFile,
  stored: WithdrawalReceiptFile | null
): FileDecision {
  const same = stored !== null && withdrawalId(stored) === withdrawalId(loaded) ? stored : null;
  if (same !== null && same.stacksTxid !== null) {
    if (loaded.stacksTxid === null || loaded.stacksTxid === same.stacksTxid) {
      return { kind: 'follow', receipt: same };
    }
    return {
      kind: 'kept',
      message: `This browser already has this withdrawal with Stacks transaction 0x${same.stacksTxid}. The file names 0x${loaded.stacksTxid}, so the browser’s copy was kept. Follow it from the list above.`,
    };
  }
  if (loaded.stacksTxid === null) return { kind: 'follow', receipt: same ?? loaded };
  return { kind: 'verify', txid: loaded.stacksTxid };
}

function fileResolved(
  state: ListState,
  request: number,
  stored: WithdrawalReceiptFile | null
): Step {
  if (state.file.kind !== 'resolving' || state.file.request !== request) return transition(state);
  const { receipt } = state.file;
  const decision = fileDecision(receipt, stored);
  switch (decision.kind) {
    case 'follow':
      return transition<ListState, ListEffect>({ ...state, file: { kind: 'idle' } }, [
        { type: 'follow', receipt: decision.receipt },
      ]);
    case 'kept':
      return transition<ListState, ListEffect>({
        ...state,
        file: { kind: 'failed', message: decision.message },
      });
    case 'verify':
      return transition<ListState, ListEffect>(
        { ...state, file: { kind: 'verifying', request, receipt } },
        [{ type: 'check-txid', request, receipt, txid: decision.txid }]
      );
    default:
      throw new Error(`Unknown file decision ${String(decision satisfies never)}`);
  }
}

function fileTxidChecked(state: ListState, request: number, check: PastedWithdrawalCheck): Step {
  if (state.file.kind !== 'verifying' || state.file.request !== request) return transition(state);
  const { receipt } = state.file;
  switch (check.kind) {
    case 'matches':
      return transition({ ...state, file: { kind: 'idle' } }, [
        { type: 'follow', receipt: withStacksTxid(receipt, check.stacksTxid) },
      ]);
    case 'not-found':
      return transition({
        ...state,
        file: {
          kind: 'failed',
          message: `Stacks does not know this receipt’s transaction 0x${receipt.stacksTxid ?? ''} yet, so it was not saved. If it was sent just now, load the file again in a minute.`,
        },
      });
    case 'different':
      return transition({
        ...state,
        file: {
          kind: 'failed',
          message: `The receipt’s Stacks transaction is not this withdrawal. ${check.message} The file was not saved.`,
        },
      });
    default:
      throw new Error(`Unknown txid check ${String(check satisfies never)}`);
  }
}

function fileFailed(state: ListState, request: number, message: string): Step {
  const file = state.file;
  if (file.kind !== 'verifying' || file.request !== request) return transition(state);
  return transition({
    ...state,
    file: {
      kind: 'failed',
      message: `Could not check the receipt’s Stacks transaction: ${message}. Try again.`,
    },
  });
}

export function reduceList(state: ListState, event: ListEvent): Step {
  switch (event.type) {
    case 'opened':
      return state.opened ? transition(state) : pump({ ...state, opened: true });
    case 'check-requested': {
      const status = state.statuses[event.id];
      if (status?.kind !== 'idle' && status?.kind !== 'failed' && status?.kind !== 'checked') {
        return transition(state);
      }
      const queued: EntryStatus = { kind: 'queued', known: knownOf(status) };
      return pump({ ...state, statuses: { ...state.statuses, [event.id]: queued } });
    }
    case 'checked':
      return settle(state, event.request, event.id, () => ({
        kind: 'checked',
        status: {
          stage: event.progress.stage,
          message: event.progress.message,
          warning: event.progress.warning,
        },
      }));
    case 'check-failed':
      return settle(state, event.request, event.id, known => ({
        kind: 'failed',
        message: event.message,
        known,
      }));
    case 'remove-requested':
      if (entryOf(state, event.id) === null) return transition(state);
      return transition({ ...state, removal: { id: event.id, stage: 'confirm' } });
    case 'remove-confirmed':
      return removeConfirmed(state, event.id);
    case 'remove-cancelled':
      return state.removal === null ? transition(state) : transition({ ...state, removal: null });
    case 'file-chosen': {
      const request = nextRequest(state.last);
      return transition({ ...state, last: request, file: { kind: 'reading', request } }, [
        { type: 'read', request, file: event.file },
      ]);
    }
    case 'file-read':
      return fileRead(state, event.request, event.text);
    case 'file-resolved':
      return fileResolved(state, event.request, event.stored);
    case 'file-txid-checked':
      return fileTxidChecked(state, event.request, event.check);
    case 'file-txid-check-failed':
      return fileFailed(state, event.request, event.message);
    default:
      throw new Error(`Unknown list event ${String(event satisfies never)}`);
  }
}

export function pendingListRequests(state: ListState): readonly number[] {
  const checks = Object.values(state.statuses).flatMap(s =>
    s.kind === 'checking' ? [s.request] : []
  );
  const file = state.file;
  return file.kind === 'idle' || file.kind === 'failed' ? checks : [...checks, file.request];
}

export const listMachine: FlowMachine<ListState, ListEvent, ListEffect> = {
  reduce: reduceList,
  pending: pendingListRequests,
  durable: effect => effect.type === 'remove' || effect.type === 'remember-status',
};

export function entryLabel(r: WithdrawalReceiptFile): string {
  const started = new Date(r.createdAt).toLocaleString();
  const sent = r.stacksTxid === null ? ', not confirmed as sent' : '';
  return `${r.amountSats.toLocaleString('en-US')} sats to ${r.destination.symbol} on ${r.destination.chain}, started ${started}${sent}`;
}

export interface EntryStatusView {
  message: string;
  warning: boolean;
  checkable: boolean;
  checkLabel: 'Check' | 'Check again';
  final: boolean;
}

export function entryStatusView(status: EntryStatus | undefined): EntryStatusView {
  const known = knownOf(status);
  const final = isFinal(known);
  const checkLabel = known === null && status?.kind !== 'failed' ? 'Check' : 'Check again';
  switch (status?.kind) {
    case undefined:
    case 'queued':
    case 'checking':
      return { message: 'Checking…', warning: false, checkable: false, checkLabel, final };
    case 'unsent':
      return { message: NEVER_SENT, warning: true, checkable: false, checkLabel, final };
    case 'checked':
      return {
        message: status.status.message,
        warning: status.status.warning,
        checkable: true,
        checkLabel,
        final,
      };
    case 'idle':
      return {
        message: status.known === null ? 'Not checked yet.' : `Last seen: ${status.known.message}`,
        warning: status.known?.warning ?? false,
        checkable: true,
        checkLabel,
        final,
      };
    case 'failed':
      return {
        message: `Could not check it right now: ${status.message}`,
        warning: false,
        checkable: true,
        checkLabel,
        final,
      };
    default:
      throw new Error(`Unknown entry status ${String(status satisfies never)}`);
  }
}
