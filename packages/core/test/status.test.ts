import { describe, expect, it } from 'vitest';

import { type Observations, type Payout, deriveProgress } from '../src/index.js';

const LOCK = 950;
function payout(over: Partial<Payout> = {}): Payout {
  return {
    txid: 'ab'.repeat(32),
    vout: 1,
    amountSats: 37_000,
    confirmed: true,
    blockHeight: 1_000,
    ...over,
  };
}
function obs(over: Partial<Observations>): Observations {
  return {
    swap: null,
    payout: null,
    mint: null,
    tipHeight: 1_002,
    reclaimLockBlocks: LOCK,
    ...over,
  };
}

describe('deriveProgress: before the payout', () => {
  it.each([
    [null, 'awaiting-funds', false],
    ['PENDING_DEPOSIT', 'awaiting-funds', false],
    ['INCOMPLETE_DEPOSIT', 'awaiting-funds', false],
    ['KNOWN_DEPOSIT_TX', 'swapping', false],
    ['PROCESSING', 'swapping', false],
    ['SUCCESS', 'awaiting-payout', false],
    ['REFUNDED', 'refunded', true],
    ['FAILED', 'swap-failed', true],
  ] as const)('swap %s -> %s', (swap, stage, terminal) => {
    const p = deriveProgress(obs({ swap }));
    expect(p.stage).toBe(stage);
    expect(p.terminal).toBe(terminal);
    expect(p.needsNotification).toBe(false);
    expect(p.message.length).toBeGreaterThan(10);
  });
});

describe('deriveProgress: after the payout', () => {
  it('asks for notification as soon as the payout is seen, even unconfirmed', () => {
    const p = deriveProgress(
      obs({ swap: 'SUCCESS', payout: payout({ confirmed: false, blockHeight: null }) })
    );
    expect(p.stage).toBe('payout-unconfirmed');
    expect(p.needsNotification).toBe(true);
    expect(p.blocksUntilReclaim).toBeNull();
  });

  it('does not re-notify an unconfirmed payout that is already registered', () => {
    const p = deriveProgress(
      obs({ payout: payout({ confirmed: false, blockHeight: null }), mint: 'pending' })
    );
    expect(p.needsNotification).toBe(false);
  });

  it('trusts the chain over the swap provider', () => {
    for (const swap of ['PROCESSING', 'FAILED', null] as const) {
      const p = deriveProgress(obs({ swap, payout: payout() }));
      expect(p.stage).toBe('awaiting-notification');
      expect(p.needsNotification).toBe(true);
    }
  });

  it.each(['pending', 'reprocessing', 'accepted'] as const)('mint %s -> minting', mint => {
    const p = deriveProgress(obs({ payout: payout(), mint }));
    expect(p.stage).toBe('minting');
    expect(p.terminal).toBe(false);
    expect(p.needsNotification).toBe(false);
  });

  it('confirmed mint -> done', () => {
    const p = deriveProgress(obs({ payout: payout(), mint: 'confirmed' }));
    expect(p).toMatchObject({ stage: 'done', terminal: true, needsNotification: false });
  });

  it('counts down to the reclaim height', () => {
    expect(deriveProgress(obs({ payout: payout(), mint: 'pending' })).blocksUntilReclaim).toBe(947);
    expect(
      deriveProgress(obs({ payout: payout(), mint: 'pending', tipHeight: 1_948 }))
        .blocksUntilReclaim
    ).toBe(1);
    expect(
      deriveProgress(obs({ payout: payout(), mint: 'pending', tipHeight: 1_949 }))
        .blocksUntilReclaim
    ).toBe(0);
    expect(
      deriveProgress(obs({ payout: payout(), mint: 'pending', tipHeight: 5_000 }))
        .blocksUntilReclaim
    ).toBe(0);
    expect(
      deriveProgress(obs({ payout: payout(), mint: 'pending', tipHeight: null })).blocksUntilReclaim
    ).toBeNull();
  });

  it('rejected deposit: waits, then becomes reclaimable', () => {
    const waiting = deriveProgress(obs({ payout: payout(), mint: 'failed' }));
    expect(waiting).toMatchObject({ stage: 'mint-failed', terminal: true });
    expect(waiting.message).toContain('947');
    const ready = deriveProgress(obs({ payout: payout(), mint: 'failed', tipHeight: 1_949 }));
    expect(ready.stage).toBe('reclaimable');
  });

  it('a never-registered deposit past the timelock is reclaimable, not re-notified', () => {
    const p = deriveProgress(obs({ payout: payout(), mint: null, tipHeight: 1_949 }));
    expect(p).toMatchObject({ stage: 'reclaimable', needsNotification: false, terminal: true });
  });

  it.each(['pending', 'accepted', 'reprocessing', 'rbf'] as const)(
    'mint %s past the timelock with the output unspent -> reclaimable, signers may still mint',
    mint => {
      const p = deriveProgress(
        obs({ payout: payout(), mint, tipHeight: 1_949, payoutSpent: false })
      );
      expect(p).toMatchObject({ stage: 'reclaimable', terminal: false, needsNotification: false });
      expect(p.blocksUntilReclaim).toBe(0);
      expect(p.message).toMatch(/may still mint/);
    }
  );

  it('a confirmed mint stays done past the timelock', () => {
    const p = deriveProgress(obs({ payout: payout(), mint: 'confirmed', tipHeight: 9_999 }));
    expect(p.stage).toBe('done');
  });

  it('an output the signers already spent is never reclaimable', () => {
    for (const mint of ['pending', 'accepted', 'rbf'] as const) {
      const p = deriveProgress(
        obs({ payout: payout(), mint, tipHeight: 9_999, payoutSpent: true })
      );
      expect(p.stage).toBe('minting');
      expect(p.blocksUntilReclaim).toBeNull();
    }
  });

  it('a spent output that was never registered or was rejected has been reclaimed', () => {
    for (const mint of [null, 'failed'] as const) {
      const p = deriveProgress(
        obs({ payout: payout(), mint, tipHeight: 9_999, payoutSpent: true })
      );
      expect(p).toMatchObject({ stage: 'reclaimed', terminal: true, needsNotification: false });
    }
  });
});

