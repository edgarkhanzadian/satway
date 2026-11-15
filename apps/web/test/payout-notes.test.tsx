import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import type { AddressOutput } from '@portage/core';

import type { RegistrationErrorNote, Snapshot } from '../src/flow.js';
import { RegistrationNotices, registrationNoticeGroups } from '../src/payout-notes.js';
import { WALLET_PROMPT_WINDOW_MS } from '../src/send-attempt.js';
import { SendRecordView } from '../src/send-record-view.js';
import type { SendRecord } from '../src/send-record.js';

const TXID = 'a'.repeat(64);
const PAYOUT: AddressOutput = {
  txid: TXID,
  vout: 0,
  amountSats: 35_500,
  confirmed: true,
  blockHeight: 900_000,
  blockTime: null,
  spent: false,
};
const OUT = `${TXID}:0`;
const OTHER = `${'b'.repeat(64)}:1`;

function note(kind: RegistrationErrorNote['kind'], outpoint = OUT): RegistrationErrorNote {
  return {
    outpoint,
    kind,
    status: kind === 'rejected' ? 400 : 503,
    message: kind === 'rejected' ? 'HTTP 400 from emily: bad deposit' : 'HTTP 503 from emily: down',
  };
}

type Notes = Pick<Snapshot, 'payout' | 'candidates' | 'registrationErrors'>;

function html(snapshot: Notes): string {
  return renderToStaticMarkup(<RegistrationNotices snapshot={snapshot} />);
}

describe('registration notices', () => {
  it('shows nothing when registration succeeded or was not needed', () => {
    expect(html({ payout: PAYOUT, candidates: [], registrationErrors: [] })).toBe('');
    expect(html({ payout: null, candidates: [], registrationErrors: [] })).toBe('');
  });

  it('says a transient failure is being retried', () => {
    const out = html({ payout: PAYOUT, candidates: [], registrationErrors: [note('transient')] });
    expect(out).toContain('have not been told about your Bitcoin payment yet');
    expect(out).toContain('This page keeps retrying.');
    expect(out).not.toContain('reclaimed after the timelock');
  });

  it('explains a rejection, that the BTC is safe and how to retry later', () => {
    const out = html({ payout: PAYOUT, candidates: [], registrationErrors: [note('rejected')] });
    expect(out).toContain('they refused the registration');
    expect(out).toContain('bad deposit');
    expect(out).toContain('Your BTC is safe at the deposit address');
    expect(out).toContain('reclaimed after the timelock');
    expect(out).toContain('loading the receipt again later retries');
    expect(out).not.toContain('This page keeps retrying.');
  });

  it('counts candidates as the payout and keeps other outputs apart', () => {
    const groups = registrationNoticeGroups({
      payout: null,
      candidates: [PAYOUT],
      registrationErrors: [note('rejected'), note('transient', OTHER)],
    });
    expect(groups.rejected.map(e => e.outpoint)).toEqual([OUT]);
    expect(groups.transient).toEqual([]);
    expect(groups.others.map(e => e.outpoint)).toEqual([OTHER]);
    const out = html({
      payout: null,
      candidates: [],
      registrationErrors: [note('transient', OTHER)],
    });
    expect(out).toContain('Other payments to this address could not be registered');
    expect(out).not.toContain('have not been told');
  });
});

describe('SendRecordView', () => {
  const SIG =
    '4QMdVtgtZcuygfB7RnGhZvrPxVDjXU7WgaKCaYEd2XSeQYMGKSrthoiV4GmL6pq2fu5gHaoiHofNEYTNSJuryyr';
  const base = {
    version: 1 as const,
    swap: { address: 'x', memo: null },
    account: 'a',
    startedAt: '2026-11-15T10:00:00.000Z',
  };

  const STARTED = Date.parse(base.startedAt);

  function view(record: SendRecord, now = new Date(STARTED + WALLET_PROMPT_WINDOW_MS)): string {
    return renderToStaticMarkup(
      <SendRecordView
        record={record}
        note={null}
        resending={false}
        now={now}
        onResend={() => undefined}
        onConfirmNothingSent={() => undefined}
      />
    );
  }

  const attempting: SendRecord = { ...base, state: 'attempting', family: 'evm', signed: null };
  const CONFIRM = 'I checked my wallet and nothing was sent. Let me try again';

  it.each([
    ['seconds old', 5_000],
    ['just under the window', WALLET_PROMPT_WINDOW_MS - 1],
  ])(
    'hides the confirmation for an attempt %s, while the wallet may still be asking',
    (_n, age) => {
      const out = view(attempting, new Date(STARTED + age));
      expect(out).not.toContain(CONFIRM);
      expect(out).not.toContain('<button');
      expect(out).toContain('The request may still be open in your wallet');
    }
  );

  it('shows the confirmation once the wallet request window has passed', () => {
    const out = view(attempting, new Date(STARTED + WALLET_PROMPT_WINDOW_MS));
    expect(out).toContain(CONFIRM);
    expect(out).not.toContain('The request may still be open in your wallet');
  });

  it('does not hold back the confirmation for an uncertain record, whatever its age', () => {
    const out = view(
      { ...base, state: 'uncertain', family: 'evm', tx: null, message: 'x', signed: null },
      new Date(STARTED + 1_000)
    );
    expect(out).toContain(CONFIRM);
  });

  it('tells the user not to send again once sent', () => {
    const out = view({
      ...base,
      state: 'sent',
      family: 'evm',
      tx: `0x${'ab'.repeat(32)}`,
      via: 'wallet',
    });
    expect(out).toContain('Do not send again.');
    expect(out).not.toContain('<button');
  });

  it('offers only the confirmation when nothing can be proven', () => {
    const out = view({
      ...base,
      state: 'uncertain',
      family: 'evm',
      tx: null,
      message: 'Request expired',
      signed: null,
    });
    expect(out).toContain('Check your wallet’s activity');
    expect(out).toContain('I checked my wallet and nothing was sent. Let me try again');
    expect(out).not.toContain('Send the same signed transaction again');
  });

  it('offers to resend the same signed Solana transaction and shows its signature', () => {
    const out = view({
      ...base,
      state: 'uncertain',
      family: 'solana',
      tx: SIG,
      message: 'Solana did not confirm',
      signed: { signature: SIG, transaction: 'AQ==', lastValidBlockHeight: '5' },
    });
    expect(out).toContain(SIG);
    expect(out).toContain('Send the same signed transaction again');
    expect(out).not.toContain('I checked my wallet');
  });
});
