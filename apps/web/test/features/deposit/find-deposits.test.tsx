import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import type { FoundDeposit } from '@satway/core';

import {
  EMILY_KNOWS_NONE_NOTE,
  FindDeposits,
  afterEmily,
  foundText,
  mergeFound,
  scanFailedText,
} from '../../../src/features/deposit/find-deposits.js';

const ACCOUNT = {
  stacksAddress: 'SP1Q6W6VADA7V12SEVH6VNDNN4N7RX1PQ949EQPQ',
  reclaimPublicKey: '51b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2',
  reclaimKeyAddress: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys',
};

function render(account: typeof ACCOUNT | null): string {
  return renderToStaticMarkup(
    <FindDeposits account={account} selected={null} onSelect={() => undefined} />
  );
}

describe('FindDeposits', () => {
  it('asks for a wallet before it can search', () => {
    const out = render(null);
    expect(out).toContain('No receipt? Search with your wallet');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Search with my wallet<\/button>/);
    expect(out).toContain('Connect the wallet that made the deposit to search.');
  });

  it('offers the search once a wallet is connected, and no button is named like the Deposit tab', () => {
    const out = render(ACCOUNT);
    expect(out).toMatch(/<button class="[^"]*">Search with my wallet<\/button>/);
    for (const label of out.match(/<button[^>]*>[^<]*<\/button>/g) ?? []) {
      expect(label.replace(/<[^>]*>/g, '')).not.toMatch(/deposit/i);
    }
  });
});

const ONE: FoundDeposit = {
  stacksAddress: ACCOUNT.stacksAddress,
  reclaimPublicKey: ACCOUNT.reclaimPublicKey,
  signersPublicKey: 'd99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69',
  maxSignerFeeSats: 80_003,
  reclaimLockBlocks: 950,
  depositIndex: 3,
  depositAddress: 'bc1pexample',
  depositScriptPubKey: '5120',
  depositScript: '1e',
  reclaimScript: '02',
};

describe('FindDeposits: after the sBTC signers’ API answers', () => {
  it('scans Bitcoin when the API knows no registered deposit, and says why', () => {
    const next = afterEmily({ kind: 'read', result: { deposits: [], truncated: false } });
    expect(next).toEqual({ found: [], scan: true, note: EMILY_KNOWS_NONE_NOTE });
    expect(next.note).toMatch(/no registered deposits/);
  });

  it('scans Bitcoin when the API cannot be reached', () => {
    const next = afterEmily({ kind: 'failed', error: new Error('HTTP 503') });
    expect(next.scan).toBe(true);
    expect(next.note).toMatch(/^The sBTC signers’ API could not be reached \(HTTP 503\)/);
  });

  it('lists what the API found without scanning, and says when the list is cut short', () => {
    expect(afterEmily({ kind: 'read', result: { deposits: [ONE], truncated: false } })).toEqual({
      found: [ONE],
      scan: false,
      note: null,
    });
    const cut = afterEmily({ kind: 'read', result: { deposits: [ONE], truncated: true } });
    expect(cut.scan).toBe(false);
    expect(cut.note).toMatch(/only part of them is shown/);
  });

  it('says registered for what the API found, and what a scan cannot see', () => {
    expect(foundText(1, 'emily', false)).toBe(
      'Found 1 registered deposit address for this wallet.'
    );
    expect(foundText(0, 'emily', false)).toBe('No registered deposits were found for this wallet.');
    expect(foundText(0, 'scan', false)).toMatch(
      /^No deposits were found at your possible deposit addresses on Bitcoin\. Deposits made while/
    );
    expect(foundText(2, 'scan', true)).toBe(
      'Found 2 deposit addresses for this wallet. Checking was stopped early, so the list may be incomplete.'
    );
  });
});

describe('FindDeposits: keep scanning', () => {
  it('adds what a further scan finds to what was already found, once each', () => {
    const other = { ...ONE, depositIndex: 300, depositAddress: 'bc1pfar' };
    expect(mergeFound([ONE], [ONE, other])).toEqual([ONE, other]);
  });

  it('after a failed read it says what was kept and that the scan can go on', () => {
    expect(scanFailedText('HTTP 429')).toBe(
      'Could not read every possible deposit address on Bitcoin (HTTP 429). The deposits found so far are listed, and Keep scanning goes on from where it stopped.'
    );
  });
});
