import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { Deposit } from '../../../src/features/deposit/deposit.js';
import type { Backend } from '../../../src/shared/index.js';
import { RECEIPT } from './deposit-fixtures.js';

const receipt = RECEIPT;

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

const backend: Backend = {
  tokens: never,
  quote: never,
  status: never,
  register: never,
};

function render(active: boolean): string {
  return renderToStaticMarkup(
    <Deposit
      backend={backend}
      account={null}
      source={null}
      active={active ? { receipt, receiptUnsaved: false } : null}
      onActive={() => undefined}
      onRoute={() => undefined}
      signReclaim={never}
    />
  );
}

describe('Deposit without a connected Stacks wallet', () => {
  it('tracks an active deposit from its receipt alone', () => {
    const html = render(true);
    expect(html).toContain('Deposit in progress');
    expect(html).toContain(receipt.stacksAddress);
    expect(html).toContain(receipt.depositAddress);
  });

  it('shows the amounts the live quote promised', () => {
    expect(render(true)).toContain(
      'about 35,617 sats as sBTC, at least 35,260 sats before the signers’ Bitcoin fee'
    );
  });

  it('shows no deposit form, since a new deposit needs the wallet', () => {
    const html = render(false);
    expect(html).not.toContain('Deposit to sBTC from another chain');
    expect(html).toContain('Before you start');
  });

  it('still offers your deposits, a receipt file and the wallet search', () => {
    const html = render(false);
    expect(html).toContain('Your deposits');
    expect(html).toContain('This browser does not remember any deposits yet.');
    expect(html).toContain('Load a receipt file');
    expect(html).toContain('No receipt? Search with your wallet');
  });

  it('shows the tracking, not the list, while a deposit is followed', () => {
    const html = render(true);
    expect(html).not.toContain('Your deposits');
    expect(html).toContain('>Hide<');
  });
});
