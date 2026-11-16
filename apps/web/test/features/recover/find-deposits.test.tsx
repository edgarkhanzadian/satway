import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { FindDeposits } from '../../../src/features/recover/find-deposits.js';

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
