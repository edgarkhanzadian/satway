import { type FoundDeposit, type Stage, errorMessage } from '@satway/core';

import {
  type FlowMachine,
  type Receipt,
  type Snapshot,
  type Transition,
  nextRequest,
  receiptId,
  transition,
  verifyReceipt,
} from '../../shared/index.js';
import type { KnownStage } from './deposit-stages.js';
import { reclaimOffered, reclaimPlanOf } from './reclaim-plan.js';

export const CHECK_CONCURRENCY = 2;
export const NOT_A_RECEIPT = 'That file is not a deposit receipt.';

export type EntryStatus =
  | { kind: 'queued' }
  | { kind: 'checking'; request: number }
  | { kind: 'known'; known: KnownStage }
  | { kind: 'failed'; message: string };

export type ReceiptCheck =
  | { kind: 'checking'; request: number }
  | { kind: 'checked'; snapshot: Snapshot }
  | { kind: 'refreshing'; request: number; snapshot: Snapshot };

export interface OpenedReceipt {
  kind: 'receipt';
  source: 'saved' | 'file';
  receipt: Receipt;
  reclaim: boolean;
  check: ReceiptCheck;
}

export type Opened = { kind: 'none' } | OpenedReceipt | { kind: 'found'; deposit: FoundDeposit };

export type FileLoad = { kind: 'idle' } | { kind: 'reading'; request: number };

export interface ListState {
  last: number;
  started: boolean;
  entries: readonly Receipt[];
  statuses: Readonly<Record<string, EntryStatus>>;
  opened: Opened;
  file: FileLoad;
  error: string | null;
}

export type ListEvent =
  | { type: 'shown' }
  | { type: 'entry-checked'; request: number; id: string; snapshot: Snapshot }
  | { type: 'entry-check-failed'; request: number; id: string; message: string }
  | { type: 'details-opened'; id: string; reclaim: boolean }
  | { type: 'file-chosen'; file: Blob }
  | { type: 'file-read'; request: number; text: string | null }
  | { type: 'receipt-checked'; request: number; snapshot: Snapshot }
  | { type: 'receipt-check-failed'; request: number; message: string | null }
  | { type: 'refresh-requested' }
  | { type: 'found-picked'; deposit: FoundDeposit };

export type ListEffect =
  | { type: 'check-entry'; request: number; id: string; receipt: Receipt }
  | { type: 'check-receipt'; request: number; receipt: Receipt }
  | { type: 'remember-stage'; id: string; known: KnownStage }
  | { type: 'read-file'; request: number; file: Blob };

type Step = Transition<ListState, ListEffect>;

export function initialList(
  entries: readonly Receipt[],
  remembered: Readonly<Record<string, KnownStage>>
): ListState {
  const statuses: Record<string, EntryStatus> = {};
  for (const receipt of entries) {
    const id = receiptId(receipt);
    const known = remembered[id];
    statuses[id] = known?.terminal === true ? { kind: 'known', known } : { kind: 'queued' };
  }
  return {
    last: 0,
    started: false,
    entries,
    statuses,
    opened: { kind: 'none' },
    file: { kind: 'idle' },
    error: null,
  };
}

export function knownStageOf(snapshot: Snapshot, receipt: Receipt): KnownStage {
  const stage: Stage = snapshot.progress.stage;
  return {
    stage,
    terminal: snapshot.progress.terminal,
    reclaimable: reclaimOffered(reclaimPlanOf(snapshot, receipt.reclaimLockBlocks), stage),
  };
}

function checking(state: ListState): number {
  return Object.values(state.statuses).filter(s => s.kind === 'checking').length;
}

function startQueued(state: ListState): Step {
  let next = state;
  const effects: ListEffect[] = [];
  for (const receipt of state.entries) {
    if (checking(next) >= CHECK_CONCURRENCY) break;
    const id = receiptId(receipt);
    if (next.statuses[id]?.kind !== 'queued') continue;
    const request = nextRequest(next.last);
    next = {
      ...next,
      last: request,
      statuses: { ...next.statuses, [id]: { kind: 'checking', request } },
    };
    effects.push({ type: 'check-entry', request, id, receipt });
  }
  return transition(next, effects);
}

