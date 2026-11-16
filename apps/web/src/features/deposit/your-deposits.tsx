import { useEffect } from 'react';

import { css } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { actions, button, field, notice, sheet } from 'satway-styles/recipes';

import { MAINNET_CONFIG as config, errorMessage } from '@satway/core';

import {
  type Backend,
  type Receipt,
  type WalletAccount,
  abortableFetch,
  checkProgress,
  loadReceipts,
  receiptId,
  sendAmountOf,
  sendAmountText,
  useFlow,
} from '../../shared/index.js';
import type { RouteUpdate } from '../../ui/index.js';
import { type ListEffect, entryViews, initialList, listMachine } from './deposit-list-state.js';
import { loadStages, rememberStage } from './deposit-stages.js';
import { FindDeposits, FoundDepositView } from './find-deposits.js';
import { ReceiptDetails } from './receipt-details.js';

const fields = field();

const entries = css({ listStyleType: 'none', padding: 'space.00', margin: 'space.00' });
const entry = css({
  paddingBlock: 'space.08',
  borderTopWidth: 'hairline',
  borderTopStyle: 'solid',
  borderTopColor: 'hairline',
});
const entryLabel = css({ margin: 'space.00', textStyle: 'emphasis' });
const entrySummary = css({ marginBlock: 'space.02', color: 'muted', fontSize: 'sm' });

export function entryLabelOf(receipt: Receipt): string {
  return `${sendAmountText(sendAmountOf(receipt), receipt.origin.symbol)}, started ${new Date(receipt.createdAt).toLocaleString()}`;
}

export function YourDeposits(props: {
  backend: Backend;
  account: WalletAccount | null;
  signReclaim(psbtHex: string, account: WalletAccount): Promise<Uint8Array>;
  onFollow(receipt: Receipt): void;
  onRoute(route: RouteUpdate | null): void;
}) {
  const { backend, account, onRoute } = props;
  const flow = useFlow(listMachine, () => initialList(loadReceipts(), loadStages()), run);
  const { state, dispatch } = flow;

  async function check(effect: Extract<ListEffect, { type: 'check-entry' | 'check-receipt' }>) {
    try {
      const snapshot = await checkProgress(
        config,
        backend,
        effect.receipt,
        abortableFetch(flow.signal(effect.request))
      );
      if (effect.type === 'check-entry') {
        dispatch({ type: 'entry-checked', request: effect.request, id: effect.id, snapshot });
      } else {
        dispatch({ type: 'receipt-checked', request: effect.request, snapshot });
      }
    } catch (err) {
      if (effect.type === 'check-entry') {
        dispatch({
          type: 'entry-check-failed',
          request: effect.request,
          id: effect.id,
          message: errorMessage(err) ?? 'unknown error',
        });
      } else {
        dispatch({
          type: 'receipt-check-failed',
          request: effect.request,
          message: errorMessage(err) ?? null,
        });
      }
    }
  }

  async function readFile(effect: Extract<ListEffect, { type: 'read-file' }>) {
    let text: string | null;
    try {
      text = await effect.file.text();
    } catch {
      text = null;
    }
    dispatch({ type: 'file-read', request: effect.request, text });
  }

  function run(effect: ListEffect) {
    switch (effect.type) {
      case 'check-entry':
      case 'check-receipt':
        void check(effect);
        return;
      case 'remember-stage':
        rememberStage(effect.id, effect.known);
        return;
      case 'read-file':
        void readFile(effect);
        return;
      default:
        throw new Error(`Unknown list effect ${String(effect satisfies never)}`);
    }
  }

  useEffect(() => {
    dispatch({ type: 'shown' });
  }, [dispatch]);

  const views = entryViews(state);
  const routed = state.opened.kind === 'receipt' ? state.opened.receipt : null;
  const routedStage =
    state.opened.kind === 'receipt' && state.opened.check.kind !== 'checking'
      ? state.opened.check.snapshot.progress.stage
      : null;
  useEffect(() => {
    onRoute(
      routed
        ? {
            origin: `${routed.origin.symbol} on ${routed.origin.chain}`,
            deposit: { stage: routedStage },
          }
        : null
    );
  }, [onRoute, routed, routedStage]);
  useEffect(() => () => onRoute(null), [onRoute]);

  const opened = state.opened;
  const openedReceipt = opened.kind === 'receipt' ? opened : null;
  const snapshot =
    openedReceipt === null || openedReceipt.check.kind === 'checking'
      ? null
      : openedReceipt.check.snapshot;

  function details(source: 'saved' | 'file', id: string | null) {
    if (openedReceipt === null || openedReceipt.source !== source) return null;
    if (id !== null && receiptId(openedReceipt.receipt) !== id) return null;
    return (
      <ReceiptDetails
        receipt={openedReceipt.receipt}
        snapshot={snapshot}
        reclaim={openedReceipt.reclaim}
        account={account}
        signReclaim={props.signReclaim}
        onFollow={props.onFollow}
        onRefresh={() => {
          dispatch({ type: 'refresh-requested' });
          return Promise.resolve();
        }}
      />
    );
  }

  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        Your deposits
      </styled.h2>
      {views.length === 0 ? (
        <p className={notice()}>This browser does not remember any deposits yet.</p>
      ) : (
        <ul className={entries} aria-label="Your deposits">
          {views.map(view => (
            <li key={view.id} className={entry}>
              <p className={entryLabel}>{entryLabelOf(view.receipt)}</p>
              <p className={entrySummary}>{view.summary}</p>
              <div className={actions()}>
                {view.follow && (
                  <button
                    className={button({ variant: 'primary' })}
                    onClick={() => props.onFollow(view.receipt)}
                  >
                    Follow
                  </button>
                )}
                {view.reclaim && (
                  <button
                    className={button()}
                    onClick={() => dispatch({ type: 'details-opened', id: view.id, reclaim: true })}
                  >
                    Reclaim
                  </button>
                )}
                <button
                  className={button()}
                  onClick={() => dispatch({ type: 'details-opened', id: view.id, reclaim: false })}
                >
                  Show details
                </button>
                {view.check && (
                  <button
                    className={button()}
                    onClick={() => dispatch({ type: 'check-requested', id: view.id })}
                  >
                    Check again
                  </button>
                )}
              </div>
              {details('saved', view.id)}
            </li>
          ))}
        </ul>
      )}

      <styled.h3 textStyle="emphasis" marginTop="space.12" marginBottom="space.04">
        Load a receipt file
      </styled.h3>
      <p className={notice()}>
        Load the receipt file you downloaded when you started the deposit. Nothing is uploaded; it
        is read in your browser.
      </p>
      <label className={fields.label}>
        Receipt file
        <input
          className={fields.control}
          type="file"
          accept="application/json,.json"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) dispatch({ type: 'file-chosen', file });
          }}
        />
      </label>
      {state.error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {state.error}
        </p>
      )}
      {details('file', null)}

      <FindDeposits
        account={account}
        selected={opened.kind === 'found' ? opened.deposit : null}
        onSelect={deposit => dispatch({ type: 'found-picked', deposit })}
      />
      {opened.kind === 'found' && (
        <FoundDepositView
          key={opened.deposit.depositAddress}
          deposit={opened.deposit}
          account={account}
          signReclaim={props.signReclaim}
        />
      )}
    </section>
  );
}
