import { useCallback, useEffect, useRef, useState } from 'react';

import { styled } from 'satway-styles/jsx';
import { actions, button, details, notice } from 'satway-styles/recipes';

import {
  type FoundDeposit,
  type ScanProgress,
  type WalletDeposits,
  MAINNET_CONFIG as config,
  errorMessage,
  fetchVerifiedSigners,
  findDepositsByReclaimKey,
  scanDepositAddresses,
} from '@satway/core';

import {
  type Snapshot,
  type WalletAccount,
  checkFoundDeposit,
  latestRequests,
} from '../../shared/index.js';
import { PayoutDetails, PayoutNotices } from '../../ui/index.js';
import { ReclaimForm } from './reclaim-form.js';

type Phase = 'idle' | 'asking' | 'scanning' | 'done';

export type Source = 'emily' | 'scan';

export type EmilyAnswer =
  | { kind: 'read'; result: WalletDeposits }
  | { kind: 'failed'; error: unknown };

export interface AfterEmily {
  found: FoundDeposit[];
  note: string | null;
  scan: boolean;
}

export const EMILY_KNOWS_NONE_NOTE =
  'The sBTC signers’ API knows no registered deposits for this wallet. A payment that was never registered is found only on Bitcoin, so this page checks your possible deposit addresses there one by one.';

export const EMILY_TRUNCATED_NOTE =
  'The sBTC signers’ API lists more deposits for this wallet than this page reads at once, so only part of them is shown. Check your addresses on Bitcoin to find the rest.';

export function afterEmily(answer: EmilyAnswer): AfterEmily {
  if (answer.kind === 'failed') {
    return {
      found: [],
      scan: true,
      note: `The sBTC signers’ API could not be reached (${errorMessage(answer.error) ?? String(answer.error)}), so this page checks your possible deposit addresses on Bitcoin one by one instead.`,
    };
  }
  const { deposits, truncated } = answer.result;
  if (deposits.length === 0 && !truncated) {
    return { found: [], scan: true, note: EMILY_KNOWS_NONE_NOTE };
  }
  return { found: deposits, scan: false, note: truncated ? EMILY_TRUNCATED_NOTE : null };
}

function foundHead(count: number, source: Source | null): string {
  const registered = source === 'emily' ? 'registered ' : '';
  if (count > 0) {
    return `Found ${countText(count, `${registered}deposit address`, `${registered}deposit addresses`)} for this wallet.`;
  }
  if (source === 'scan')
    return 'No deposits were found at your possible deposit addresses on Bitcoin.';
  return `No ${registered}deposits were found for this wallet.`;
}

export function foundText(count: number, source: Source | null, cancelled: boolean): string {
  const head = foundHead(count, source);
  if (cancelled) return `${head} Checking was stopped early, so the list may be incomplete.`;
  if (source === 'scan')
    return `${head} Deposits made while the sBTC signers used an earlier key are not found this way.`;
  return head;
}

