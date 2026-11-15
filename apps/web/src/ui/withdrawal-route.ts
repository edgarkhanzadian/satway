import type { Milestone, MilestoneKey, MilestoneStatus } from '../shared/index.js';
import type { LegStatus, RouteState, StopStatus } from './route.js';

export const WITHDRAWAL_STOPS = [
  'sBTC on Stacks',
  'Bitcoin payout',
  'Swap from BTC',
  'Your chain',
] as const;

export interface WithdrawalRouteInput {
  stacksConnected: boolean;
  destinationConnected: boolean;
  milestones: readonly Milestone[] | null;
}

export interface WithdrawalRouteUpdate {
  destination: string | null;
  milestones: readonly Milestone[] | null;
}

function stopOf(statuses: readonly MilestoneStatus[]): StopStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.every(s => s === 'done')) return 'done';
  if (statuses.some(s => s === 'current' || s === 'done')) return 'current';
  return 'pending';
}

function legInto(from: StopStatus, to: StopStatus): LegStatus {
  if (to === 'done') return 'done';
  if (to === 'current' && from === 'done') return 'active';
  return 'pending';
}

export function withdrawalRouteState(input: WithdrawalRouteInput): RouteState {
  const milestones = input.milestones;
  if (milestones === null) {
    return {
      stops: [
        input.stacksConnected ? 'ready' : 'pending',
        'pending',
        'pending',
        input.destinationConnected ? 'ready' : 'pending',
      ],
      legs: ['idle', 'idle', 'idle'],
      current: null,
    };
  }
  function statusOf(key: MilestoneKey): MilestoneStatus {
    return milestones?.find(m => m.key === key)?.status ?? 'pending';
  }
  const stops: RouteState['stops'] = [
    stopOf([statusOf('submitted'), statusOf('confirmed'), statusOf('accepted')]),
    stopOf([statusOf('paid')]),
    stopOf([statusOf('swapping')]),
    stopOf([statusOf('delivered')]),
  ];
  const legs: RouteState['legs'] = [
    legInto(stops[0], stops[1]),
    legInto(stops[1], stops[2]),
    legInto(stops[2], stops[3]),
  ];
  const open = stops.findIndex(s => s === 'current' || s === 'failed');
  if (open >= 0) return { stops, legs, current: open };
  return { stops, legs, current: stops.every(s => s === 'done') ? 3 : null };
}
