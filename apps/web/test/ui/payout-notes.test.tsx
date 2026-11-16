import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { type SendRecord, WALLET_PROMPT_WINDOW_MS } from '@satway/chains';
import type { AddressOutput } from '@satway/core';

import type { RegistrationErrorNote, Snapshot } from '../../src/shared/progress.js';
import {
  ForeignPayoutNotice,
  MintUnknownNotice,
  PayoutDetails,
  RegistrationNotices,
  payoutNote,
  registrationNoticeGroups,
} from '../../src/ui/payout-notes.js';
import { SendRecordView } from '../../src/ui/send-record-view.js';

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
const EMPTY: Snapshot = {
  progress: {
    stage: 'minting',
    message: 'm.',
    terminal: false,
    needsNotification: false,
    blocksUntilReclaim: null,
  },
  swap: null,
  payouts: [],
  belowMinimum: [],
  foreignTxids: [],
  outputs: [],
  mints: new Map(),
  mintUnknown: false,
  tipHeight: null,
  truncated: false,
  registrationError: null,
  registrationErrors: [],
  remaining: null,
  refund: null,
};
const OTHER = `${'b'.repeat(64)}:1`;

function note(kind: RegistrationErrorNote['kind'], outpoint = OUT): RegistrationErrorNote {
  return {
    outpoint,
    kind,
    status: kind === 'rejected' ? 400 : 503,
    message: kind === 'rejected' ? 'HTTP 400 from emily: bad deposit' : 'HTTP 503 from emily: down',
  };
}

type Notes = Pick<Snapshot, 'payouts' | 'registrationErrors'>;

function html(snapshot: Notes): string {
  return renderToStaticMarkup(<RegistrationNotices snapshot={snapshot} />);
}

describe('registration notices', () => {
  it('shows nothing when registration succeeded or was not needed', () => {
    expect(html({ payouts: [PAYOUT], registrationErrors: [] })).toBe('');
    expect(html({ payouts: [], registrationErrors: [] })).toBe('');
  });

  it('says a transient failure is being retried', () => {
    const out = html({ payouts: [PAYOUT], registrationErrors: [note('transient')] });
    expect(out).toContain('have not been told about your Bitcoin payment yet');
    expect(out).toContain('This page keeps retrying.');
    expect(out).not.toContain('reclaimed after the timelock');
  });

  it('explains a rejection, that the BTC is safe and how to retry later', () => {
    const out = html({ payouts: [PAYOUT], registrationErrors: [note('rejected')] });
    expect(out).toContain('they refused the registration');
    expect(out).toContain('bad deposit');
    expect(out).toContain('Your BTC is safe at the deposit address');
    expect(out).toContain('reclaimed after the timelock');
    expect(out).toContain('loading the receipt again later retries');
    expect(out).not.toContain('This page keeps retrying.');
  });

  it('counts every payout as the deposit and keeps other outputs apart', () => {
    const groups = registrationNoticeGroups({
      payouts: [PAYOUT],
      registrationErrors: [note('rejected'), note('transient', OTHER)],
    });
    expect(groups.rejected.map(e => e.outpoint)).toEqual([OUT]);
    expect(groups.transient).toEqual([]);
    expect(groups.others.map(e => e.outpoint)).toEqual([OTHER]);
    const out = html({
      payouts: [],
      registrationErrors: [note('transient', OTHER)],
    });
    expect(out).toContain('Other payments to this address could not be registered');
    expect(out).not.toContain('have not been told');
  });
});

describe('mint status notes', () => {
  it('says the signers’ API could not be reached, and not that the deposit failed', () => {
    const out = renderToStaticMarkup(<MintUnknownNotice snapshot={{ mintUnknown: true }} />);
    expect(out).toContain('could not be reached');
    expect(out).not.toMatch(/never processed|rejected/);
    expect(out).toContain('This does not mean the deposit failed.');
    expect(renderToStaticMarkup(<MintUnknownNotice snapshot={{ mintUnknown: false }} />)).toBe('');
  });

  it('describes each payment by its mint status without calling an unknown one unregistered', () => {
    expect(payoutNote(PAYOUT, 'unknown')).toMatch(/not known/);
    expect(payoutNote(PAYOUT, null)).toBe('It is not registered with the sBTC signers yet.');
    expect(payoutNote({ ...PAYOUT, spent: true }, 'confirmed')).toBe(
      'sBTC has been minted for it.'
    );
    expect(payoutNote({ ...PAYOUT, spent: true }, 'accepted')).toBe('It has already been spent.');
    expect(payoutNote(PAYOUT, 'pending')).toMatch(/status: pending/);
  });

  it('warns about a payout transaction that does not pay the deposit address', () => {
    const out = renderToStaticMarkup(<ForeignPayoutNotice snapshot={{ foreignTxids: [TXID] }} />);
    expect(out).toContain(TXID);
    expect(out).toContain('which does not pay your deposit address');
    expect(out).toContain('contact the swap provider');
    expect(renderToStaticMarkup(<ForeignPayoutNotice snapshot={{ foreignTxids: [] }} />)).toBe('');
  });

  it('lists several payouts with their own status', () => {
    const second = { ...PAYOUT, txid: 'b'.repeat(64), vout: 1 };
    const out = renderToStaticMarkup(
      <dl>
        <PayoutDetails
          snapshot={{
            ...EMPTY,
            payouts: [PAYOUT, second],
            mints: new Map([[OUT, 'confirmed']]),
          }}
        />
      </dl>
    );
    expect(out).toContain('Bitcoin payouts');
    expect(out).toContain('sBTC has been minted for it.');
    expect(out).toContain('It is not registered with the sBTC signers yet.');
    const one = renderToStaticMarkup(
      <dl>
        <PayoutDetails snapshot={{ ...EMPTY, payouts: [PAYOUT] }} />
      </dl>
    );
    expect(one).toContain('Bitcoin payout<');
  });
});

describe('SendRecordView', () => {
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
        now={now}
        onConfirmNothingSent={() => undefined}
      />
    );
  }

  const attempting: SendRecord = { ...base, state: 'attempting' };
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
      { ...base, state: 'uncertain', tx: null, message: 'x' },
      new Date(STARTED + 1_000)
    );
    expect(out).toContain(CONFIRM);
  });

  it('tells the user not to send again once sent', () => {
    const out = view({
      ...base,
      state: 'sent',
      tx: `0x${'ab'.repeat(32)}`,
      via: 'wallet',
      confirmed: false,
    });
    expect(out).toContain('Do not send again.');
    expect(out).toContain('Waiting for it to be confirmed on chain.');
    expect(out).not.toContain('<button');
    const confirmed = view({
      ...base,
      state: 'sent',
      tx: `0x${'ab'.repeat(32)}`,
      via: 'wallet',
      confirmed: true,
    });
    expect(confirmed).not.toContain('Waiting for it to be confirmed');
  });

  it('offers only the confirmation when nothing can be proven', () => {
    const out = view({
      ...base,
      state: 'uncertain',
      tx: null,
      message: 'Request expired',
    });
    expect(out).toContain('Check your wallet’s activity');
    expect(out).toContain('I checked my wallet and nothing was sent. Let me try again');
  });
});