function countText(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function foundLabel(d: FoundDeposit): string {
  const index = d.depositIndex === null ? '' : ` (index ${d.depositIndex})`;
  return `${d.depositAddress}${index}`;
}

export function FindDeposits(props: {
  account: WalletAccount | null;
  selected: FoundDeposit | null;
  onSelect(deposit: FoundDeposit): void;
}) {
  const { account } = props;
  const [phase, setPhase] = useState<Phase>('idle');
  const [source, setSource] = useState<Source | null>(null);
  const [found, setFound] = useState<FoundDeposit[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [requests] = useState(latestRequests);
  const abort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      requests.cancel();
      abort.current?.abort();
    },
    [requests]
  );

  async function scanAddresses(wallet: WalletAccount, isLatest: () => boolean) {
    const controller = new AbortController();
    abort.current = controller;
    setPhase('scanning');
    setScan({ checked: 0, found: 0, nextIndex: 0 });
    setCancelled(false);
    try {
      const signers = await fetchVerifiedSigners(config);
      const result = await scanDepositAddresses({
        config,
        owner: {
          stacksAddress: wallet.stacksAddress,
          reclaimPublicKey: wallet.reclaimPublicKey,
          signersPublicKey: signers.signersPublicKey,
        },
        signal: controller.signal,
        onProgress(p) {
          if (isLatest()) setScan(p);
        },
      });
      if (!isLatest()) return;
      setFound(result.deposits);
      setSource('scan');
      setCancelled(result.cancelled);
      setPhase('done');
    } catch (err) {
      if (!isLatest()) return;
      setError(
        `Could not check your deposit addresses on Bitcoin: ${errorMessage(err) ?? String(err)}. Try again in a few minutes.`
      );
      setPhase('idle');
    }
  }

  async function search() {
    if (!account) return;
    const isLatest = requests.begin();
    abort.current?.abort();
    setPhase('asking');
    setError(null);
    setNote(null);
    setFound([]);
    setSource(null);
    let answer: EmilyAnswer;
    try {
      answer = {
        kind: 'read',
        result: await findDepositsByReclaimKey(config, account.reclaimPublicKey),
      };
    } catch (error) {
      answer = { kind: 'failed', error };
    }
    if (!isLatest()) return;
    const next = afterEmily(answer);
    setNote(next.note);
    if (!next.scan) {
      setFound(next.found);
      setSource('emily');
      setPhase('done');
      return;
    }
    await scanAddresses(account, isLatest);
  }

  function scanInstead() {
    if (!account) return;
    const isLatest = requests.begin();
    setError(null);
    setNote(null);
    void scanAddresses(account, isLatest);
  }

  return (
    <>
      <styled.h3 textStyle="emphasis" marginTop="space.12" marginBottom="space.04">
        No receipt? Search with your wallet
      </styled.h3>
      <p className={notice()}>
        The connected wallet can find the deposits it made. This page asks the sBTC signers’ API for
        the registered deposits locked to your reclaim key, and if that API cannot be reached or
        knows none, it checks your possible deposit addresses on Bitcoin one by one.
      </p>
      <div className={actions()}>
        <button
          className={button()}
          disabled={!account || phase === 'asking' || phase === 'scanning'}
          onClick={() => void search()}
        >
          {phase === 'asking' ? 'Asking the sBTC signers’ API…' : 'Search with my wallet'}
        </button>
        {phase === 'done' && source === 'emily' && (
          <button className={button()} onClick={scanInstead}>
            Also check my addresses on Bitcoin
          </button>
        )}
      </div>
      {!account && <p className={notice()}>Connect the wallet that made the deposit to search.</p>}
      {note && (
        <p className={notice({ tone: 'warn' })} role="status">
          {note}
        </p>
      )}
      {error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {error}
        </p>
      )}
      {phase === 'scanning' && scan && (
        <div className={actions()}>
          <p className={notice({ tone: 'status' })} role="status">
            Checked{' '}
            {countText(scan.checked, 'possible deposit address', 'possible deposit addresses')},
            found {countText(scan.found, 'deposit', 'deposits')}.
          </p>
          <button className={button()} onClick={() => abort.current?.abort()}>
            Stop checking
          </button>
        </div>
      )}
      {phase === 'done' && (
        <p className={notice({ tone: 'status' })} role="status">
          {foundText(found.length, source, cancelled)}
        </p>
      )}
      {found.length > 0 && (
        <ul aria-label="Found with your wallet">
          {found.map(d => (
            <li key={d.depositAddress}>
              <button
                className={button({
                  variant:
                    props.selected?.depositAddress === d.depositAddress ? 'primary' : undefined,
                })}
                onClick={() => props.onSelect(d)}
              >
                Check {foundLabel(d)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function FoundDepositView(props: {
  deposit: FoundDeposit;
  account: WalletAccount | null;
  signReclaim(psbtHex: string, account: WalletAccount): Promise<Uint8Array>;
}) {
  const { deposit } = props;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests] = useState(latestRequests);

  const refresh = useCallback(async () => {
    const isLatest = requests.begin();
    setError(null);
    try {
      const next = await checkFoundDeposit(config, deposit);
      if (isLatest()) setSnapshot(next);
    } catch (err) {
      if (isLatest()) setError(errorMessage(err) ?? null);
    }
  }, [deposit, requests]);

  useEffect(() => {
    void refresh();
    return () => requests.cancel();
  }, [refresh, requests]);

  return (
    <>
      <p className={notice({ tone: 'status' })} role="status">
        {snapshot?.progress.message ?? 'Checking…'}
      </p>
      {error && (
        <p className={notice({ tone: 'error' })} role="alert">
          {error}
        </p>
      )}
      <dl className={details()}>
        <dt>sBTC recipient</dt>
        <dd>
          <code>{deposit.stacksAddress}</code>
        </dd>
        <dt>Bitcoin deposit address</dt>
        <dd>
          <code>{deposit.depositAddress}</code>
        </dd>
        <dt>Signer fee cap</dt>
        <dd>{deposit.maxSignerFeeSats.toLocaleString('en-US')} sats</dd>
        {snapshot && <PayoutDetails snapshot={snapshot} />}
      </dl>
      {snapshot && <PayoutNotices snapshot={snapshot} />}
      {snapshot && (
        <ReclaimForm
          deposit={{ ...deposit, reclaimKeyAddress: null }}
          snapshot={snapshot}
          stage={snapshot.progress.stage}
          account={props.account}
          signReclaim={props.signReclaim}
          onSent={refresh}
        />
      )}
    </>
  );
}
