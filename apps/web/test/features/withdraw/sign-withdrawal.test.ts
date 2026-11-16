import { beforeAll, describe, expect, it } from 'vitest';

import { type LiveQuote, liveQuoteFor, previewFor } from '../../../src/features/withdraw/flow.js';
import {
  type SignStorage,
  signWithdrawal,
} from '../../../src/features/withdraw/sign-withdrawal.js';
import {
  type ActiveWithdrawal,
  StacksWalletDeclinedError,
  type WithdrawalReceiptFile,
} from '../../../src/shared/index.js';
import { SENDER } from '../../shared/withdrawal-fixtures.js';
import { FORM, USDC, world } from './withdraw-world.js';

const TXID = 'f'.repeat(64);

let live: LiveQuote;

beforeAll(async () => {
  const w = world();
  live = await liveQuoteFor(w.deps, FORM, SENDER, await previewFor(w.deps, FORM));
});

interface Options {
  saves?: boolean;
  answer(): Promise<string>;
}

function harness(options: Options) {
  const log: string[] = [];
  const saved: WithdrawalReceiptFile[] = [];
  let active: ActiveWithdrawal | null = null;
  const shown: (ActiveWithdrawal | null)[] = [];
  const storage: SignStorage = {
    remember(receipt) {
      log.push(`remember ${receipt.stacksTxid ?? 'draft'}`);
      if (options.saves === false) return false;
      saved.push(receipt);
      return true;
    },
    setActive: receipt =>
      log.push(`active ${receipt === null ? 'none' : (receipt.stacksTxid ?? 'draft')}`),
    forgetDraft: () => log.push('forget draft'),
    download: receipt => log.push(`download ${receipt.stacksTxid ?? 'draft'}`),
  };
  const deps = {
    requestWithdrawal() {
      log.push('wallet asked');
      return options.answer();
    },
    onActive(update: (current: ActiveWithdrawal | null) => ActiveWithdrawal | null) {
      active = update(active);
      shown.push(active);
    },
  };
  return { log, saved, shown, run: () => signWithdrawal(deps, live, USDC, storage) };
}

describe('signWithdrawal', () => {
  it('saves the draft before the wallet is asked, then saves and downloads the sent txid', async () => {
    const h = harness({ answer: () => Promise.resolve(TXID) });
    expect(await h.run()).toBe('sent');
    expect(h.log).toEqual([
      'remember draft',
      'active draft',
      'wallet asked',
      `remember ${TXID}`,
      `active ${TXID}`,
      `download ${TXID}`,
    ]);
    expect(h.shown.map(a => a && { txid: a.receipt.stacksTxid, prompt: a.walletPrompt })).toEqual([
      { txid: null, prompt: true },
      { txid: TXID, prompt: false },
    ]);
  });

  it('a decline removes the draft and clears the active withdrawal', async () => {
    const h = harness({ answer: () => Promise.reject(new StacksWalletDeclinedError()) });
    expect(await h.run()).toBe('declined');
    expect(h.log.slice(-2)).toEqual(['forget draft', 'active none']);
    expect(h.shown.at(-1)).toBeNull();
  });

  it('a lost reply keeps the draft, so the page can ask whether anything was sent', async () => {
    const h = harness({ answer: () => Promise.reject(new Error('Internal error')) });
    expect(await h.run()).toBe('unanswered');
    expect(h.log).not.toContain('forget draft');
    expect(h.shown.at(-1)).toMatchObject({
      receipt: { stacksTxid: null },
      walletPrompt: false,
      receiptUnsaved: false,
    });
  });

  it('says the receipt was not kept when the browser refuses to save it', async () => {
    const h = harness({ saves: false, answer: () => Promise.resolve(TXID) });
    expect(await h.run()).toBe('sent');
    expect(h.log).not.toContain('active draft');
    expect(h.shown.at(-1)).toMatchObject({ receiptUnsaved: true });
  });
});
