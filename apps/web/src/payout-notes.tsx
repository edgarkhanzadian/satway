import { notice } from 'portage-styles/recipes';

import { type AddressOutput, type EmilyDepositStatus, outpointOf } from '@portage/core';

import type { Snapshot } from './flow.js';

function sats(n: number): string {
  return `${n.toLocaleString('en-US')} sats`;
}

function otherNote(output: AddressOutput, mint: EmilyDepositStatus | null): string {
  if (output.spent) return 'It has already been spent.';
  if (mint === null) return 'It is not registered with the sBTC signers.';
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
      {snapshot.registrationErrors.map(e => (
        <p key={e.outpoint} className={notice({ tone: 'error' })} role="alert">
          Could not register <code>{e.outpoint}</code> with the sBTC signers: {e.message}
        </p>
      ))}
    </>
  );
}
