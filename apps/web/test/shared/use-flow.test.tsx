import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { pureMachine } from '../../src/shared/flow-store.js';
import { useFlow } from '../../src/shared/use-flow.js';

const counter = pureMachine((state: number, event: 'add') => (event === 'add' ? state + 1 : state));

function Counter(props: { start: number }) {
  const flow = useFlow(counter, () => props.start);
  return <output>{flow.state}</output>;
}

describe('useFlow', () => {
  it('renders the initial state', () => {
    expect(renderToStaticMarkup(<Counter start={3} />)).toBe('<output>3</output>');
  });
});
