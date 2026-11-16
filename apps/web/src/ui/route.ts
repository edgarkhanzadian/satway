import type { Stage } from '@satway/core';

export const STOPS = ['Your chain', 'Swap to BTC', 'Bitcoin deposit', 'sBTC on Stacks'] as const;

export type StopStatus = 'pending' | 'ready' | 'current' | 'done' | 'failed';

export type LegStatus = 'idle' | 'pending' | 'active' | 'done';

export interface RouteState {
  stops: [StopStatus, StopStatus, StopStatus, StopStatus];
  legs: [LegStatus, LegStatus, LegStatus];
  current: number | null;
}

export interface RouteInput {
  sourceConnected: boolean;
  stacksConnected: boolean;
  deposit: { stage: Stage | null } | null;
}

export interface RouteUpdate {
  origin: string | null;
  deposit: { stage: Stage | null } | null;
}

type Row = Pick<RouteState, 'stops' | 'legs'> & { current: number | null };

const BY_STAGE: Record<Stage, Row> = {
  'awaiting-funds': {
    stops: ['current', 'pending', 'pending', 'pending'],
    legs: ['pending', 'pending', 'pending'],
    current: 0,
  },
  swapping: {
    stops: ['done', 'current', 'pending', 'pending'],
    legs: ['active', 'pending', 'pending'],
    current: 1,
  },
  'awaiting-payout': {
    stops: ['done', 'done', 'current', 'pending'],
    legs: ['done', 'active', 'pending'],
    current: 2,
  },
  'payout-unconfirmed': {
    stops: ['done', 'done', 'current', 'pending'],
    legs: ['done', 'active', 'pending'],
    current: 2,
  },
  'awaiting-notification': {
    stops: ['done', 'done', 'current', 'pending'],
    legs: ['done', 'done', 'active'],
    current: 2,
  },
  minting: {
    stops: ['done', 'done', 'done', 'current'],
    legs: ['done', 'done', 'active'],
    current: 3,
  },
  done: { stops: ['done', 'done', 'done', 'done'], legs: ['done', 'done', 'done'], current: 3 },
  refunded: {
    stops: ['done', 'failed', 'pending', 'pending'],
    legs: ['done', 'pending', 'pending'],
    current: 1,
  },
  'swap-failed': {
    stops: ['done', 'failed', 'pending', 'pending'],
    legs: ['done', 'pending', 'pending'],
    current: 1,
  },
  'mint-failed': {
    stops: ['done', 'done', 'failed', 'pending'],
    legs: ['done', 'done', 'pending'],
    current: 2,
  },
  reclaimable: {
    stops: ['done', 'done', 'failed', 'pending'],
    legs: ['done', 'done', 'pending'],
    current: 2,
  },
  reclaimed: {
    stops: ['done', 'done', 'failed', 'pending'],
    legs: ['done', 'done', 'pending'],
    current: 2,
  },
};

export function routeState(input: RouteInput): RouteState {
  if (input.deposit) {
    const stage = input.deposit.stage;
    if (stage === null) {
      return {
        stops: ['pending', 'pending', 'pending', 'pending'],
        legs: ['pending', 'pending', 'pending'],
        current: null,
      };
    }
    const row = BY_STAGE[stage];
    return { stops: [...row.stops], legs: [...row.legs], current: row.current };
  }
  return {
    stops: [
      input.sourceConnected ? 'ready' : 'pending',
      'pending',
      'pending',
      input.stacksConnected ? 'ready' : 'pending',
    ],
    legs: ['idle', 'idle', 'idle'],
    current: null,
  };
}

export const STOP_STATUS_TEXT: Record<StopStatus, string> = {
  pending: 'Not reached yet',
  ready: 'Connected',
  current: 'In progress',
  done: 'Done',
  failed: 'Stopped here',
};
