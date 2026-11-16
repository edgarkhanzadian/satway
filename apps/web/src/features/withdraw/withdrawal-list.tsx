import { useEffect, useRef } from 'react';

import { styled } from 'satway-styles/jsx';
import { actions, button, field, notice, sheet } from 'satway-styles/recipes';

import {
  checkPastedWithdrawalTransaction,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
  errorMessage,
} from '@satway/core';

import {
  type Backend,
  type WithdrawalReceiptFile,
  activeWithdrawal,
  checkWithdrawal,
  forgetWithdrawal,
  loadWithdrawals,
  useFlow,
  withdrawalId,
} from '../../shared/index.js';
import { abortableFetch, abortableStatus } from './abortable.js';
import { loadKnownStatuses, rememberKnownStatus } from './entry-statuses.js';
import { storedWithdrawal } from './stored-withdrawal.js';
import {
  type ListEffect,
  type ListEvent,
  type Removal,
  entryLabel,
  entryStatusView,
  initialList,
  listMachine,
} from './withdrawal-list-state.js';

const fields = field();

async function textOf(file: Blob): Promise<string | null> {
  try {
    return await file.text();
  } catch {
    return null;
  }
}

export function WithdrawalList(props: {
  backend: Backend;
  onFollow(receipt: WithdrawalReceiptFile): void;
  onLoaded(receipt: WithdrawalReceiptFile): void;
}) {
  const { backend } = props;
  const flow = useFlow(
    listMachine,
    () => initialList(loadWithdrawals(config), loadKnownStatuses()),
    run
  );
  const { dispatch } = flow;
  const { entries, statuses, file, removal } = flow.state;

  async function check(effect: Extract<ListEffect, { type: 'check' }>) {
    const id = withdrawalId(effect.receipt);
    const signal = flow.signal(effect.request);
    try {
      const snapshot = await checkWithdrawal(
        config,
        abortableStatus(backend, signal),
        effect.receipt,
        effect.stacksTxid,
        abortableFetch(signal)
      );
      dispatch({
        type: 'checked',
        request: effect.request,
        id,
        progress: snapshot.observation.progress,
      });
    } catch (err) {
      dispatch({
        type: 'check-failed',
        request: effect.request,
        id,
        message: errorMessage(err) ?? 'unknown error',
      });
    }
  }

  async function read(effect: Extract<ListEffect, { type: 'read' }>) {
    dispatch({ type: 'file-read', request: effect.request, text: await textOf(effect.file) });
  }

  async function checkTxid(effect: Extract<ListEffect, { type: 'check-txid' }>) {
    const signal = flow.signal(effect.request);
    try {
      const result = await checkPastedWithdrawalTransaction(
        config,
        effect.txid,
        {
          sender: effect.receipt.sender,
          amountSats: effect.receipt.amountSats,
          maxFeeSats: effect.receipt.maxFeeSats,
          recipient: effect.receipt.recipient,
        },
        abortableFetch(signal)
      );
      dispatch({ type: 'file-txid-checked', request: effect.request, check: result });
    } catch (err) {
      dispatch({
        type: 'file-txid-check-failed',
        request: effect.request,
        message: errorMessage(err) ?? 'unknown error',
      });
    }
  }

  function remove(receipt: WithdrawalReceiptFile) {
    const active = activeWithdrawal(config);
    if (active !== null && withdrawalId(active) === withdrawalId(receipt)) return;
    forgetWithdrawal(config, receipt);
  }

  function run(effect: ListEffect) {
    switch (effect.type) {
      case 'check':
        void check(effect);
        return;
      case 'remember-status':
        rememberKnownStatus(withdrawalId(effect.receipt), effect.status);
        return;
      case 'read':
        void read(effect);
        return;
      case 'resolve':
        dispatch({
          type: 'file-resolved',
          request: effect.request,
          stored: storedWithdrawal(effect.receipt),
        });
        return;
      case 'check-txid':
        void checkTxid(effect);
        return;
      case 'follow':
        props.onLoaded(effect.receipt);
        return;
      case 'remove':
        remove(effect.receipt);
        return;
      default:
        throw new Error(`Unknown list effect ${String(effect satisfies never)}`);
    }
  }

  useEffect(() => {
    dispatch({ type: 'opened' });
  }, [dispatch]);

  const loading = file.kind === 'reading' || file.kind === 'resolving' || file.kind === 'verifying';

  return (
    <section className={sheet()} aria-labelledby="your-withdrawals-title">
      <styled.h2 id="your-withdrawals-title" textStyle="heading" marginBottom="space.06">
        Your withdrawals
      </styled.h2>
      {entries.length === 0 ? (
        <p className={notice()}>This browser does not remember any withdrawals.</p>
      ) : (
        <styled.ul
          aria-labelledby="your-withdrawals-title"
          listStyleType="none"
          margin="space.00"
          paddingLeft="space.00"
        >
          {entries.map(r => {
            const id = withdrawalId(r);
            const status = entryStatusView(statuses[id]);
            const labelId = `withdrawal-${id}`;
            return (
              <styled.li
                key={id}
                aria-labelledby={labelId}
                paddingBlock="space.06"
                borderTopWidth="hairline"
                borderTopStyle="solid"
                borderTopColor="hairline"
              >
                <styled.p id={labelId} margin="space.00" fontWeight="medium">
                  {entryLabel(r)}
                </styled.p>
                <p className={notice({ tone: status.warning ? 'warn' : 'status' })}>
                  {status.message}
                </p>
                {removal?.id === id ? (
                  <ConfirmRemoval
                    removal={removal}
                    final={status.final}
                    labelId={labelId}
                    dispatch={dispatch}
                  />
                ) : (
                  <div className={actions()}>
                    <button
                      className={button()}
                      aria-describedby={labelId}
                      onClick={() => props.onFollow(r)}
                    >
                      Follow
                    </button>
                    {status.checkable && (
                      <button
                        className={button()}
                        aria-describedby={labelId}
                        onClick={() => dispatch({ type: 'check-requested', id })}
                      >
                        Check
                      </button>
                    )}
                    <button
                      className={button()}
                      aria-describedby={labelId}
                      onClick={() => dispatch({ type: 'remove-requested', id })}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </styled.li>
            );
          })}
        </styled.ul>
      )}

      <styled.h3 textStyle="emphasis" marginTop="space.10" marginBottom="space.04">
        Load a receipt file
      </styled.h3>
      <p className={notice()}>
        Load the withdrawal receipt file that was downloaded when you signed. It is read in your
        browser and not uploaded, and it is followed here once it checks out.
      </p>
      <label className={fields.label}>
        Withdrawal receipt (JSON)
        <input
          className={fields.control}
          type="file"
          accept="application/json,.json"
          aria-busy={loading}
          onChange={e => {
            const chosen = e.target.files?.[0];
            if (chosen) dispatch({ type: 'file-chosen', file: chosen });
          }}
        />
      </label>
      {loading && (
        <p className={notice({ tone: 'status' })} role="status">
          Checking the receipt…
        </p>
      )}
      {file.kind === 'failed' && (
        <p className={notice({ tone: 'error' })} role="alert">
          {file.message}
        </p>
      )}
    </section>
  );
}

function ConfirmRemoval(props: {
  removal: Removal;
  final: boolean;
  labelId: string;
  dispatch(event: ListEvent): void;
}) {
  const { removal, final, dispatch } = props;
  const promptRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    promptRef.current?.focus();
  }, [removal.stage]);

  function prompt(): string {
    if (removal.stage === 'confirm-again') {
      return 'Remove it anyway? Only the receipt file can bring it back here, so keep that file.';
    }
    return final
      ? 'Remove this withdrawal from this browser? The receipt file is not affected.'
      : 'This withdrawal may not be finished. If you remove it, this browser stops listing it; keep the receipt file to follow it later.';
  }

  return (
    <>
      <styled.p
        ref={promptRef}
        tabIndex={-1}
        className={notice({ tone: final ? 'status' : 'warn' })}
      >
        {prompt()}
      </styled.p>
      <div className={actions()}>
        <button
          className={button()}
          aria-describedby={props.labelId}
          onClick={() => dispatch({ type: 'remove-confirmed', id: removal.id })}
        >
          {removal.stage === 'confirm-again' || final ? 'Remove it' : 'Remove anyway'}
        </button>
        <button className={button()} onClick={() => dispatch({ type: 'remove-cancelled' })}>
          Keep it
        </button>
      </div>
    </>
  );
}
