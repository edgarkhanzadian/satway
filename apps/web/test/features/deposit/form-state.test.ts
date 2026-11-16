import { describe, expect, it } from 'vitest';

import {
  type Activating,
  type FormEffect,
  type FormEvent,
  type FormState,
  type FormStep,
  INITIAL_FORM,
  NEW_QUOTE_EXPIRED,
  type Previewed,
  type Repriced,
  durableFormEffect,
  formMachine,
  formView,
  pendingQuote,
  reduceForm,
} from '../../../src/features/deposit/form-state.js';
import { runQuote } from '../../../src/features/deposit/use-deposit-form.js';
import { createFlowStore } from '../../../src/shared/flow-store.js';
import { INPUTS, prepared } from './deposit-fixtures.js';

const LAST = 5;
const NEXT = LAST + 1;
const MESSAGE = 'Something went wrong';
const PREVIEW = prepared(35_260);
const SAME_LIVE = prepared(35_200, 7);
const WORSE_LIVE = prepared(30_000, 8);
const BEFORE_DEADLINE = new Date('2026-11-14T13:00:00.000Z');
const NEAR_DEADLINE = new Date('2026-11-14T13:56:00.000Z');
const EDITED_INPUTS = { ...INPUTS, amount: '30' };

function at(step: FormStep): FormState {
  return { last: LAST, step };
}

const previewed: Previewed = { kind: 'previewed', inputs: INPUTS, preview: PREVIEW };
const repriced: Repriced = { kind: 'repriced', inputs: INPUTS, preview: PREVIEW, live: WORSE_LIVE };
const activating: Activating = {
  kind: 'activating',
  request: LAST,
  inputs: INPUTS,
  preview: PREVIEW,
  live: SAME_LIVE,
  from: 'previewed',
  edited: false,
};

const STATES = {
  editing: at({ kind: 'editing' }),
  'quoting a first preview': at({
    kind: 'quoting',
    request: LAST,
    inputs: INPUTS,
    mode: 'preview',
    previous: null,
  }),
  'quoting a preview again': at({
    kind: 'quoting',
    request: LAST,
    inputs: INPUTS,
    mode: 'preview',
    previous: previewed,
  }),
  'quoting live': at({
    kind: 'quoting',
    request: LAST,
    inputs: INPUTS,
    mode: 'live',
    previous: previewed,
  }),
  previewed: at(previewed),
  repriced: at(repriced),
  'activating a live quote': at(activating),
  'activating a repriced quote': at({ ...activating, live: WORSE_LIVE, from: 'repriced' }),
  'activating after an edit': at({ ...activating, edited: true }),
  'failed with nothing quoted': at({ kind: 'failed', message: MESSAGE, after: null }),
  'failed under a preview': at({ kind: 'failed', message: MESSAGE, after: previewed }),
} satisfies Record<string, FormState>;

type StateName = keyof typeof STATES;

const STATE_NAMES: readonly StateName[] = [
  'editing',
  'quoting a first preview',
  'quoting a preview again',
  'quoting live',
  'previewed',
  'repriced',
  'activating a live quote',
  'activating a repriced quote',
  'activating after an edit',
  'failed with nothing quoted',
  'failed under a preview',
];

interface Expected {
  state: FormState;
  effects?: readonly FormEffect[];
}

function expectTable(event: FormEvent, changes: Partial<Record<StateName, Expected>>) {
  for (const name of STATE_NAMES) {
    it(`from ${name}`, () => {
      const state = STATES[name];
      const expected = changes[name];
      const next = reduceForm(state, event);
      if (expected === undefined) {
        expect(next.state).toBe(state);
        expect(next.effects).toEqual([]);
      } else {
        expect(next.state).toEqual(expected.state);
        expect(next.effects).toEqual(expected.effects ?? []);
      }
    });
  }
}

const editing: Expected = { state: at({ kind: 'editing' }) };

