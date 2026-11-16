import { type ReclaimPlan, type Stage, planReclaim } from '@satway/core';

import type { Snapshot } from '../../shared/index.js';

export function reclaimPlanOf(snapshot: Snapshot, reclaimLockBlocks: number): ReclaimPlan {
  return planReclaim({
    outputs: snapshot.outputs,
    selected: snapshot.payouts.find(o => !o.spent) ?? null,
    tipHeight: snapshot.tipHeight,
    reclaimLockBlocks,
  });
}

export function reclaimOffered(plan: ReclaimPlan, stage: Stage | null): boolean {
  return stage === 'reclaimable' || plan.options.some(o => o.ready);
}
