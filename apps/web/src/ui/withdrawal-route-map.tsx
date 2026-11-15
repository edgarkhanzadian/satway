import { css } from 'satway-styles/css';
import { styled } from 'satway-styles/jsx';
import { routeLeg, routeStop } from 'satway-styles/recipes';

import { type RouteState, STOP_STATUS_TEXT, type StopStatus } from './route.js';
import { WITHDRAWAL_STOPS } from './withdrawal-route.js';

const NOTES = [
  'your sBTC withdrawal request',
  'paid by the sBTC signers',
  'by NEAR Intents',
  null,
] as const;

const LEGS = ['bitcoin', 'swap', 'origin'] as const;

const hidden = css({ srOnly: true });

function stopText(tracking: boolean, status: StopStatus, i: number): string | null {
  if (tracking || status !== 'pending') return STOP_STATUS_TEXT[status];
  return i === 0 || i === 3 ? 'Not connected' : null;
}

export function WithdrawalRouteMap(props: {
  state: RouteState;
  tracking: boolean;
  destination: string | null;
}) {
  const { state } = props;
  const mode = props.tracking ? 'tracking' : 'idle';
  return (
    <styled.ol
      gridArea="route"
      listStyleType="none"
      margin="space.00"
      padding="space.00"
      display="grid"
      gridTemplateColumns={{
        base: 'minmax(0, 1fr)',
        md: 'repeat(3, minmax(0, 1fr)) max-content',
      }}
      data-mode={mode}
      aria-label={props.tracking ? 'Withdrawal progress' : 'Route of a withdrawal'}
    >
      {state.stops.map((status, i) => {
        const name = WITHDRAWAL_STOPS[i];
        const shown = state.current === i || status === 'failed';
        const note = i === 3 ? (props.destination ?? 'USDC, ETH, SOL and more') : NOTES[i];
        const text = stopText(props.tracking, status, i);
        const leg = LEGS[i];
        const legStatus = state.legs[i];
        const stop = routeStop({ status, mode });
        return (
          <li
            key={name}
            className={stop.root}
            data-status={status}
            aria-current={state.current === i ? 'step' : undefined}
          >
            <span className={stop.mark} aria-hidden="true" />
            {leg && legStatus && (
              <span
                className={routeLeg({ leg, status: legStatus })}
                data-status={legStatus}
                aria-hidden="true"
              />
            )}
            <span className={stop.name}>{name}</span>
            <span className={stop.note}>{note}</span>
            {text && <span className={shown ? stop.state : hidden}>{text}</span>}
          </li>
        );
      })}
    </styled.ol>
  );
}
