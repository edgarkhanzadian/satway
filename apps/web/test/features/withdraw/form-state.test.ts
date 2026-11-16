import { beforeAll, describe, expect, it } from 'vitest';

import {
  type LiveQuote,
  type WithdrawalForm,
  liveQuoteFor,
  previewFor,
} from '../../../src/features/withdraw/flow.js';
import {
  type Confirming,
  type FormEvent,
  type FormState,
  type FormStep,
  INITIAL_FORM,
  type Previewed,
  formMachine,
  formView,
  pendingQuote,
  reduceForm,
  startSigning,
} from '../../../src/features/withdraw/form-state.js';
import { createFlowStore } from '../../../src/shared/flow-store.js';
import { SENDER } from '../../shared/withdrawal-fixtures.js';
import { FORM, world } from './withdraw-world.js';

const LAST = 5;
const EDITED: WithdrawalForm = { ...FORM, amount: '20000' };
const MESSAGE = 'Something went wrong';

let quotes: {
  preview: Previewed['preview'];
  fresh: Previewed['preview'];
  live: LiveQuote;
  fresher: LiveQuote;
};

beforeAll(async () => {
  const w = world();
  const preview = await previewFor(w.deps, FORM);
  const live = await liveQuoteFor(w.deps, FORM, SENDER, preview);
  quotes = { preview, fresh: { ...preview }, live, fresher: { ...live } };
});

function at(step: FormStep): FormState {
  return { last: LAST, step };
}

function steps() {
  const previewed: Previewed = { kind: 'previewed', inputs: FORM, preview: quotes.preview };
  const confirming: Confirming = {
    kind: 'confirming',
    inputs: FORM,
    preview: quotes.preview,
    live: quotes.live,
  };
  return {
    previewed,
    confirming,
    all: {
      editing: at({ kind: 'editing' }),
      'quoting a first preview': at({
        kind: 'quoting',
        request: LAST,
        inputs: FORM,
        mode: 'preview',
        previous: null,
        notice: null,
      }),
      'quoting a preview again': at({
        kind: 'quoting',
        request: LAST,
        inputs: FORM,
        mode: 'preview',
        previous: previewed,
        notice: null,
      }),
      'quoting live': at({
        kind: 'quoting',
        request: LAST,
        inputs: FORM,
        mode: 'live',
        previous: previewed,
        notice: null,
      }),
      previewed: at(previewed),
      confirming: at(confirming),
      signing: at({ ...confirming, kind: 'signing' }),
      'failed with nothing quoted': at({ kind: 'failed', message: MESSAGE, after: null }),
      'failed under a preview': at({ kind: 'failed', message: MESSAGE, after: previewed }),
      'failed under a live quote': at({ kind: 'failed', message: MESSAGE, after: confirming }),
    },
  };
}

type StateName = keyof ReturnType<typeof steps>['all'];

const STATE_NAMES: readonly StateName[] = [
  'editing',
  'quoting a first preview',
  'quoting a preview again',
  'quoting live',
  'previewed',
  'confirming',
  'signing',
  'failed with nothing quoted',
  'failed under a preview',
  'failed under a live quote',
];

function expectTable(
  event: () => FormEvent,
  changes: (s: ReturnType<typeof steps>) => Partial<Record<StateName, FormState>>
) {
  for (const name of STATE_NAMES) {
    it(`from ${name}`, () => {
      const s = steps();
      const state = s.all[name];
      const expected = changes(s)[name];
      const next = reduceForm(state, event());
      if (expected === undefined) expect(next).toBe(state);
      else expect(next).toEqual(expected);
    });
  }
}

