import { useCallback, useEffect, useRef, useState } from 'react';

import { styled } from 'satway-styles/jsx';
import { actions, button, details, notice } from 'satway-styles/recipes';

import {
  type FoundDeposit,
  type ScanProgress,
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

type Source = 'emily' | 'scan';

function countText(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function foundLabel(d: FoundDeposit): string {
  const index = d.depositIndex === null ? '' : ` (deposit ${d.depositIndex})`;
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
    try {
      const result = await findDepositsByReclaimKey(config, account.reclaimPublicKey);
      if (!isLatest()) return;
      setFound(result.deposits);
      setSource('emily');
      setNote(
        result.truncated
          ? 'The sBTC signers’ API lists more deposits for this wallet than this page reads at once, so only part of them is shown. Check your addresses on Bitcoin to find the rest.'
          : null
      );
      setPhase('done');
      return;
    } catch (err) {
      if (!isLatest()) return;
      setNote(
        `The sBTC signers’ API could not be reached (${errorMessage(err) ?? String(err)}), so this page checks your possible deposit addresses on Bitcoin one by one instead.`
      );
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
        No receipt? Find deposits with your wallet
      </styled.h3>
      <p className={notice()}>
        The connected wallet can find the deposits it made. This page asks the sBTC signers’ API for
        the deposits locked to your reclaim key, and if that API cannot be reached, it checks your
        possible deposit addresses on Bitcoin one by one.
      </p>
      <div className={actions()}>
        <button
          className={button()}
          disabled={!account || phase === 'asking' || phase === 'scanning'}
          onClick={() => void search()}
        >
          {phase === 'asking' ? 'Asking the sBTC signers’ API…' : 'Find my deposits'}
        </button>
        {phase === 'done' && source === 'emily' && (
          <button className={button()} onClick={scanInstead}>
            Check my deposit addresses on Bitcoin
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
          {found.length === 0
            ? 'No deposits were found for this wallet.'
            : `Found ${countText(found.length, 'deposit address', 'deposit addresses')} for this wallet.`}
          {cancelled && ' Checking was stopped early, so the list may be incomplete.'}
          {!cancelled &&
            source === 'scan' &&
            ' Deposits made while the sBTC signers used an earlier key are not found this way.'}
        </p>
      )}
      {found.length > 0 && (
        <ul aria-label="Deposits found">
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
