import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as W,
  type WithdrawalReceipt,
  buildWithdrawalContractCall,
  encodeWithdrawalRecipient,
} from '@satway/core';

import { RECEIPTS_KEY, loadReceipts, verifyReceipt } from '../../src/shared/receipt.js';
import {
  ACTIVE_WITHDRAWAL_KEY,
  MAX_UNREADABLE_WITHDRAWAL_BACKUPS,
  UNREADABLE_WITHDRAWALS_PREFIX,
  WITHDRAWALS_KEY,
  activeWithdrawal,
  forgetWithdrawalDraft,
  loadWithdrawals,
  looksLikeWithdrawalReceipt,
  rememberWithdrawal,
  setActiveWithdrawal,
  verifyWithdrawalReceipt,
  watchedWithdrawalOf,
  withStacksTxid,
  withdrawalFileName,
  withdrawalReceiptOf,
} from '../../src/shared/withdrawal-receipt.js';
import {
  EVM_RECIPIENT,
  QUOTE,
  REFUND,
  SENDER,
  STACKS_TXID,
  SWAP_ADDRESS,
  receiptFixture,
} from './withdrawal-fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

function stubStorage() {
  const store = memoryStorage();
  vi.stubGlobal('localStorage', store);
  return store;
}

function json(value: unknown): unknown {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return parsed;
}

describe('verifyWithdrawalReceipt', () => {
  it('accepts a receipt that adds up, after a JSON round trip', () => {
    const receipt = receiptFixture();
    expect(verifyWithdrawalReceipt(W, json(receipt))).toEqual(receipt);
    expect(verifyWithdrawalReceipt(W, json(receiptFixture({ stacksTxid: null }))).stacksTxid).toBe(
      null
    );
  });

  it('keeps unknown fields so a newer file still loads', () => {
    const loaded = verifyWithdrawalReceipt(W, { ...receiptFixture(), note: 'hello' });
    expect(Reflect.get(loaded, 'note')).toBe('hello');
  });

  it.each([
    ['a swap address that the recipient does not encode', { depositAddress: REFUND }],
    ['a contract as the sender', { sender: `${SENDER}.some-contract` }],
    ['another amount', { amountSats: 20_000 }],
    ['another refund address', { refundTo: 'bc1qm4uwx6n3usjgul5madqtr4khhlglr7xnagmvxf' }],
    ['another deadline', { quoteDeadline: '2026-11-17T16:41:38.000Z' }],
    ['an amount at the dust limit', { amountSats: 546 }],
    ['an amount whose fee cap overflows', { amountSats: Number.MAX_SAFE_INTEGER }],
    ['a creation time that is not a date', { createdAt: 'yesterday' }],
  ])('refuses %s', (_label, over) => {
    expect(() => verifyWithdrawalReceipt(W, json(receiptFixture(over)))).toThrow(
      /Receipt does not add up/
    );
  });

  it('checks invariants, not the policy limits in force today', () => {
    const stricter = {
      ...W,
      minWithdrawalSats: 50_000,
      minFeeCapSats: 5_000,
      maxFeeCapSats: 4_000,
    };
    const receipt = receiptFixture();
    expect(verifyWithdrawalReceipt(stricter, json(receipt))).toEqual(receipt);
    expect(verifyWithdrawalReceipt(W, json(receiptFixture({ maxFeeSats: 100 }))).maxFeeSats).toBe(
      100
    );
    expect(() =>
      verifyWithdrawalReceipt(stricter, json(receiptFixture({ amountSats: 546 })))
    ).toThrow(/above 546/);
  });

  it('refuses a destination that the quote does not pay', () => {
    const r = receiptFixture();
    expect(() =>
      verifyWithdrawalReceipt(W, {
        ...r,
        destination: { ...r.destination, address: '0x0000000000000000000000000000000000000001' },
      })
    ).toThrow(/pays a different recipient/);
    expect(() =>
      verifyWithdrawalReceipt(W, { ...r, destination: { ...r.destination, assetId: 'nep141:x' } })
    ).toThrow(/different asset/);
  });

  it('refuses a quote that pays a different swap address or is dry', () => {
    const r = receiptFixture();
    const other = { ...QUOTE, quote: { ...QUOTE.quote, depositAddress: REFUND } };
    expect(() => verifyWithdrawalReceipt(W, { ...r, quoteResponse: other })).toThrow(
      /different swap address/
    );
    const dry = { ...QUOTE, quoteRequest: { ...QUOTE.quoteRequest, dry: true } };
    expect(() => verifyWithdrawalReceipt(W, { ...r, quoteResponse: dry })).toThrow(/dry quote/);
  });

  it('refuses bad shapes with a plain reason', () => {
    expect(() => verifyWithdrawalReceipt(W, null)).toThrow('Not a receipt file');
    expect(() => verifyWithdrawalReceipt(W, { version: 1 })).toThrow(/not a withdrawal receipt/);
    expect(() => verifyWithdrawalReceipt(W, { ...receiptFixture(), version: 2 })).toThrow(
      'Unsupported withdrawal receipt version'
    );
    expect(() =>
      verifyWithdrawalReceipt(W, { ...receiptFixture(), stacksTxid: `0x${STACKS_TXID}` })
    ).toThrow(/Unexpected data from the withdrawal receipt file/);
  });

  it('is recognised by the deposit receipt loader, which says where to load it', () => {
    expect(looksLikeWithdrawalReceipt(receiptFixture())).toBe(true);
    expect(looksLikeWithdrawalReceipt({ version: 1 })).toBe(false);
    expect(() => verifyReceipt(json(receiptFixture()))).toThrow(/This is a withdrawal receipt/);
  });
});