describe('reduceForm, every event in every state', () => {
  describe('edited', () => {
    expectTable(
      () => ({ type: 'edited' }),
      () => ({
        'quoting a first preview': at({ kind: 'editing' }),
        'quoting a preview again': at({ kind: 'editing' }),
        'quoting live': at({ kind: 'editing' }),
        previewed: at({ kind: 'editing' }),
        confirming: at({ kind: 'editing' }),
        signing: at({ kind: 'editing' }),
        'failed with nothing quoted': at({ kind: 'editing' }),
        'failed under a preview': at({ kind: 'editing' }),
        'failed under a live quote': at({ kind: 'editing' }),
      })
    );
  });

  describe('autofilled, which clears the quote but keeps the message', () => {
    function bare() {
      return at({ kind: 'failed', message: MESSAGE, after: null });
    }
    expectTable(
      () => ({ type: 'autofilled' }),
      () => ({
        'quoting a first preview': at({ kind: 'editing' }),
        'quoting a preview again': at({ kind: 'editing' }),
        'quoting live': at({ kind: 'editing' }),
        previewed: at({ kind: 'editing' }),
        confirming: at({ kind: 'editing' }),
        signing: at({ kind: 'editing' }),
        'failed under a preview': bare(),
        'failed under a live quote': bare(),
      })
    );
  });

  describe('preview-requested', () => {
    function quoting(previous: Previewed | null): FormState {
      return {
        last: LAST + 1,
        step: {
          kind: 'quoting',
          request: LAST + 1,
          inputs: EDITED,
          mode: 'preview',
          previous,
          notice: null,
        },
      };
    }
    expectTable(
      () => ({ type: 'preview-requested', inputs: EDITED }),
      s => ({
        editing: quoting(null),
        previewed: quoting(s.previewed),
        'failed with nothing quoted': quoting(null),
        'failed under a preview': quoting(s.previewed),
      })
    );
  });

  describe('live-requested for inputs other than the previewed ones', () => {
    expectTable(
      () => ({ type: 'live-requested', inputs: EDITED }),
      () => ({})
    );
  });

  describe('live-requested for the previewed inputs', () => {
    function quoting(previous: Previewed): FormState {
      return {
        last: LAST + 1,
        step: {
          kind: 'quoting',
          request: LAST + 1,
          inputs: FORM,
          mode: 'live',
          previous,
          notice: null,
        },
      };
    }
    expectTable(
      () => ({ type: 'live-requested', inputs: { ...FORM } }),
      s => ({
        previewed: quoting(s.previewed),
        'failed under a preview': quoting(s.previewed),
      })
    );
  });

  describe('preview-ready for the pending request', () => {
    expectTable(
      () => ({ type: 'preview-ready', request: LAST, preview: quotes.fresh }),
      () => ({
        'quoting a first preview': at({ kind: 'previewed', inputs: FORM, preview: quotes.fresh }),
        'quoting a preview again': at({ kind: 'previewed', inputs: FORM, preview: quotes.fresh }),
      })
    );
  });

  describe('preview-ready for an older request', () => {
    expectTable(
      () => ({ type: 'preview-ready', request: LAST - 1, preview: quotes.fresh }),
      () => ({})
    );
  });

  describe('live-ready for the pending request', () => {
    expectTable(
      () => ({ type: 'live-ready', request: LAST, live: quotes.fresher }),
      () => ({
        'quoting live': at({
          kind: 'confirming',
          inputs: FORM,
          preview: quotes.preview,
          live: quotes.fresher,
        }),
      })
    );
  });

  describe('live-ready for an older request', () => {
    expectTable(
      () => ({ type: 'live-ready', request: LAST - 1, live: quotes.fresher }),
      () => ({})
    );
  });

  describe('quote-failed for the pending request', () => {
    expectTable(
      () => ({ type: 'quote-failed', request: LAST, message: 'No quote' }),
      s => ({
        'quoting a first preview': at({ kind: 'failed', message: 'No quote', after: null }),
        'quoting a preview again': at({ kind: 'failed', message: 'No quote', after: s.previewed }),
        'quoting live': at({ kind: 'failed', message: 'No quote', after: s.previewed }),
      })
    );
  });

  describe('quote-failed for an older request', () => {
    expectTable(
      () => ({ type: 'quote-failed', request: LAST - 1, message: 'No quote' }),
      () => ({})
    );
  });

  describe('cancelled', () => {
    expectTable(
      () => ({ type: 'cancelled' }),
      s => ({
        confirming: at(s.previewed),
        'failed under a live quote': at(s.previewed),
      })
    );
  });

  describe('sign-refused', () => {
    expectTable(
      () => ({ type: 'sign-refused', message: 'Too old' }),
      s => ({
        confirming: at({ kind: 'failed', message: 'Too old', after: s.previewed }),
        'failed under a live quote': at({ kind: 'failed', message: 'Too old', after: s.previewed }),
      })
    );
  });

  describe('sign-started', () => {
    expectTable(
      () => ({ type: 'sign-started' }),
      s => ({
        confirming: at({ ...s.confirming, kind: 'signing' }),
        'failed under a live quote': at({ ...s.confirming, kind: 'signing' }),
      })
    );
  });

  describe('wallet-answered', () => {
    expectTable(
      () => ({ type: 'wallet-answered' }),
      s => ({ signing: at(s.confirming) })
    );
  });

  describe('wallet-declined', () => {
    expectTable(
      () => ({ type: 'wallet-declined', message: 'Declined' }),
      s => ({
        editing: at({ kind: 'failed', message: 'Declined', after: null }),
        'quoting a first preview': at(declinedWhileQuoting('preview', null)),
        'quoting a preview again': at(declinedWhileQuoting('preview', s.previewed)),
        'quoting live': at(declinedWhileQuoting('live', s.previewed)),
        previewed: at({ kind: 'failed', message: 'Declined', after: s.previewed }),
        confirming: at({ kind: 'failed', message: 'Declined', after: s.confirming }),
        signing: at({ kind: 'failed', message: 'Declined', after: s.confirming }),
        'failed with nothing quoted': at({ kind: 'failed', message: 'Declined', after: null }),
        'failed under a preview': at({ kind: 'failed', message: 'Declined', after: s.previewed }),
        'failed under a live quote': at({
          kind: 'failed',
          message: 'Declined',
          after: s.confirming,
        }),
      })
    );
  });
});

