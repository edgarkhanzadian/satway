import { describe, expect, it } from 'vitest';

import {
  type MintStatus,
  type Observations,
  type Payout,
  type PayoutObservation,
  type PayoutSpender,
  deriveProgress,
} from '../../src/index.js';

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
interface Single {
  swap?: Observations['swap'];
  payoutTxids?: string[];
  payout?: Payout | null;
  mint?: MintStatus;
  payoutSpent?: boolean;
  payoutSpender?: PayoutSpender | null;
  tipHeight?: number | null;
  payouts?: PayoutObservation[];
}

function obs(over: Single): Observations {
  const single = over.payout
    ? [
        {
          payout: over.payout,
          mint: over.mint ?? null,
          spent: over.payoutSpent,
          spender: over.payoutSpender,
        },
      ]
    : [];
  return {
    swap: over.swap === undefined ? 'SUCCESS' : over.swap,
    payouts: over.payouts ?? single,
    ...(over.payoutTxids ? { payoutTxids: over.payoutTxids } : {}),
    tipHeight: over.tipHeight === undefined ? 1_002 : over.tipHeight,
    reclaimLockBlocks: LOCK,
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
    for (const swap of ['PROCESSING', 'SUCCESS', null] as const) {
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

  it('a spent output still pending with Emily is minting when the signers spent it or the spender is unknown', () => {
    for (const payoutSpender of ['signers', null, undefined] as const) {
      const p = deriveProgress(
        obs({
          payout: payout(),
          mint: 'pending',
          tipHeight: 9_999,
          payoutSpent: true,
          payoutSpender,
        })
      );
      expect(p).toMatchObject({ stage: 'minting', terminal: false });
    }
  });

  it('a spent output the user reclaimed is reclaimed, whatever Emily still says', () => {
    for (const mint of ['pending', 'accepted', 'reprocessing', 'rbf'] as const) {
      const p = deriveProgress(
        obs({
          payout: payout(),
          mint,
          tipHeight: 9_999,
          payoutSpent: true,
          payoutSpender: 'reclaim',
        })
      );
      expect(p).toMatchObject({ stage: 'reclaimed', terminal: true, blocksUntilReclaim: null });
    }
  });

  it('a spent output the signers rejected has been reclaimed', () => {
    const p = deriveProgress(
      obs({ payout: payout(), mint: 'failed', tipHeight: 9_999, payoutSpent: true })
    );
    expect(p).toMatchObject({ stage: 'reclaimed', terminal: true, needsNotification: false });
  });

  it('a spent-looking output Emily does not know is reclaimed only when the reclaim path spent it', () => {
    for (const payoutSpender of ['signers', null, undefined] as const) {
      const p = deriveProgress(
        obs({ payout: payout(), mint: null, tipHeight: 9_999, payoutSpent: true, payoutSpender })
      );
      expect(p.stage).not.toBe('reclaimed');
      expect(p).toMatchObject({ terminal: false, needsNotification: false });
      expect(p.message).toMatch(/\.$/);
    }
    const reclaimed = deriveProgress(
      obs({
        payout: payout(),
        mint: null,
        tipHeight: 9_999,
        payoutSpent: true,
        payoutSpender: 'reclaim',
      })
    );
    expect(reclaimed).toMatchObject({ stage: 'reclaimed', terminal: true });
  });
});

describe('deriveProgress: the mint status could not be read', () => {
  it('a confirmed payout is neither registered nor re-notified, and the page says it cannot tell', () => {
    const p = deriveProgress(obs({ payout: payout(), mint: 'unknown' }));
    expect(p).toMatchObject({ stage: 'awaiting-notification', terminal: false });
    expect(p.needsNotification).toBe(false);
    expect(p.message).toMatch(/could not be reached/);
  });

  it('an unconfirmed payout is not re-notified', () => {
    const p = deriveProgress(
      obs({ payout: payout({ confirmed: false, blockHeight: null }), mint: 'unknown' })
    );
    expect(p).toMatchObject({ stage: 'payout-unconfirmed', needsNotification: false });
  });

  it('past the timelock it is reclaimable, keeps checking, and never says it was never processed', () => {
    const p = deriveProgress(obs({ payout: payout(), mint: 'unknown', tipHeight: 1_949 }));
    expect(p).toMatchObject({ stage: 'reclaimable', terminal: false, blocksUntilReclaim: 0 });
    expect(p.message).not.toMatch(/never processed/);
    expect(p.message).toMatch(/could not be reached/);
  });

  it('a spent payout is not called reclaimed or minted unless the spender says so', () => {
    for (const payoutSpender of ['signers', null, undefined] as const) {
      const p = deriveProgress(
        obs({ payout: payout(), mint: 'unknown', payoutSpent: true, payoutSpender })
      );
      expect(p.stage).not.toBe('reclaimed');
      expect(p.stage).not.toBe('done');
      expect(p.terminal).toBe(false);
      expect(p.message).toMatch(/could not be reached/);
    }
    const reclaimed = deriveProgress(
      obs({ payout: payout(), mint: 'unknown', payoutSpent: true, payoutSpender: 'reclaim' })
    );
    expect(reclaimed).toMatchObject({ stage: 'reclaimed', terminal: true });
  });
});

describe('deriveProgress: more than one payment to the deposit address', () => {
  const first = payout({ txid: 'a1'.repeat(32), blockHeight: 1_000 });
  const second = payout({ txid: 'b2'.repeat(32), blockHeight: 1_001, amountSats: 20_000 });

  it('follows the earliest payment that is not minted yet, and says there are several', () => {
    const p = deriveProgress(
      obs({
        swap: 'SUCCESS',
        payouts: [
          { payout: first, mint: 'confirmed' },
          { payout: second, mint: null },
        ],
      })
    );
    expect(p).toMatchObject({
      stage: 'awaiting-notification',
      terminal: false,
      needsNotification: true,
    });
    expect(p.message).toMatch(/^2 payments arrived at your deposit address\./);
  });

  it('is done only when every payment has been minted', () => {
    const partly = deriveProgress(
      obs({
        payouts: [
          { payout: first, mint: 'confirmed' },
          { payout: second, mint: 'unknown' },
        ],
      })
    );
    expect(partly.stage).not.toBe('done');
    expect(partly.terminal).toBe(false);
    const all = deriveProgress(
      obs({
        swap: 'SUCCESS',
        payouts: [
          { payout: first, mint: 'confirmed' },
          { payout: second, mint: 'confirmed' },
        ],
      })
    );
    expect(all).toMatchObject({ stage: 'done', terminal: true });
    expect(all.message).toMatch(/each of the 2 payments/);
  });

  it('is terminal only when every payment is', () => {
    const p = deriveProgress(
      obs({
        payouts: [
          { payout: first, mint: 'failed' },
          { payout: second, mint: 'pending' },
        ],
      })
    );
    expect(p.stage).toBe('minting');
    expect(p.terminal).toBe(false);
  });

  it('a minted payment while the swap is still in flight is not called done', () => {
    for (const swap of ['KNOWN_DEPOSIT_TX', 'PROCESSING'] as const) {
      const p = deriveProgress(obs({ swap, payout: first, mint: 'confirmed' }));
      expect(p.stage).not.toBe('done');
      expect(p.terminal).toBe(false);
      expect(p.message).toMatch(/^sBTC was minted for a payment/);
    }
    expect(deriveProgress(obs({ swap: null, payout: first, mint: 'confirmed' }))).toMatchObject({
      stage: 'done',
      terminal: false,
    });
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

describe('deriveProgress: a minted output that may not be this swap’s payout', () => {
  const ours = payout({ txid: 'c3'.repeat(32), blockHeight: 1_001 });
  const extra = payout({ txid: 'd4'.repeat(32), blockHeight: 1_000 });
  const mintedExtra = { payout: extra, mint: 'confirmed' as const };

  it('with the swap status unknown it says minted but keeps checking', () => {
    const p = deriveProgress(obs({ swap: null, payouts: [mintedExtra] }));
    expect(p).toMatchObject({ stage: 'done', terminal: false });
    expect(p.message).toMatch(/could not be read, so this page keeps checking\.$/);
  });

  it('with the swap paid out but its named payout not seen yet it waits for that payout', () => {
    const p = deriveProgress(
      obs({ swap: 'SUCCESS', payoutTxids: [ours.txid], payouts: [mintedExtra] })
    );
    expect(p).toMatchObject({ stage: 'awaiting-payout', terminal: false });
    expect(p.message).toMatch(/before your swap paid out/);
  });

  it('is done once the payout 1Click names is minted too', () => {
    const p = deriveProgress(
      obs({
        swap: 'SUCCESS',
        payoutTxids: [ours.txid],
        payouts: [mintedExtra, { payout: ours, mint: 'confirmed' }],
      })
    );
    expect(p).toMatchObject({ stage: 'done', terminal: true });
  });

  it('follows the named payout while it is still on its way', () => {
    const p = deriveProgress(
      obs({
        swap: 'SUCCESS',
        payoutTxids: [ours.txid],
        payouts: [
          mintedExtra,
          { payout: { ...ours, confirmed: false, blockHeight: null }, mint: null },
        ],
      })
    );
    expect(p).toMatchObject({
      stage: 'payout-unconfirmed',
      terminal: false,
      needsNotification: true,
    });
  });

  it('a deposit found without a swap is done once its outputs are minted, with no swap note', () => {
    const p = deriveProgress({ ...obs({ swap: null, payouts: [mintedExtra] }), swapless: true });
    expect(p).toMatchObject({ stage: 'done', terminal: true });
    expect(p.message).not.toMatch(/swap status/);
  });

  it('with no payout named by 1Click any minted output counts', () => {
    const p = deriveProgress(obs({ swap: 'SUCCESS', payouts: [mintedExtra] }));
    expect(p).toMatchObject({ stage: 'done', terminal: true });
  });

  it.each([
    ['REFUNDED', 'refunded'],
    ['FAILED', 'swap-failed'],
  ] as const)(
    'a %s swap shows its outcome, not done, and still lists the minted output',
    (swap, stage) => {
      const p = deriveProgress(obs({ swap, payouts: [mintedExtra] }));
      expect(p).toMatchObject({ stage, terminal: true, needsNotification: false });
      expect(p.message).toMatch(/sBTC was minted for a payment that reached your deposit address/);
    }
  );

  it('a refunded swap keeps checking while an output at the address still needs registering', () => {
    const p = deriveProgress(
      obs({ swap: 'REFUNDED', payouts: [mintedExtra, { payout: ours, mint: null }] })
    );
    expect(p).toMatchObject({ stage: 'refunded', terminal: false, needsNotification: true });
    expect(p.message).toMatch(
      /2 payments arrived at your deposit address anyway.*minted for 1 of them/
    );
  });
});

describe('deriveProgress: a payment before the swap pays out', () => {
  it.each(['PENDING_DEPOSIT', 'INCOMPLETE_DEPOSIT'] as const)(
    'with the swap at %s the send instructions stay and the output is listed as extra',
    swap => {
      for (const mint of [null, 'pending', 'confirmed'] as const) {
        const p = deriveProgress(obs({ swap, payout: payout(), mint }));
        expect(p).toMatchObject({ stage: 'awaiting-funds', terminal: false });
        expect(p.needsNotification).toBe(mint === null);
        expect(p.message).toMatch(/A payment arrived at this address before your swap paid out\./);
      }
    }
  );
});

describe('deriveProgress: SUCCESS without a named payout', () => {
  const STARTED = 1_700_000_000_000;
  const before = { ...payout({ txid: 'e5'.repeat(32) }), blockTime: STARTED / 1000 - 10 * 3600 };
  const earlier = { payout: before, mint: 'confirmed' as const };

  it('does not let a payment that predates the swap end it; it waits for 1Click to name the payout', () => {
    const p = deriveProgress({
      ...obs({ swap: 'SUCCESS', payouts: [earlier] }),
      swapStartedAt: STARTED,
    });
    expect(p).toMatchObject({
      stage: 'awaiting-payout',
      terminal: false,
      condition: 'awaiting-payout-hash',
    });
    expect(p.message).toMatch(/1Click has not named/);
  });

  it('counts the earlier payment once the swap deadline is a day past, so the wait ends', () => {
    const p = deriveProgress({
      ...obs({ swap: 'SUCCESS', payouts: [earlier] }),
      swapStartedAt: STARTED,
      swapDeadline: STARTED + 2 * 3_600_000,
      now: STARTED + 27 * 3_600_000,
    });
    expect(p).toMatchObject({ stage: 'done', terminal: true });
    expect(p.condition).toBeUndefined();
  });

  it('still ends a single swap whose payout arrived after it began, though 1Click names no hash', () => {
    const later = { ...before, txid: 'f6'.repeat(32), blockTime: STARTED / 1000 + 600 };
    const p = deriveProgress({
      ...obs({ swap: 'SUCCESS', payouts: [{ payout: later, mint: 'confirmed' }] }),
      swapStartedAt: STARTED,
    });
    expect(p).toMatchObject({ stage: 'done', terminal: true });
  });

  it('counts an unconfirmed payment as this swap’s payout', () => {
    const p = deriveProgress({
      ...obs({
        swap: 'SUCCESS',
        payouts: [{ payout: payout({ confirmed: false, blockHeight: null }), mint: null }],
      }),
      swapStartedAt: STARTED,
    });
    expect(p.stage).toBe('payout-unconfirmed');
    expect(p.condition).toBeUndefined();
  });
});

describe('deriveProgress: the headline with several payments', () => {
  const stranger = payout({ txid: 'a7'.repeat(32), blockHeight: 1_000 });
  const ours = payout({ txid: 'b8'.repeat(32), blockHeight: 1_001 });

  it('headlines the payout 1Click names, not an earlier stranger', () => {
    const p = deriveProgress(
      obs({
        swap: 'SUCCESS',
        payoutTxids: [ours.txid],
        tipHeight: 9_999,
        payouts: [
          { payout: stranger, mint: null, spent: true, spender: 'reclaim' },
          { payout: ours, mint: 'confirmed' },
        ],
      })
    );
    expect(p.stage).toBe('done');
    expect(p.terminal).toBe(true);
    expect(p.message).toMatch(/^2 payments arrived/);
  });

  it('headlines the named payout even while a stranger’s payment is unsettled, and keeps checking', () => {
    const p = deriveProgress(
      obs({
        swap: 'SUCCESS',
        payoutTxids: [ours.txid],
        tipHeight: 1_010,
        payouts: [
          { payout: stranger, mint: 'pending' },
          { payout: ours, mint: 'confirmed' },
        ],
      })
    );
    expect(p.stage).toBe('done');
    expect(p.terminal).toBe(false);
    expect(p.message).toMatch(/^2 payments arrived/);
  });

  it('without a named payout, headlines the earliest payment that is not settled', () => {
    const p = deriveProgress(
      obs({
        swap: 'SUCCESS',
        tipHeight: 9_999,
        payouts: [
          { payout: stranger, mint: null, spent: true, spender: 'reclaim' },
          { payout: ours, mint: 'pending' },
        ],
      })
    );
    expect(p.stage).toBe('reclaimable');
    expect(p.terminal).toBe(false);
  });
});

describe('deriveProgress: states that used to never end', () => {
  const DEADLINE = 1_700_000_000_000;
  const small = payout({ txid: 'c9'.repeat(32), amountSats: 5_000 });

  it('a named payout below the sBTC minimum says it cannot be minted and can be reclaimed', () => {
    const p = deriveProgress({
      ...obs({ swap: 'SUCCESS', payoutTxids: [small.txid] }),
      belowMinimum: [small],
    });
    expect(p).toMatchObject({
      stage: 'mint-failed',
      terminal: true,
      condition: 'payout-below-minimum',
    });
    expect(p.message).toMatch(/below the sBTC minimum/);
    expect(p.message).toMatch(/reclaim/);
    const late = deriveProgress({
      ...obs({ swap: 'SUCCESS', payoutTxids: [small.txid], tipHeight: 9_999 }),
      belowMinimum: [small],
    });
    expect(late).toMatchObject({ stage: 'reclaimable', condition: 'payout-below-minimum' });
  });

  it('a found deposit with only below-minimum outputs gets the below-minimum copy', () => {
    const p = deriveProgress({
      ...obs({ swap: null }),
      swapless: true,
      belowMinimum: [small],
    });
    expect(p).toMatchObject({ terminal: true, condition: 'payout-below-minimum' });
    expect(p.message).toMatch(/below the sBTC minimum/);
  });

  it('a named payout that is not at this address is a distinct state once the deadline is well past', () => {
    const named = { ...obs({ swap: 'SUCCESS', payoutTxids: ['dd'.repeat(32)] }) };
    const soon = deriveProgress({ ...named, swapDeadline: DEADLINE, now: DEADLINE + 3_600_000 });
    expect(soon).toMatchObject({ stage: 'awaiting-payout', terminal: false });
    expect(soon.condition).toBeUndefined();
    const late = deriveProgress({
      ...named,
      swapDeadline: DEADLINE,
      now: DEADLINE + 25 * 3_600_000,
    });
    expect(late).toMatchObject({ condition: 'payout-not-found', terminal: false });
    expect(late.message).toMatch(/1Click reports a payout/);
    const foreign = deriveProgress({
      ...named,
      foreignTxids: ['dd'.repeat(32)],
      swapDeadline: DEADLINE,
      now: DEADLINE + 25 * 3_600_000,
    });
    expect(foreign).toMatchObject({ condition: 'payout-not-found', terminal: true });
  });

  it('an unreadable swap status no longer blocks the end once the deadline is a day past', () => {
    const minted = obs({ swap: null, payout: payout(), mint: 'confirmed' });
    expect(deriveProgress(minted).terminal).toBe(false);
    expect(
      deriveProgress({ ...minted, swapDeadline: DEADLINE, now: DEADLINE + 3_600_000 }).terminal
    ).toBe(false);
    const old = deriveProgress({
      ...minted,
      swapDeadline: DEADLINE,
      now: DEADLINE + 25 * 3_600_000,
    });
    expect(old).toMatchObject({ stage: 'done', terminal: true });
  });
});

describe('deriveProgress: the payout 1Click names was replaced before it confirmed', () => {
  const STARTED = 1_700_000_000_000;
  const DEADLINE = STARTED + 2 * 3_600_000;
  const replaced = 'a1'.repeat(32);
  const replacement = payout({ txid: 'b2'.repeat(32), confirmed: false, blockHeight: null });
  const after = { swapStartedAt: STARTED, swapDeadline: DEADLINE, now: STARTED + 3_600_000 };

  function named(payouts: PayoutObservation[], vanished: string[]): Observations {
    return {
      ...obs({ swap: 'SUCCESS', payoutTxids: [replaced], payouts }),
      ...after,
      vanishedTxids: vanished,
    };
  }

  it('waits as before while the named transaction has been missing for one read only', () => {
    const p = deriveProgress(named([{ payout: replacement, mint: null }], []));
    expect(p).toMatchObject({ stage: 'awaiting-payout', terminal: false });
    expect(p.message).not.toMatch(/replaced/);
  });

  it('follows the payment that arrived after the swap began once the named one has vanished', () => {
    const p = deriveProgress(named([{ payout: replacement, mint: null }], [replaced]));
    expect(p).toMatchObject({
      stage: 'payout-unconfirmed',
      terminal: false,
      needsNotification: true,
    });
    expect(p.message).toMatch(/^BTC is on its way.*no longer shows, most likely because it was/);
    expect(p.message).not.toMatch(/payments arrived/);
  });

  it('reaches done when that payment is minted, with no second payment counted', () => {
    const minted = { ...replacement, confirmed: true, blockHeight: 1_000 };
    const p = deriveProgress(named([{ payout: minted, mint: 'confirmed' }], [replaced]));
    expect(p).toMatchObject({ stage: 'done', terminal: true });
    expect(p.condition).toBeUndefined();
  });

  it('does not adopt a payment that predates the swap', () => {
    const early = {
      ...payout({ txid: 'c3'.repeat(32) }),
      blockTime: STARTED / 1000 - 10 * 3600,
    };
    const p = deriveProgress(named([{ payout: early, mint: 'confirmed' }], [replaced]));
    expect(p).toMatchObject({ stage: 'awaiting-payout', terminal: false });
  });

  it('keeps naming the payout when only one of two named transactions vanished', () => {
    const p = deriveProgress({
      ...named([{ payout: replacement, mint: 'confirmed' }], [replaced]),
      payoutTxids: [replaced, 'd4'.repeat(32)],
    });
    expect(p).toMatchObject({ stage: 'awaiting-payout', terminal: false });
  });

  it('with nothing at the address still says the named payout is not found a day after the deadline', () => {
    const p = deriveProgress({ ...named([], [replaced]), now: DEADLINE + 25 * 3_600_000 });
    expect(p).toMatchObject({ condition: 'payout-not-found', terminal: false });
  });
});
