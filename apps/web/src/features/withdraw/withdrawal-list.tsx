import { useEffect } from 'react';

import { styled } from 'satway-styles/jsx';
import { actions, button, field, notice, sheet } from 'satway-styles/recipes';

import { MAINNET_WITHDRAWAL_FLOW_CONFIG as config, errorMessage } from '@satway/core';

import {
  type Backend,
  type WithdrawalReceiptFile,
  checkWithdrawal,
  loadWithdrawals,
  useFlow,
  withdrawalId,
} from '../../shared/index.js';
import {
  type ListEffect,
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
  const flow = useFlow(listMachine, () => initialList(loadWithdrawals(config)), run);
  const { dispatch } = flow;
  const { entries, statuses, file } = flow.state;

  async function check(effect: Extract<ListEffect, { type: 'check' }>) {
    const id = withdrawalId(effect.receipt);
    try {
      const snapshot = await checkWithdrawal(config, backend, effect.receipt, effect.stacksTxid);
      dispatch({ type: 'checked', id, progress: snapshot.observation.progress });
    } catch (err) {
      dispatch({ type: 'check-failed', id, message: errorMessage(err) ?? 'unknown error' });
    }
  }

  async function read(effect: Extract<ListEffect, { type: 'read' }>) {
    dispatch({ type: 'file-read', request: effect.request, text: await textOf(effect.file) });
  }

  function run(effect: ListEffect) {
    switch (effect.type) {
      case 'check':
        void check(effect);
        return;
      case 'read':
        void read(effect);
        return;
      case 'follow':
        props.onLoaded(effect.receipt);
        return;
      default:
        throw new Error(`Unknown list effect ${String(effect satisfies never)}`);
    }
  }

  useEffect(() => {
    dispatch({ type: 'opened' });
  }, [dispatch]);

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
                <div className={actions()}>
                  <button
                    className={button()}
                    aria-describedby={labelId}
                    onClick={() => props.onFollow(r)}
                  >
                    Follow
                  </button>
                </div>
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
          onChange={e => {
            const chosen = e.target.files?.[0];
            if (chosen) dispatch({ type: 'file-chosen', file: chosen });
          }}
        />
      </label>
      {file.kind === 'failed' && (
        <p className={notice({ tone: 'error' })} role="alert">
          {file.message}
        </p>
      )}
    </section>
  );
}