function declinedWhileQuoting(mode: 'preview' | 'live', previous: Previewed | null): FormStep {
  return { kind: 'quoting', request: LAST, inputs: FORM, mode, previous, notice: 'Declined' };
}

describe('formView', () => {
  it('derives busy from quoting and keeps the earlier preview on screen while it works', () => {
    const s = steps();
    expect(formView(s.all['quoting a first preview'].step)).toEqual({
      error: null,
      preview: null,
      live: null,
      busy: true,
      signing: false,
    });
    expect(formView(s.all['quoting live'].step)).toMatchObject({
      preview: quotes.preview,
      busy: true,
    });
  });

  it('shows the message over the quote it failed under', () => {
    const s = steps();
    expect(formView(s.all['failed under a live quote'].step)).toEqual({
      error: MESSAGE,
      preview: quotes.preview,
      live: quotes.live,
      busy: false,
      signing: false,
    });
    expect(formView(s.all.signing.step)).toMatchObject({ live: quotes.live, signing: true });
  });
});

describe('pendingQuote', () => {
  it('names the request only while quoting', () => {
    const s = steps();
    expect(pendingQuote(s.all['quoting live'])).toEqual([LAST]);
    expect(pendingQuote(s.all.previewed)).toEqual([]);
  });
});

describe('regressions', () => {
  function store() {
    return createFlowStore(formMachine, INITIAL_FORM, () => undefined);
  }

  function pending(state: FormState): number {
    if (state.step.kind !== 'quoting') throw new Error(`Expected quoting, got ${state.step.kind}`);
    return state.step.request;
  }

  it('edit mid-quote frees the form', () => {
    const flow = store();
    flow.dispatch({ type: 'preview-requested', inputs: FORM });
    expect(formView(flow.get().step).busy).toBe(true);
    flow.dispatch({ type: 'edited' });
    expect(formView(flow.get().step).busy).toBe(false);
    expect(pendingQuote(flow.get())).toEqual([]);
  });

  it('edit mid live quote aborts its signal, so the 1Click listing retries stop', () => {
    const flow = store();
    flow.dispatch({ type: 'preview-requested', inputs: FORM });
    flow.dispatch({ type: 'preview-ready', request: pending(flow.get()), preview: quotes.preview });
    flow.dispatch({ type: 'live-requested', inputs: FORM });
    const signal = flow.signal(pending(flow.get()));
    flow.dispatch({ type: 'edited' });
    expect(signal.aborted).toBe(true);
    expect(flow.get().step).toEqual({ kind: 'editing' });
  });

  it('late reply for old inputs ignored', () => {
    const flow = store();
    flow.dispatch({ type: 'preview-requested', inputs: FORM });
    const old = pending(flow.get());
    flow.dispatch({ type: 'edited' });
    flow.dispatch({ type: 'preview-requested', inputs: EDITED });
    const current = pending(flow.get());
    flow.dispatch({ type: 'preview-ready', request: old, preview: quotes.preview });
    flow.dispatch({ type: 'quote-failed', request: old, message: 'late' });
    expect(flow.get().step).toMatchObject({ kind: 'quoting', inputs: EDITED });
    flow.dispatch({ type: 'preview-ready', request: current, preview: quotes.fresh });
    expect(flow.get().step).toEqual({ kind: 'previewed', inputs: EDITED, preview: quotes.fresh });
  });

  it('a quote is always carried with the inputs it was asked for', () => {
    const flow = store();
    flow.dispatch({ type: 'preview-requested', inputs: FORM });
    flow.dispatch({ type: 'preview-ready', request: pending(flow.get()), preview: quotes.preview });
    flow.dispatch({ type: 'live-requested', inputs: FORM });
    flow.dispatch({ type: 'live-ready', request: pending(flow.get()), live: quotes.live });
    expect(flow.get().step).toMatchObject({ kind: 'confirming', inputs: FORM, live: quotes.live });
  });

  it('decline message survives an edit and a new quote during the prompt', () => {
    const flow = store();
    flow.dispatch({ type: 'preview-requested', inputs: FORM });
    flow.dispatch({ type: 'wallet-declined', message: 'Nothing was signed' });
    expect(formView(flow.get().step)).toMatchObject({ busy: true, error: 'Nothing was signed' });
    flow.dispatch({ type: 'preview-ready', request: pending(flow.get()), preview: quotes.preview });
    expect(formView(flow.get().step)).toMatchObject({
      error: 'Nothing was signed',
      preview: quotes.preview,
    });
    flow.dispatch({ type: 'live-requested', inputs: FORM });
    expect(formView(flow.get().step).error).toBeNull();
  });

  it('a live quote is asked only for the inputs that were previewed', () => {
    const flow = store();
    flow.dispatch({ type: 'preview-requested', inputs: FORM });
    flow.dispatch({ type: 'preview-ready', request: pending(flow.get()), preview: quotes.preview });
    const previewed = flow.get();
    flow.dispatch({ type: 'live-requested', inputs: EDITED });
    expect(flow.get()).toBe(previewed);
  });

  it('a decline keeps the live quote so the user can sign again', () => {
    const s = steps();
    const declined = reduceForm(s.all.signing, { type: 'wallet-declined', message: 'No' });
    const again = reduceForm(declined, { type: 'sign-started' });
    expect(formView(declined.step)).toMatchObject({ error: 'No', live: quotes.live });
    expect(again.step.kind).toBe('signing');
    expect(formView(again.step).error).toBeNull();
  });
});