describe('reduceForm, every event in every state', () => {
  describe('edited', () => {
    expectTable(
      { type: 'edited' },
      {
        'quoting a first preview': editing,
        'quoting a preview again': editing,
        'quoting live': editing,
        previewed: editing,
        repriced: editing,
        'activating a live quote': { state: at({ ...activating, edited: true }) },
        'activating a repriced quote': {
          state: at({ ...activating, live: WORSE_LIVE, from: 'repriced', edited: true }),
        },
        'failed with nothing quoted': editing,
        'failed under a preview': editing,
      }
    );
  });

  describe('autofilled, which drops the quote but keeps the message', () => {
    expectTable(
      { type: 'autofilled' },
      {
        'quoting a first preview': editing,
        'quoting a preview again': editing,
        'quoting live': editing,
        previewed: editing,
        repriced: editing,
        'activating a live quote': { state: at({ ...activating, edited: true }) },
        'activating a repriced quote': {
          state: at({ ...activating, live: WORSE_LIVE, from: 'repriced', edited: true }),
        },
        'failed under a preview': {
          state: at({ kind: 'failed', message: MESSAGE, after: null }),
        },
      }
    );
  });

  describe('preview-requested', () => {
    function quoting(previous: Previewed | null): Expected {
      return {
        state: {
          last: NEXT,
          step: {
            kind: 'quoting',
            request: NEXT,
            inputs: EDITED_INPUTS,
            mode: 'preview',
            previous,
          },
        },
        effects: [{ type: 'quote', request: NEXT, inputs: EDITED_INPUTS, dry: true }],
      };
    }
    expectTable(
      { type: 'preview-requested', inputs: EDITED_INPUTS },
      {
        editing: quoting(null),
        previewed: quoting(previewed),
        'failed with nothing quoted': quoting(null),
        'failed under a preview': quoting(previewed),
      }
    );
  });

  describe('live-requested, for the inputs the preview was made for', () => {
    const live: Expected = {
      state: {
        last: NEXT,
        step: { kind: 'quoting', request: NEXT, inputs: INPUTS, mode: 'live', previous: previewed },
      },
      effects: [{ type: 'quote', request: NEXT, inputs: INPUTS, dry: false }],
    };
    expectTable({ type: 'live-requested' }, { previewed: live, 'failed under a preview': live });
  });

  describe('quoted, with a preview', () => {
    expectTable(
      { type: 'quoted', request: LAST, prepared: PREVIEW },
      {
        'quoting a first preview': { state: at(previewed) },
        'quoting a preview again': { state: at(previewed) },
        'quoting live': {
          state: { last: NEXT, step: { ...activating, request: NEXT, live: PREVIEW } },
          effects: [{ type: 'activate', request: NEXT, prepared: PREVIEW }],
        },
      }
    );
  });

  describe('quoted, with a live quote no worse than the preview', () => {
    expectTable(
      { type: 'quoted', request: LAST, prepared: SAME_LIVE },
      {
        'quoting a first preview': {
          state: at({ kind: 'previewed', inputs: INPUTS, preview: SAME_LIVE }),
        },
        'quoting a preview again': {
          state: at({ kind: 'previewed', inputs: INPUTS, preview: SAME_LIVE }),
        },
        'quoting live': {
          state: { last: NEXT, step: { ...activating, request: NEXT } },
          effects: [{ type: 'activate', request: NEXT, prepared: SAME_LIVE }],
        },
      }
    );
  });

  describe('quoted, with a live quote more than the slippage worse', () => {
    expectTable(
      { type: 'quoted', request: LAST, prepared: WORSE_LIVE },
      {
        'quoting a first preview': {
          state: at({ kind: 'previewed', inputs: INPUTS, preview: WORSE_LIVE }),
        },
        'quoting a preview again': {
          state: at({ kind: 'previewed', inputs: INPUTS, preview: WORSE_LIVE }),
        },
        'quoting live': { state: at(repriced) },
      }
    );
  });

  describe('quoted, for a request nobody waits on', () => {
    expectTable({ type: 'quoted', request: LAST - 1, prepared: SAME_LIVE }, {});
  });

  describe('quote-failed', () => {
    expectTable(
      { type: 'quote-failed', request: LAST, message: MESSAGE },
      {
        'quoting a first preview': {
          state: at({ kind: 'failed', message: MESSAGE, after: null }),
        },
        'quoting a preview again': {
          state: at({ kind: 'failed', message: MESSAGE, after: previewed }),
        },
        'quoting live': { state: at({ kind: 'failed', message: MESSAGE, after: previewed }) },
      }
    );
  });

  describe('quote-failed, for a request nobody waits on', () => {
    expectTable({ type: 'quote-failed', request: LAST - 1, message: MESSAGE }, {});
  });

  describe('reprice-accepted, before the quote deadline', () => {
    expectTable(
      { type: 'reprice-accepted', now: BEFORE_DEADLINE },
      {
        repriced: {
          state: {
            last: NEXT,
            step: { ...activating, request: NEXT, live: WORSE_LIVE, from: 'repriced' },
          },
          effects: [{ type: 'activate', request: NEXT, prepared: WORSE_LIVE }],
        },
      }
    );
  });

  describe('reprice-accepted, inside the five minutes before the deadline', () => {
    expectTable(
      { type: 'reprice-accepted', now: NEAR_DEADLINE },
      {
        repriced: {
          state: at({ kind: 'failed', message: NEW_QUOTE_EXPIRED, after: previewed }),
        },
      }
    );
  });

  describe('reprice-declined', () => {
    expectTable({ type: 'reprice-declined' }, { repriced: { state: at(previewed) } });
  });

  describe('activated', () => {
    expectTable(
      { type: 'activated', request: LAST },
      {
        'activating a live quote': editing,
        'activating a repriced quote': editing,
        'activating after an edit': editing,
      }
    );
  });

  describe('activated, for another request', () => {
    expectTable({ type: 'activated', request: LAST - 1 }, {});
  });

  describe('activation-failed', () => {
    const underPreview: Expected = {
      state: at({ kind: 'failed', message: MESSAGE, after: previewed }),
    };
    expectTable(
      { type: 'activation-failed', request: LAST, message: MESSAGE },
      {
        'activating a live quote': underPreview,
        'activating a repriced quote': underPreview,
        'activating after an edit': {
          state: at({ kind: 'failed', message: MESSAGE, after: null }),
        },
      }
    );
  });

  describe('activation-failed, for another request', () => {
    expectTable({ type: 'activation-failed', request: LAST - 1, message: MESSAGE }, {});
  });
});

