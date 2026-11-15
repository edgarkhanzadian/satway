import { describe, expect, it } from 'vitest';

import type { Stage } from '@satway/core';

import { type RouteState, STOPS, STOP_STATUS_TEXT, routeState } from '../../src/ui/route.js';

function during(stage: Stage | null): RouteState {
  return routeState({ sourceConnected: true, stacksConnected: true, deposit: { stage } });
}

describe('routeState before a deposit', () => {
  it('leaves every stop hollow when nothing is connected', () => {
    expect(routeState({ sourceConnected: false, stacksConnected: false, deposit: null })).toEqual({
      stops: ['pending', 'pending', 'pending', 'pending'],
      legs: ['idle', 'idle', 'idle'],
      current: null,
    });
  });

  it('fills the first stop for a source wallet and the last for a Stacks wallet', () => {
    expect(
      routeState({ sourceConnected: true, stacksConnected: false, deposit: null }).stops
    ).toEqual(['ready', 'pending', 'pending', 'pending']);
    expect(
      routeState({ sourceConnected: false, stacksConnected: true, deposit: null }).stops
    ).toEqual(['pending', 'pending', 'pending', 'ready']);
    expect(
      routeState({ sourceConnected: true, stacksConnected: true, deposit: null }).stops
    ).toEqual(['ready', 'pending', 'pending', 'ready']);
  });
});

describe('routeState during a deposit', () => {
  it('shows nothing reached while the first check is running', () => {
    expect(during(null)).toEqual({
      stops: ['pending', 'pending', 'pending', 'pending'],
      legs: ['pending', 'pending', 'pending'],
      current: null,
    });
  });

  it('ignores which wallets are connected', () => {
    const a = routeState({
      sourceConnected: false,
      stacksConnected: false,
      deposit: { stage: 'swapping' },
    });
    expect(a).toEqual(during('swapping'));
  });

  const cases: [Stage, RouteState][] = [
    [
      'awaiting-funds',
      {
        stops: ['current', 'pending', 'pending', 'pending'],
        legs: ['pending', 'pending', 'pending'],
        current: 0,
      },
    ],
    [
      'swapping',
      {
        stops: ['done', 'current', 'pending', 'pending'],
        legs: ['active', 'pending', 'pending'],
        current: 1,
      },
    ],
    [
      'awaiting-payout',
      {
        stops: ['done', 'done', 'current', 'pending'],
        legs: ['done', 'active', 'pending'],
        current: 2,
      },
    ],
    [
      'payout-unconfirmed',
      {
        stops: ['done', 'done', 'current', 'pending'],
        legs: ['done', 'active', 'pending'],
        current: 2,
      },
    ],
    [
      'payout-ambiguous',
      {
        stops: ['done', 'done', 'current', 'pending'],
        legs: ['done', 'done', 'active'],
        current: 2,
      },
    ],
    [
      'awaiting-notification',
      {
        stops: ['done', 'done', 'current', 'pending'],
        legs: ['done', 'done', 'active'],
        current: 2,
      },
    ],
    [
      'minting',
      { stops: ['done', 'done', 'done', 'current'], legs: ['done', 'done', 'active'], current: 3 },
    ],
    [
      'done',
      { stops: ['done', 'done', 'done', 'done'], legs: ['done', 'done', 'done'], current: 3 },
    ],
    [
      'refunded',
      {
        stops: ['done', 'failed', 'pending', 'pending'],
        legs: ['done', 'pending', 'pending'],
        current: 1,
      },
    ],
    [
      'swap-failed',
      {
        stops: ['done', 'failed', 'pending', 'pending'],
        legs: ['done', 'pending', 'pending'],
        current: 1,
      },
    ],
    [
      'mint-failed',
      {
        stops: ['done', 'done', 'failed', 'pending'],
        legs: ['done', 'done', 'pending'],
        current: 2,
      },
    ],
    [
      'reclaimable',
      {
        stops: ['done', 'done', 'failed', 'pending'],
        legs: ['done', 'done', 'pending'],
        current: 2,
      },
    ],
    [
      'reclaimed',
      {
        stops: ['done', 'done', 'failed', 'pending'],
        legs: ['done', 'done', 'pending'],
        current: 2,
      },
    ],
  ];

  it('has a case for every stage', () => {
    const covered = new Set(cases.map(([stage]) => stage));
    const all: Record<Stage, true> = {
      'awaiting-funds': true,
      swapping: true,
      'awaiting-payout': true,
      'payout-unconfirmed': true,
      'payout-ambiguous': true,
      'awaiting-notification': true,
      minting: true,
      done: true,
      refunded: true,
      'swap-failed': true,
      'mint-failed': true,
      reclaimable: true,
      reclaimed: true,
    };
    expect([...covered].sort()).toEqual(Object.keys(all).sort());
  });

  it.each(cases)('maps %s', (stage, expected) => {
    expect(during(stage)).toEqual(expected);
  });

  it.each(cases)('keeps at most one leg moving and marks the current stop for %s', stage => {
    const state = during(stage);
    expect(state.legs.filter(l => l === 'active').length).toBeLessThanOrEqual(1);
    const current = state.current;
    if (current === null) throw new Error('Expected a current stop');
    expect(['current', 'done', 'failed']).toContain(state.stops[current]);
    for (let i = current + 1; i < STOPS.length; i++) expect(state.stops[i]).toBe('pending');
  });

  it('returns fresh arrays, so callers cannot change the table', () => {
    const first = during('minting');
    first.stops[0] = 'failed';
    expect(during('minting').stops[0]).toBe('done');
  });
});

describe('stop status text', () => {
  it('has words for every status', () => {
    for (const s of ['pending', 'ready', 'current', 'done', 'failed'] as const) {
      expect(STOP_STATUS_TEXT[s].length).toBeGreaterThan(0);
    }
  });
});