function entryOf(state: ListState, id: string): Receipt | undefined {
  return state.entries.find(r => receiptId(r) === id);
}

function withStatus(state: ListState, id: string, status: EntryStatus): ListState {
  return { ...state, statuses: { ...state.statuses, [id]: status } };
}

function remember(
  state: ListState,
  id: string,
  receipt: Receipt,
  snapshot: Snapshot
): [ListState, ListEffect] {
  const known = knownStageOf(snapshot, receipt);
  return [withStatus(state, id, { kind: 'known', known }), { type: 'remember-stage', id, known }];
}

function entrySettled(state: ListState, request: number, id: string, status: EntryStatus): Step {
  const current = state.statuses[id];
  if (current?.kind !== 'checking' || current.request !== request) return transition(state);
  const next = startQueued(withStatus(state, id, status));
  return next;
}

function entryChecked(state: ListState, request: number, id: string, snapshot: Snapshot): Step {
  const current = state.statuses[id];
  const receipt = entryOf(state, id);
  if (current?.kind !== 'checking' || current.request !== request || !receipt) {
    return transition(state);
  }
  const [known, effect] = remember(state, id, receipt, snapshot);
  const next = startQueued(known);
  return transition(next.state, [effect, ...next.effects]);
}

function openReceipt(
  state: ListState,
  receipt: Receipt,
  source: OpenedReceipt['source'],
  reclaim: boolean
): Step {
  const request = nextRequest(state.last);
  return transition(
    {
      ...state,
      last: request,
      error: null,
      file: { kind: 'idle' },
      opened: { kind: 'receipt', source, receipt, reclaim, check: { kind: 'checking', request } },
    },
    [{ type: 'check-receipt', request, receipt }]
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
    return transition({ ...state, file: { kind: 'idle' }, error: NOT_A_RECEIPT });
  }
  let receipt: Receipt;
  try {
    receipt = verifyReceipt(value);
  } catch (err) {
    return transition({ ...state, file: { kind: 'idle' }, error: errorMessage(err) ?? null });
  }
  return openReceipt(state, receipt, 'file', false);
}

function openedCheck(state: ListState, request: number): OpenedReceipt | null {
  const opened = state.opened;
  if (opened.kind !== 'receipt' || opened.check.kind === 'checked') return null;
  return opened.check.request === request ? opened : null;
}

function receiptChecked(state: ListState, request: number, snapshot: Snapshot): Step {
  const opened = openedCheck(state, request);
  if (!opened) return transition(state);
  const shown: ListState = {
    ...state,
    opened: { ...opened, check: { kind: 'checked', snapshot } },
  };
  if (opened.source !== 'saved') return transition(shown);
  const id = receiptId(opened.receipt);
  if (!entryOf(state, id)) return transition(shown);
  const status = shown.statuses[id];
  const [known, effect] = remember(shown, id, opened.receipt, snapshot);
  const kept = status?.kind === 'checking' ? shown : known;
  return transition(kept, [effect]);
}

function receiptCheckFailed(state: ListState, request: number, message: string | null): Step {
  const opened = openedCheck(state, request);
  if (!opened) return transition(state);
  if (opened.check.kind === 'refreshing') {
    return transition({
      ...state,
      opened: { ...opened, check: { kind: 'checked', snapshot: opened.check.snapshot } },
    });
  }
  return transition({ ...state, opened: { kind: 'none' }, error: message });
}

function refreshRequested(state: ListState): Step {
  const opened = state.opened;
  if (opened.kind !== 'receipt' || opened.check.kind !== 'checked') return transition(state);
  const request = nextRequest(state.last);
  return transition(
    {
      ...state,
      last: request,
      opened: {
        ...opened,
        check: { kind: 'refreshing', request, snapshot: opened.check.snapshot },
      },
    },
    [{ type: 'check-receipt', request, receipt: opened.receipt }]
  );
}

