import { useEffect, useRef, useState } from 'react';

import { styled } from 'satway-styles/jsx';
import { actions, button, field, notice, sheet } from 'satway-styles/recipes';

import {
  checkPastedWithdrawalTransaction,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
} from '@satway/core';

import {
  type Backend,
  type WithdrawalReceiptFile,
  abortableFetch,
  activeWithdrawal,
  checkWithdrawal,
  emptyListNote,
  forgetWithdrawal,
  loadWithdrawals,
  localStorageWorks,
  useFlow,
  withdrawalId,
} from '../../shared/index.js';
import { abortableStatus } from './abortable.js';
import { loadKnownStatuses, rememberKnownStatus } from './entry-statuses.js';
import { storedWithdrawal } from './stored-withdrawal.js';
import { type ListIo, listRunner } from './withdrawal-list-effects.js';
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

function browserListIo(backend: Backend, follow: (receipt: WithdrawalReceiptFile) => void): ListIo {
  return {
    async check(receipt, stacksTxid, signal) {
      const snapshot = await checkWithdrawal(
        config,
        abortableStatus(backend, signal),
        receipt,
        stacksTxid,
        abortableFetch(signal)
      );
      return snapshot.observation.progress;
    },
    checkTxid(receipt, txid, signal) {
      return checkPastedWithdrawalTransaction(
        config,
        txid,
        {
          sender: receipt.sender,
          amountSats: receipt.amountSats,
          maxFeeSats: receipt.maxFeeSats,
          recipient: receipt.recipient,
        },
        abortableFetch(signal)
      );
    },
    read: textOf,
    stored: storedWithdrawal,
    rememberStatus: rememberKnownStatus,
    remove(receipt) {
      const active = activeWithdrawal(config);
      if (active !== null && withdrawalId(active) === withdrawalId(receipt)) return;
      forgetWithdrawal(config, receipt);
    },
    follow,
  };
}

export function WithdrawalList(props: {
  backend: Backend;
  onFollow(receipt: WithdrawalReceiptFile): void;
  onLoaded(receipt: WithdrawalReceiptFile): void;
}) {
  const { backend } = props;
  const [storageWorks] = useState(localStorageWorks);
  const flow = useFlow(
    listMachine,
    () => initialList(loadWithdrawals(config), loadKnownStatuses()),
    run
  );
  const { dispatch } = flow;
  const { entries, statuses, file, removal } = flow.state;

  function run(effect: ListEffect) {
    listRunner(browserListIo(backend, props.onLoaded), flow)(effect);
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
        <p className={notice()}>{emptyListNote('withdrawals', storageWorks)}</p>
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
                        {status.checkLabel}
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