describe('deriveProgress: several possible payouts', () => {
  it('says plainly that it cannot tell which payment is the deposit', () => {
    const p = deriveProgress(obs({ swap: null, ambiguousMints: [null, 'pending'] }));
    expect(p).toMatchObject({ stage: 'payout-ambiguous', terminal: false });
    expect(p.message).toMatch(/^2 payments/);
  });

  it('is done when every one of them has been minted', () => {
    const p = deriveProgress(obs({ ambiguousMints: ['confirmed', 'confirmed'] }));
    expect(p).toMatchObject({ stage: 'done', terminal: true });
  });

  it('a single candidate list is not ambiguous', () => {
    expect(deriveProgress(obs({ swap: 'SUCCESS', ambiguousMints: [null] })).stage).toBe(
      'awaiting-payout'
    );
  });

  it('every state has a message that says what happens next', () => {
    const swaps = [
      null,
      'PENDING_DEPOSIT',
      'INCOMPLETE_DEPOSIT',
      'KNOWN_DEPOSIT_TX',
      'PROCESSING',
      'SUCCESS',
      'REFUNDED',
      'FAILED',
    ] as const;
    const mints = [null, 'pending', 'reprocessing', 'accepted', 'confirmed', 'failed'] as const;
    const payouts = [null, payout(), payout({ confirmed: false, blockHeight: null })];
    for (const swap of swaps)
      for (const mint of mints)
        for (const p of payouts)
          for (const tipHeight of [null, 1_002, 9_999]) {
            const progress = deriveProgress(obs({ swap, mint, payout: p, tipHeight }));
            expect(progress.message).toMatch(/\.$/);
            if (progress.stage === 'done') expect(mint).toBe('confirmed');
            if (progress.needsNotification) expect(p).not.toBeNull();
          }
  });
});