describe('building receipts', () => {
  it('turns a prepared withdrawal into a draft, then a sent receipt', () => {
    const contractCall = buildWithdrawalContractCall(W, {
      sender: SENDER,
      amountSats: 10_000,
      maxFeeSats: 3_000,
      recipientAddress: SWAP_ADDRESS,
    });
    const prepared: WithdrawalReceipt = {
      version: 1,
      preparedAt: '2026-11-14T16:41:38.000Z',
      sender: SENDER,
      amountSats: 10_000,
      maxFeeSats: 3_000,
      lockedSats: 13_000,
      feeRateSatsPerVbyte: 2.5,
      destinationAsset: QUOTE.quoteRequest.destinationAsset,
      destinationRecipient: EVM_RECIPIENT,
      refundTo: REFUND,
      depositAddress: SWAP_ADDRESS,
      recipient: encodeWithdrawalRecipient(SWAP_ADDRESS),
      quoteRequest: QUOTE.quoteRequest,
      quoteResponse: QUOTE,
      quoteDeadline: '2026-11-16T16:41:38.000Z',
      amountOut: QUOTE.quote.amountOut,
      minAmountOut: QUOTE.quote.minAmountOut,
      refundFeeSats: 1_900,
      contractCall,
      limits: {
        perWithdrawalCap: null,
        rollingWithdrawalBlocks: null,
        rollingWithdrawalCap: null,
        availableToWithdraw: null,
      },
    };
    const draft = withdrawalReceiptOf(prepared, {
      assetId: QUOTE.quoteRequest.destinationAsset,
      chain: 'base',
      symbol: 'USDC',
      decimals: 6,
    });
    expect(draft).toEqual(receiptFixture({ stacksTxid: null }));
    expect(withStacksTxid(draft, `0x${STACKS_TXID.toUpperCase()}`)).toEqual(receiptFixture());
    expect(() => withStacksTxid(draft, 'nope')).toThrow(/Not a Stacks transaction id/);
  });

  it('builds what the core observer watches', () => {
    expect(watchedWithdrawalOf(receiptFixture(), STACKS_TXID)).toEqual({
      stacksTxid: STACKS_TXID,
      sender: SENDER,
      amountSats: 10_000,
      maxFeeSats: 3_000,
      depositAddress: SWAP_ADDRESS,
      recipient: receiptFixture().recipient,
      quoteResponse: QUOTE,
      quoteDeadline: '2026-11-16T16:41:38.000Z',
    });
  });

  it('names the file after the date and the swap address', () => {
    expect(withdrawalFileName(receiptFixture())).toBe('satway-withdrawal-2026-11-14-t5khap86.json');
  });
});

