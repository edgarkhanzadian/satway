import { notice } from 'satway-styles/recipes';

import {
  type AddressOutput,
  MINT_UNKNOWN,
  type MintStatus,
  SWAP_AWAITING_FUNDS,
  outpointOf,
} from '@satway/core';

import type { RegistrationErrorNote, Snapshot } from '../shared/index.js';

function sats(n: number): string {
  return `${n.toLocaleString('en-US')} sats`;
}

export function payoutNote(output: AddressOutput, mint: MintStatus): string {
  if (mint === 'confirmed') return 'sBTC has been minted for it.';
  if (output.spent) return 'It has already been spent.';
  if (mint === null) return 'It is not registered with the sBTC signers yet.';
  if (mint === MINT_UNKNOWN)
    return 'Whether it is registered with the sBTC signers is not known, because their API could not be reached.';
  return `It is registered with the sBTC signers (status: ${mint}).`;
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
  const [only] = snapshot.payouts;
  const early = snapshot.swap !== null && SWAP_AWAITING_FUNDS.has(snapshot.swap);
  if (early && snapshot.payouts.length > 0) {
    return (
      <>
        <dt>Paid to this address before your swap paid out</dt>
        {snapshot.payouts.map(o => (
          <dd key={outpointOf(o)}>
            {sats(o.amountSats)}
            <Where output={o} />. {payoutNote(o, snapshot.mints.get(outpointOf(o)) ?? null)}
          </dd>
        ))}
        <BelowMinimum snapshot={snapshot} />
      </>
    );
  }
  return (
    <>
      {only && snapshot.payouts.length === 1 && (
        <>
          <dt>Bitcoin payout</dt>
          <dd>
            {sats(only.amountSats)}
            <Where output={only} />
          </dd>
        </>
      )}
      {snapshot.payouts.length > 1 && (
        <>
          <dt>Bitcoin payouts</dt>
          {snapshot.payouts.map(o => (
            <dd key={outpointOf(o)}>
              {sats(o.amountSats)}
              <Where output={o} />. {payoutNote(o, snapshot.mints.get(outpointOf(o)) ?? null)}
            </dd>
          ))}
        </>
      )}
      <BelowMinimum snapshot={snapshot} />
    </>
  );
}

function BelowMinimum(props: { snapshot: Snapshot }) {
  const { snapshot } = props;
  if (snapshot.belowMinimum.length === 0) return null;
  return (
    <>
      <dt>Too small to mint</dt>
      {snapshot.belowMinimum.map(o => (
        <dd key={outpointOf(o)}>
          {sats(o.amountSats)}
          <Where output={o} />. Below the sBTC minimum, so it cannot be minted; it can be reclaimed
          after the timelock if it is worth more than the fee.
        </dd>
      ))}
    </>
  );
}

export function ForeignPayoutNotice(props: { snapshot: Pick<Snapshot, 'foreignTxids'> }) {
  if (props.snapshot.foreignTxids.length === 0) return null;
  return (
    <p className={notice({ tone: 'warn' })} role="status">
      The swap provider reports its Bitcoin payout in{' '}
      {props.snapshot.foreignTxids.map((txid, i) => (
        <span key={txid}>
          {i > 0 ? ' and ' : ''}transaction <code>{txid}</code>
        </span>
      ))}
      , which does not pay your deposit address. This page follows only payments to your deposit
      address. If none arrives, contact the swap provider with your swap deposit address.
    </p>
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
      <ForeignPayoutNotice snapshot={snapshot} />
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
  snapshot: Pick<Snapshot, 'payouts' | 'registrationErrors'>
): RegistrationNoticeGroups {
  const watched = new Set(snapshot.payouts.map(outpointOf));
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
  snapshot: Pick<Snapshot, 'payouts' | 'registrationErrors'>;
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