export function reduceList(state: ListState, event: ListEvent): Step {
  switch (event.type) {
    case 'shown':
      if (state.started) return transition(state);
      return startQueued({ ...state, started: true });
    case 'entry-checked':
      return entryChecked(state, event.request, event.id, event.snapshot);
    case 'entry-check-failed':
      return entrySettled(state, event.request, event.id, {
        kind: 'failed',
        message: event.message,
      });
    case 'details-opened': {
      const receipt = entryOf(state, event.id);
      if (!receipt) return transition(state);
      return openReceipt(state, receipt, 'saved', event.reclaim);
    }
    case 'file-chosen': {
      const request = nextRequest(state.last);
      return transition(
        {
          ...state,
          last: request,
          opened: { kind: 'none' },
          error: null,
          file: { kind: 'reading', request },
        },
        [{ type: 'read-file', request, file: event.file }]
      );
    }
    case 'file-read':
      return fileRead(state, event.request, event.text);
    case 'receipt-checked':
      return receiptChecked(state, event.request, event.snapshot);
    case 'receipt-check-failed':
      return receiptCheckFailed(state, event.request, event.message);
    case 'refresh-requested':
      return refreshRequested(state);
    case 'found-picked':
      return transition({
        ...state,
        error: null,
        file: { kind: 'idle' },
        opened: { kind: 'found', deposit: event.deposit },
      });
    default:
      throw new Error(`Unknown list event ${String(event satisfies never)}`);
  }
}

export function pendingList(state: ListState): readonly number[] {
  const requests: number[] = [];
  for (const status of Object.values(state.statuses)) {
    if (status.kind === 'checking') requests.push(status.request);
  }
  const opened = state.opened;
  if (opened.kind === 'receipt' && opened.check.kind !== 'checked') {
    requests.push(opened.check.request);
  }
  if (state.file.kind === 'reading') requests.push(state.file.request);
  return requests;
}

export const listMachine: FlowMachine<ListState, ListEvent, ListEffect> = {
  reduce: reduceList,
  pending: pendingList,
  durable: effect => effect.type === 'remember-stage',
};

const STAGE_LABELS: Record<Stage, string> = {
  'awaiting-funds': 'Waiting for your payment',
  swapping: 'Swapping to BTC',
  'awaiting-payout': 'Waiting for the BTC payout',
  'payout-unconfirmed': 'Waiting for Bitcoin confirmations',
  'awaiting-notification': 'Registering with the sBTC signers',
  minting: 'Waiting for the signers to mint sBTC',
  done: 'sBTC minted',
  refunded: 'Refunded by the swap provider',
  'swap-failed': 'The swap failed',
  'mint-failed': 'Rejected by the sBTC signers',
  reclaimable: 'Reclaimable now',
  reclaimed: 'Reclaimed',
};

export interface EntryView {
  id: string;
  receipt: Receipt;
  summary: string;
  follow: boolean;
  reclaim: boolean;
}

function summaryOf(status: EntryStatus | undefined): string {
  switch (status?.kind) {
    case undefined:
    case 'queued':
    case 'checking':
      return 'Checking…';
    case 'known':
      return STAGE_LABELS[status.known.stage];
    case 'failed':
      return `Could not check it right now: ${status.message}`;
    default:
      throw new Error(`Unknown entry status ${String(status satisfies never)}`);
  }
}

export function entryViews(state: ListState): EntryView[] {
  return state.entries.map(receipt => {
    const id = receiptId(receipt);
    const status = state.statuses[id];
    const known = status?.kind === 'known' ? status.known : null;
    return {
      id,
      receipt,
      summary: summaryOf(status),
      follow: known?.terminal !== true,
      reclaim: known?.reclaimable === true,
    };
  });
}