describe('withdrawal storage', () => {
  it('remembers, replaces a draft with its sent receipt, and loads newest first', () => {
    const store = stubStorage();
    const draft = receiptFixture({ stacksTxid: null });
    expect(rememberWithdrawal(W, draft)).toBe(true);
    expect(loadWithdrawals(W)).toEqual([draft]);
    expect(rememberWithdrawal(W, receiptFixture())).toBe(true);
    expect(loadWithdrawals(W)).toEqual([receiptFixture()]);
    expect(store.data.has(RECEIPTS_KEY)).toBe(false);
    expect(loadReceipts()).toEqual([]);
  });

  it('keeps entries it cannot read untouched', () => {
    const store = stubStorage();
    store.setItem(WITHDRAWALS_KEY, JSON.stringify([{ kind: 'something-newer' }]));
    expect(rememberWithdrawal(W, receiptFixture())).toBe(true);
    const raw: unknown = JSON.parse(store.getItem(WITHDRAWALS_KEY) ?? '[]');
    expect(raw).toEqual([json(receiptFixture()), { kind: 'something-newer' }]);
    expect(loadWithdrawals(W)).toEqual([receiptFixture()]);
  });

  it('backs up an unreadable list before writing a new one', () => {
    const store = stubStorage();
    store.setItem(WITHDRAWALS_KEY, '{broken');
    expect(rememberWithdrawal(W, receiptFixture())).toBe(true);
    expect(store.getItem(`${UNREADABLE_WITHDRAWALS_PREFIX}0`)).toBe('{broken');
    expect(loadWithdrawals(W)).toEqual([receiptFixture()]);
  });

  it('refuses to overwrite an unreadable list when every backup slot is taken', () => {
    const store = stubStorage();
    for (let i = 0; i < MAX_UNREADABLE_WITHDRAWAL_BACKUPS; i++) {
      store.setItem(`${UNREADABLE_WITHDRAWALS_PREFIX}${i}`, `old ${i}`);
    }
    store.setItem(WITHDRAWALS_KEY, '{broken');
    expect(rememberWithdrawal(W, receiptFixture())).toBe(false);
    expect(store.getItem(WITHDRAWALS_KEY)).toBe('{broken');
  });

  it('keeps in-flight withdrawals after the policy limits change', () => {
    stubStorage();
    rememberWithdrawal(W, receiptFixture());
    setActiveWithdrawal(receiptFixture());
    const stricter = {
      ...W,
      minWithdrawalSats: 50_000,
      minFeeCapSats: 5_000,
      maxFeeCapSats: 4_000,
    };
    expect(loadWithdrawals(stricter)).toEqual([receiptFixture()]);
    expect(activeWithdrawal(stricter)).toEqual(receiptFixture());
  });

  it('forgets only drafts', () => {
    stubStorage();
    rememberWithdrawal(W, receiptFixture({ stacksTxid: null }));
    forgetWithdrawalDraft(W, receiptFixture({ stacksTxid: null }));
    expect(loadWithdrawals(W)).toEqual([]);
    rememberWithdrawal(W, receiptFixture());
    forgetWithdrawalDraft(W, receiptFixture({ stacksTxid: null }));
    expect(loadWithdrawals(W)).toEqual([receiptFixture()]);
  });

  it('points at the active withdrawal and clears it', () => {
    const store = stubStorage();
    rememberWithdrawal(W, receiptFixture());
    setActiveWithdrawal(receiptFixture());
    expect(store.getItem(ACTIVE_WITHDRAWAL_KEY)).toBe(SWAP_ADDRESS);
    expect(activeWithdrawal(W)).toEqual(receiptFixture());
    setActiveWithdrawal(null);
    expect(activeWithdrawal(W)).toBeNull();
  });

  it('degrades quietly when storage is blocked', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    try {
      expect(rememberWithdrawal(W, receiptFixture())).toBe(false);
      expect(loadWithdrawals(W)).toEqual([]);
      expect(activeWithdrawal(W)).toBeNull();
      expect(() => setActiveWithdrawal(receiptFixture())).not.toThrow();
      expect(() => forgetWithdrawalDraft(W, receiptFixture())).not.toThrow();
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
