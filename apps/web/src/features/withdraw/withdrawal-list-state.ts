import {
  type WithdrawalProgress,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
  errorMessage,
} from '@satway/core';

import {
  type FlowMachine,
  type Transition,
  type WithdrawalReceiptFile,
  nextRequest,
  transition,
  verifyWithdrawalReceipt,
  withdrawalId,
} from '../../shared/index.js';

export const NOT_A_RECEIPT = 'That file is not a withdrawal receipt.';
export const NEVER_SENT =
  'This browser never got a transaction ID from the wallet for this withdrawal.';

export type EntryStatus =
  | { kind: 'unsent' }
  | { kind: 'checking' }
  | { kind: 'checked'; progress: WithdrawalProgress }
  | { kind: 'failed'; message: string };

export type FileLoad =
  | { kind: 'idle' }
  | { kind: 'reading'; request: number }
  | { kind: 'failed'; message: string };

export interface ListState {
  last: number;
  opened: boolean;
  entries: readonly WithdrawalReceiptFile[];
  statuses: Readonly<Record<string, EntryStatus>>;
  file: FileLoad;
}

export type ListEvent =
  | { type: 'opened' }
  | { type: 'checked'; id: string; progress: WithdrawalProgress }
  | { type: 'check-failed'; id: string; message: string }
  | { type: 'file-chosen'; file: Blob }
  | { type: 'file-read'; request: number; text: string | null };

export type ListEffect =
  | { type: 'check'; receipt: WithdrawalReceiptFile; stacksTxid: string }
  | { type: 'read'; request: number; file: Blob }
  | { type: 'follow'; receipt: WithdrawalReceiptFile };

type Step = Transition<ListState, ListEffect>;

export function initialList(entries: readonly WithdrawalReceiptFile[]): ListState {
  const statuses: Record<string, EntryStatus> = {};
  for (const r of entries) {
    statuses[withdrawalId(r)] = r.stacksTxid === null ? { kind: 'unsent' } : { kind: 'checking' };
  }
  return { last: 0, opened: false, entries, statuses, file: { kind: 'idle' } };
}

function opened(state: ListState): Step {
  if (state.opened) return transition(state);
  const effects = state.entries.flatMap((receipt): ListEffect[] =>
    receipt.stacksTxid === null ? [] : [{ type: 'check', receipt, stacksTxid: receipt.stacksTxid }]
  );
  return transition({ ...state, opened: true }, effects);
}

function settled(state: ListState, id: string, status: EntryStatus): Step {
  if (state.statuses[id]?.kind !== 'checking') return transition(state);
  return transition({ ...state, statuses: { ...state.statuses, [id]: status } });
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
    const receipt = verifyWithdrawalReceipt(config, value);
    return transition({ ...state, file: { kind: 'idle' } }, [{ type: 'follow', receipt }]);
  } catch (err) {
    const message = errorMessage(err) ?? 'That receipt could not be read.';
    return transition({ ...state, file: { kind: 'failed', message } });
  }
}

export function reduceList(state: ListState, event: ListEvent): Step {
  switch (event.type) {
    case 'opened':
      return opened(state);
    case 'checked':
      return settled(state, event.id, { kind: 'checked', progress: event.progress });
    case 'check-failed':
      return settled(state, event.id, { kind: 'failed', message: event.message });
    case 'file-chosen': {
      const request = nextRequest(state.last);
      return transition({ ...state, last: request, file: { kind: 'reading', request } }, [
        { type: 'read', request, file: event.file },
      ]);
    }
    case 'file-read':
      return fileRead(state, event.request, event.text);
    default:
      throw new Error(`Unknown list event ${String(event satisfies never)}`);
  }
}

export const listMachine: FlowMachine<ListState, ListEvent, ListEffect> = { reduce: reduceList };

export function receiptToFollow(
  loaded: WithdrawalReceiptFile,
  stored: WithdrawalReceiptFile | null
): WithdrawalReceiptFile {
  if (stored === null || withdrawalId(stored) !== withdrawalId(loaded)) return loaded;
  return loaded.stacksTxid === null && stored.stacksTxid !== null ? stored : loaded;
}

export function entryLabel(r: WithdrawalReceiptFile): string {
  const started = new Date(r.createdAt).toLocaleString();
  const sent = r.stacksTxid === null ? ', not confirmed as sent' : '';
  return `${r.amountSats.toLocaleString('en-US')} sats to ${r.destination.symbol} on ${r.destination.chain}, started ${started}${sent}`;
}

export interface EntryStatusView {
  message: string;
  warning: boolean;
}

export function entryStatusView(status: EntryStatus | undefined): EntryStatusView {
  switch (status?.kind) {
    case undefined:
    case 'checking':
      return { message: 'Checking…', warning: false };
    case 'unsent':
      return { message: NEVER_SENT, warning: true };
    case 'checked':
      return { message: status.progress.message, warning: status.progress.warning };
    case 'failed':
      return { message: `Could not check it right now: ${status.message}`, warning: false };
    default:
      throw new Error(`Unknown entry status ${String(status satisfies never)}`);
  }
}
