import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it, vi } from 'vitest';

import { Deposit, replacesUnsaved } from '../../../src/features/deposit/deposit.js';
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
      shown
    />
  );
}

describe('replacing a hidden deposit', () => {
  it('asks first only when the hidden deposit has no saved receipt and another is followed', () => {
    const other = { ...receipt, createdAt: '2026-11-15T12:00:00.000Z' };
    const unsaved = { receipt, receiptUnsaved: true };
    expect(replacesUnsaved(unsaved, { receipt: other, receiptUnsaved: false })).toBe(true);
    expect(replacesUnsaved(unsaved, { receipt, receiptUnsaved: false })).toBe(false);
    expect(
      replacesUnsaved({ receipt, receiptUnsaved: false }, { receipt: other, receiptUnsaved: false })
    ).toBe(false);
    expect(replacesUnsaved(null, unsaved)).toBe(false);
  });
});

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

  it('says the browser cannot remember deposits when its storage is unavailable', () => {
    expect(render(false)).toContain('This browser’s storage is unavailable');
  });

  it('still offers your deposits, a receipt file and the wallet search', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    });
    const html = render(false);
    vi.unstubAllGlobals();
    expect(html).toContain('Your deposits');
    expect(html).toContain('This browser does not remember any deposits yet.');
    expect(html).toContain('Load a receipt file');
    expect(html).toContain('No receipt? Search with your wallet');
  });

  it('shows the tracking and keeps the list hidden, still mounted, while a deposit is followed', () => {
    const html = render(true);
    expect(html).toMatch(
      /<div hidden="" class="[^"]*"><section class="satway-sheet"><h2[^>]*>Your deposits/
    );
    expect(html).toContain('>Hide<');
  });
});