function store() {
  const effects: FormEffect[] = [];
  const s = createFlowStore(formMachine, INITIAL_FORM, effect => effects.push(effect));
  return { store: s, effects };
}

function requestOf(state: FormState): number {
  const [request] = pendingQuote(state);
  if (request === undefined) throw new Error(`Not quoting: ${state.step.kind}`);
  return request;
}

describe('deposit form regressions', () => {
  it('an edit in the middle of a quote frees the form and aborts the quote', () => {
    const { store: s } = store();
    s.dispatch({ type: 'preview-requested', inputs: INPUTS });
    const signal = s.signal(requestOf(s.get()));
    expect(formView(s.get().step).busy).toBe(true);
    s.dispatch({ type: 'edited' });
    expect(signal.aborted).toBe(true);
    expect(formView(s.get().step)).toEqual({
      error: null,
      preview: null,
      repriced: null,
      busy: false,
    });
  });

  it('an edit aborts the network calls of the quote that is running', async () => {
    const seen: AbortSignal[] = [];
    function fetchFn(_url: string, init?: RequestInit): Promise<Response> {
      const signal = init?.signal;
      if (!signal) return Promise.reject(new Error('no signal'));
      seen.push(signal);
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    const backend = {
      tokens: () => Promise.reject(new Error('not used')),
      quote: () => Promise.reject(new Error('not used')),
      status: () => Promise.reject(new Error('not used')),
      register: () => Promise.reject(new Error('not used')),
    };
    const s = createFlowStore(formMachine, INITIAL_FORM, effect => {
      if (effect.type !== 'quote') return;
      void runQuote(
        { backend, signal: s.signal(effect.request), dispatch: s.dispatch, fetchFn },
        effect
      );
    });
    s.dispatch({ type: 'preview-requested', inputs: INPUTS });
    await Promise.resolve();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(signal => !signal.aborted)).toBe(true);
    s.dispatch({ type: 'edited' });
    expect(seen.every(signal => signal.aborted)).toBe(true);
  });

  it('a late live quote for old inputs is never activated nor shown as a reprice', () => {
    const { store: s, effects } = store();
    s.dispatch({ type: 'preview-requested', inputs: INPUTS });
    s.dispatch({ type: 'quoted', request: requestOf(s.get()), prepared: PREVIEW });
    s.dispatch({ type: 'live-requested' });
    const stale = requestOf(s.get());
    s.dispatch({ type: 'edited' });
    s.dispatch({ type: 'preview-requested', inputs: EDITED_INPUTS });
    s.dispatch({ type: 'quoted', request: stale, prepared: WORSE_LIVE });
    s.dispatch({ type: 'quoted', request: stale, prepared: SAME_LIVE });
    expect(effects.map(e => e.type)).toEqual(['quote', 'quote', 'quote']);
    expect(formView(s.get().step).repriced).toBeNull();
    expect(s.get().step).toMatchObject({ kind: 'quoting', inputs: EDITED_INPUTS });
  });

  it('a stale reprice is cleared by an edit', () => {
    const next = reduceForm(at(repriced), { type: 'edited' });
    expect(formView(next.state.step).repriced).toBeNull();
  });

  it('only activation claims a deposit index, so a discarded, declined or failed quote never does', () => {
    const discarded = reduceForm(STATES['quoting live'], { type: 'edited' });
    const declined = reduceForm(at(repriced), { type: 'reprice-declined' });
    const failed = reduceForm(STATES['quoting live'], {
      type: 'quote-failed',
      request: LAST,
      message: MESSAGE,
    });
    const expired = reduceForm(at(repriced), { type: 'reprice-accepted', now: NEAR_DEADLINE });
    for (const t of [discarded, declined, failed, expired]) expect(t.effects).toEqual([]);
  });

  it('an edit during activation does not abandon it: the saved receipt is still followed', () => {
    const { store: s, effects } = store();
    s.dispatch({ type: 'preview-requested', inputs: INPUTS });
    s.dispatch({ type: 'quoted', request: requestOf(s.get()), prepared: PREVIEW });
    s.dispatch({ type: 'live-requested' });
    s.dispatch({ type: 'quoted', request: requestOf(s.get()), prepared: SAME_LIVE });
    const activation = effects.at(-1);
    expect(activation).toMatchObject({ type: 'activate', prepared: SAME_LIVE });
    s.dispatch({ type: 'edited' });
    s.dispatch({ type: 'preview-requested', inputs: EDITED_INPUTS });
    expect(s.get().step).toMatchObject({ kind: 'activating', edited: true });
    expect(formView(s.get().step).busy).toBe(true);
    if (activation?.type !== 'activate') throw new Error('expected an activation');
    s.dispatch({ type: 'activated', request: activation.request });
    expect(s.get().step).toEqual({ kind: 'editing' });
  });

  it('activation is a durable effect and a quote is not', () => {
    expect(durableFormEffect({ type: 'activate', request: 1, prepared: SAME_LIVE })).toBe(true);
    expect(durableFormEffect({ type: 'quote', request: 1, inputs: INPUTS, dry: true })).toBe(false);
  });

  it('a reprice is offered only when the live minimum is more than the slippage worse', () => {
    const slightly = reduceForm(STATES['quoting live'], {
      type: 'quoted',
      request: LAST,
      prepared: prepared(Math.ceil(PREVIEW.minimumSats * 0.99)),
    });
    expect(slightly.state.step.kind).toBe('activating');
    const worse = reduceForm(STATES['quoting live'], {
      type: 'quoted',
      request: LAST,
      prepared: prepared(Math.floor(PREVIEW.minimumSats * 0.99) - 1),
    });
    expect(worse.state.step.kind).toBe('repriced');
  });
});

describe('formView', () => {
  it('shows the preview under its reprice and while either is activated', () => {
    expect(formView(repriced)).toEqual({
      error: null,
      preview: PREVIEW,
      repriced: { preview: PREVIEW, live: WORSE_LIVE },
      busy: false,
    });
    expect(formView({ ...activating, live: WORSE_LIVE, from: 'repriced' })).toEqual({
      error: null,
      preview: PREVIEW,
      repriced: { preview: PREVIEW, live: WORSE_LIVE },
      busy: true,
    });
    expect(formView(activating)).toEqual({
      error: null,
      preview: PREVIEW,
      repriced: null,
      busy: true,
    });
  });

  it('keeps the preview under a failure and shows the message', () => {
    expect(formView({ kind: 'failed', message: MESSAGE, after: previewed })).toEqual({
      error: MESSAGE,
      preview: PREVIEW,
      repriced: null,
      busy: false,
    });
  });
});
