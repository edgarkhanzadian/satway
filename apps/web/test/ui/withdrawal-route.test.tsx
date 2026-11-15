import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import type { Milestone, MilestoneStatus } from '../../src/shared/withdrawal-progress.js';
import { WithdrawalRouteMap } from '../../src/ui/withdrawal-route-map.js';
import { withdrawalRouteState } from '../../src/ui/withdrawal-route.js';
import { WithdrawalSteps } from '../../src/ui/withdrawal-steps.js';

const KEYS = ['submitted', 'confirmed', 'accepted', 'paid', 'swapping', 'delivered'] as const;

function milestones(...statuses: MilestoneStatus[]): Milestone[] {
  return KEYS.map((key, i) => ({ key, label: key, status: statuses[i] ?? 'pending' }));
}

function route(...statuses: MilestoneStatus[]) {
  return withdrawalRouteState({
    stacksConnected: true,
    destinationConnected: false,
    milestones: milestones(...statuses),
  });
}

describe('withdrawalRouteState', () => {
  it('shows which wallets are connected before a withdrawal starts', () => {
    expect(
      withdrawalRouteState({ stacksConnected: true, destinationConnected: false, milestones: null })
    ).toEqual({
      stops: ['ready', 'pending', 'pending', 'pending'],
      legs: ['idle', 'idle', 'idle'],
      current: null,
    });
    expect(
      withdrawalRouteState({ stacksConnected: false, destinationConnected: true, milestones: null })
        .stops
    ).toEqual(['pending', 'pending', 'pending', 'ready']);
  });

  it('follows a withdrawal stop by stop', () => {
    expect(route('done', 'current')).toEqual({
      stops: ['current', 'pending', 'pending', 'pending'],
      legs: ['pending', 'pending', 'pending'],
      current: 0,
    });
    expect(route('done', 'done', 'current').current).toBe(0);
    expect(route('done', 'done', 'done', 'current')).toEqual({
      stops: ['done', 'current', 'pending', 'pending'],
      legs: ['active', 'pending', 'pending'],
      current: 1,
    });
    expect(route('done', 'done', 'done', 'done', 'current')).toEqual({
      stops: ['done', 'done', 'current', 'pending'],
      legs: ['done', 'active', 'pending'],
      current: 2,
    });
    expect(route('done', 'done', 'done', 'done', 'done', 'done')).toEqual({
      stops: ['done', 'done', 'done', 'done'],
      legs: ['done', 'done', 'done'],
      current: 3,
    });
  });

  it('stops at the failed step', () => {
    expect(route('done', 'failed')).toMatchObject({
      stops: ['failed', 'pending', 'pending', 'pending'],
      current: 0,
    });
    expect(route('done', 'done', 'done', 'done', 'failed')).toMatchObject({
      stops: ['done', 'done', 'failed', 'pending'],
      legs: ['done', 'pending', 'pending'],
      current: 2,
    });
  });
});

describe('WithdrawalRouteMap and WithdrawalSteps', () => {
  it('names the route for screen readers and marks the current step', () => {
    const html = renderToStaticMarkup(
      <WithdrawalRouteMap
        state={route('done', 'done', 'done', 'current')}
        tracking
        destination="USDC on base"
      />
    );
    expect(html).toContain('aria-label="Withdrawal progress"');
    expect(html).toContain('USDC on base');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Bitcoin payout');
  });

  it('describes an idle route', () => {
    const html = renderToStaticMarkup(
      <WithdrawalRouteMap
        state={withdrawalRouteState({
          stacksConnected: false,
          destinationConnected: false,
          milestones: null,
        })}
        tracking={false}
        destination={null}
      />
    );
    expect(html).toContain('aria-label="Route of a withdrawal"');
    expect(html).toContain('Not connected');
  });

  it('lists every step with its status', () => {
    const html = renderToStaticMarkup(
      <WithdrawalSteps milestones={milestones('done', 'current', 'failed')} />
    );
    expect(html).toContain('<dt>submitted</dt><dd data-status="done">Done</dd>');
    expect(html).toContain('<dd data-status="current">In progress</dd>');
    expect(html).toContain('<dd data-status="failed">Stopped here</dd>');
    expect(html).toContain('<dd data-status="pending">Not reached yet</dd>');
  });
});
