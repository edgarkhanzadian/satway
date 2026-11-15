import { Fragment } from 'react';

import { details } from 'satway-styles/recipes';

import type { Milestone, MilestoneStatus } from '../shared/index.js';

export const MILESTONE_STATUS_TEXT: Readonly<Record<MilestoneStatus, string>> = Object.freeze({
  done: 'Done',
  current: 'In progress',
  pending: 'Not reached yet',
  failed: 'Stopped here',
});

export function WithdrawalSteps(props: { milestones: readonly Milestone[] }) {
  return (
    <dl className={details()}>
      {props.milestones.map(m => (
        <Fragment key={m.key}>
          <dt>{m.label}</dt>
          <dd data-status={m.status}>{MILESTONE_STATUS_TEXT[m.status]}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
