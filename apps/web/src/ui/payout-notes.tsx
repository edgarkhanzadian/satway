import { notice } from 'satway-styles/recipes';

import { type AddressOutput, MINT_UNKNOWN, type MintStatus, outpointOf } from '@satway/core';

import type { RegistrationErrorNote, Snapshot } from '../shared/index.js';

function sats(n: number): string {
  return `${n.toLocaleString('en-US')} sats`;
}

export function otherNote(output: AddressOutput, mint: MintStatus): string {
  if (output.spent) return 'It has already been spent.';
  if (mint === null) return 'It is not registered with the sBTC signers.';
  if (mint === MINT_UNKNOWN)
    return 'Whether it is registered with the sBTC signers is not known, because their API could not be reached.';
  return `It is registered with the sBTC signers too (status: ${mint}).`;
}

function Where(props: { output: AddressOutput }) {
  return (
    <>
      {' '}
      in <code>{props.output.txid}</code>, output {props.output.vout}
    </>
  );
}

export function PayoutDetails(props: { snapshot: Snapshot }) {
  const { snapshot } = props;
  const payout = snapshot.payout;
  return (
    <>
      {payout && (
        <>
          <dt>Bitcoin payout</dt>
          <dd>
            {sats(payout.amountSats)}
            <Where output={payout} />
            {snapshot.basis === 'amount'
              ? '. Matched by its amount, because the swap provider has not reported its transaction yet.'
              : null}
          </dd>
        </>
      )}
      {snapshot.candidates.length > 0 && (
        <>
          <dt>Possible payouts</dt>
          {snapshot.candidates.map(o => (
            <dd key={outpointOf(o)}>
              {sats(o.amountSats)}
              <Where output={o} />
            </dd>
          ))}
        </>
      )}
      {snapshot.otherOutputs.length > 0 && (
        <>
          <dt>Other payments</dt>
          {snapshot.otherOutputs.map(o => (
            <dd key={outpointOf(o)}>
              Another payment of {sats(o.amountSats)} also arrived at this address
              <Where output={o} />. {otherNote(o, snapshot.mints.get(outpointOf(o)) ?? null)}
            </dd>
          ))}
        </>
      )}
      {snapshot.belowMinimum.length > 0 && (
        <>
          <dt>Too small to mint</dt>
          {snapshot.belowMinimum.map(o => (
            <dd key={outpointOf(o)}>
              {sats(o.amountSats)}
              <Where output={o} />. Below the sBTC minimum, so it cannot be minted; it can be
              reclaimed after the timelock if it is worth more than the fee.
            </dd>
          ))}
        </>
      )}
    </>
  );
}

export function PayoutNotices(props: { snapshot: Snapshot }) {
  const { snapshot } = props;
  return (
    <>
      {snapshot.truncated && (
        <p className={notice({ tone: 'warn' })}>
          This Bitcoin address has a long history, and only its most recent transactions were
          checked. Older payments may be missing from this page.
        </p>
      )}
      <MintUnknownNotice snapshot={snapshot} />
      <RegistrationNotices snapshot={snapshot} />
    </>
  );
}

export function MintUnknownNotice(props: { snapshot: Pick<Snapshot, 'mintUnknown'> }) {
  if (!props.snapshot.mintUnknown) return null;
  return (
    <p className={notice({ tone: 'warn' })} role="status">
      The sBTC signers’ API could not be reached, so this page cannot tell whether your Bitcoin
      payment has been registered or minted. Your BTC stays at the deposit address, and it can be
      reclaimed after the timelock if it is not minted. This does not mean the deposit failed.
    </p>
  );
}

export interface RegistrationNoticeGroups {
  rejected: RegistrationErrorNote[];
  transient: RegistrationErrorNote[];
  others: RegistrationErrorNote[];
}

export function registrationNoticeGroups(
  snapshot: Pick<Snapshot, 'payout' | 'candidates' | 'registrationErrors'>
): RegistrationNoticeGroups {
  const watched = new Set(
    [...(snapshot.payout ? [snapshot.payout] : []), ...snapshot.candidates].map(outpointOf)
  );
  const mine = snapshot.registrationErrors.filter(e => watched.has(e.outpoint));
  return {
    rejected: mine.filter(e => e.kind === 'rejected'),
    transient: mine.filter(e => e.kind === 'transient'),
    others: snapshot.registrationErrors.filter(e => !watched.has(e.outpoint)),
  };
}

function Reasons(props: { notes: RegistrationErrorNote[] }) {
  return (
    <>
      {props.notes.map(e => (
        <span key={e.outpoint}>
          {' '}
          <code>{e.outpoint}</code>: {e.message}
        </span>
      ))}
    </>
  );
}

export function RegistrationNotices(props: {
  snapshot: Pick<Snapshot, 'payout' | 'candidates' | 'registrationErrors'>;
}) {
  const groups = registrationNoticeGroups(props.snapshot);
  return (
    <>
      {groups.rejected.length > 0 && (
        <p className={notice({ tone: 'error' })} role="alert">
          The sBTC signers have not been told about your Bitcoin payment yet: they refused the
          registration. Reason:
          <Reasons notes={groups.rejected} />. Your BTC is safe at the deposit address and can be
          reclaimed after the timelock. This page keeps trying while it is open, and loading the
          receipt again later retries.
        </p>
      )}
      {groups.rejected.length === 0 && groups.transient.length > 0 && (
        <p className={notice({ tone: 'warn' })} role="status">
          The sBTC signers have not been told about your Bitcoin payment yet, because their service
          could not be reached. This page keeps retrying.
          <Reasons notes={groups.transient} />
        </p>
      )}
      {groups.others.length > 0 && (
        <p className={notice()}>
          Other payments to this address could not be registered with the sBTC signers yet.
          <Reasons notes={groups.others} />
        </p>
      )}
    </>
  );
}
