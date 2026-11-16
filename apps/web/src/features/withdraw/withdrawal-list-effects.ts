import { type PastedWithdrawalCheck, type WithdrawalProgress, errorMessage } from '@satway/core';

import { type WithdrawalReceiptFile, withdrawalId } from '../../shared/index.js';
import type { KnownStatus } from './entry-statuses.js';
import type { ListEffect, ListEvent } from './withdrawal-list-state.js';

export interface ListIo {
  check(
    receipt: WithdrawalReceiptFile,
    stacksTxid: string,
    signal: AbortSignal
  ): Promise<WithdrawalProgress>;
  checkTxid(
    receipt: WithdrawalReceiptFile,
    txid: string,
    signal: AbortSignal
  ): Promise<PastedWithdrawalCheck>;
  read(file: Blob): Promise<string | null>;
  stored(receipt: WithdrawalReceiptFile): WithdrawalReceiptFile | null;
  rememberStatus(id: string, status: KnownStatus | null): void;
  remove(receipt: WithdrawalReceiptFile): void;
  follow(receipt: WithdrawalReceiptFile): void;
}

export interface ListFlow {
  dispatch(event: ListEvent): void;
  signal(request: number): AbortSignal;
}

export function listRunner(io: ListIo, flow: ListFlow): (effect: ListEffect) => void {
  async function check(effect: Extract<ListEffect, { type: 'check' }>) {
    const id = withdrawalId(effect.receipt);
    try {
      const progress = await io.check(
        effect.receipt,
        effect.stacksTxid,
        flow.signal(effect.request)
      );
      flow.dispatch({ type: 'checked', request: effect.request, id, progress });
    } catch (err) {
      flow.dispatch({
        type: 'check-failed',
        request: effect.request,
        id,
        message: errorMessage(err) ?? 'unknown error',
      });
    }
  }

  async function read(effect: Extract<ListEffect, { type: 'read' }>) {
    flow.dispatch({ type: 'file-read', request: effect.request, text: await io.read(effect.file) });
  }

  async function checkTxid(effect: Extract<ListEffect, { type: 'check-txid' }>) {
    try {
      const check = await io.checkTxid(effect.receipt, effect.txid, flow.signal(effect.request));
      flow.dispatch({ type: 'file-txid-checked', request: effect.request, check });
    } catch (err) {
      flow.dispatch({
        type: 'file-txid-check-failed',
        request: effect.request,
        message: errorMessage(err) ?? 'unknown error',
      });
    }
  }

  return effect => {
    switch (effect.type) {
      case 'check':
        void check(effect);
        return;
      case 'remember-status':
        io.rememberStatus(withdrawalId(effect.receipt), effect.status);
        return;
      case 'read':
        void read(effect);
        return;
      case 'resolve':
        flow.dispatch({
          type: 'file-resolved',
          request: effect.request,
          stored: io.stored(effect.receipt),
        });
        return;
      case 'check-txid':
        void checkTxid(effect);
        return;
      case 'follow':
        io.follow(effect.receipt);
        return;
      case 'remove':
        io.remove(effect.receipt);
        return;
      default:
        throw new Error(`Unknown list effect ${String(effect satisfies never)}`);
    }
  };
}