describe('startSigning', () => {
  const NOW = new Date('2026-11-17T12:00:00.000Z');

  function fresh(): LiveQuote {
    return {
      ...quotes.live,
      receipt: {
        ...quotes.live.receipt,
        preparedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        quoteDeadline: new Date(NOW.getTime() + 48 * 3_600_000).toISOString(),
      },
    };
  }

  function asFlow(state: FormState) {
    const store = createFlowStore(formMachine, state, () => undefined);
    return { current: store.get, dispatch: store.dispatch, get: store.get };
  }

  function confirmingStore(live: LiveQuote) {
    const step: Confirming = { kind: 'confirming', inputs: FORM, preview: quotes.preview, live };
    return asFlow(at(step));
  }

  it('signs the quote the state holds now, with the token of the inputs it was made for', () => {
    const live = fresh();
    const flow = confirmingStore(live);
    const signing = startSigning(flow, NOW);
    expect(signing?.live).toBe(live);
    expect(signing?.inputs.token).toBe(FORM.token);
    expect(flow.get().step.kind).toBe('signing');
  });

  it('refuses a stale quote without opening the wallet, and keeps the preview', () => {
    const flow = confirmingStore(quotes.live);
    const stale = new Date(Date.parse(quotes.live.receipt.preparedAt) + 16 * 60_000);
    expect(startSigning(flow, stale)).toBeNull();
    expect(flow.get().step).toMatchObject({ kind: 'failed', after: { kind: 'previewed' } });
  });

  it('does nothing when no live quote is on screen any more, or it is already being signed', () => {
    const editing = asFlow(INITIAL_FORM);
    expect(startSigning(editing, NOW)).toBeNull();
    expect(editing.get()).toBe(INITIAL_FORM);
    const flow = confirmingStore(fresh());
    startSigning(flow, NOW);
    const signing = flow.get();
    expect(startSigning(flow, NOW)).toBeNull();
    expect(flow.get()).toBe(signing);
  });
});
