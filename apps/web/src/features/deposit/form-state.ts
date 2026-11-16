import { quoteExpired } from '@satway/chains';
import { MAINNET_CONFIG as config } from '@satway/core';

import { type FlowMachine, type Transition, nextRequest, transition } from '../../shared/index.js';
import { type DepositInput, type Prepared, liveQuoteWorse } from './flow.js';

export const NEW_QUOTE_EXPIRED = 'That new quote has expired. Get a new quote to continue.';

export interface Editing {
  kind: 'editing';
}

export interface Previewed {
  kind: 'previewed';
  inputs: DepositInput;
  preview: Prepared;
}

export interface Quoting {
  kind: 'quoting';
  request: number;
  inputs: DepositInput;
  mode: 'preview' | 'live';
  previous: Previewed | null;
}

export interface Repriced {
  kind: 'repriced';
  inputs: DepositInput;
  preview: Prepared;
  live: Prepared;
}

export interface Activating {
  kind: 'activating';
  request: number;
  inputs: DepositInput;
  preview: Prepared;
  live: Prepared;
  from: 'previewed' | 'repriced';
  edited: boolean;
}

export interface Failed {
  kind: 'failed';
  message: string | null;
  after: Previewed | null;
}

export type FormStep = Editing | Quoting | Previewed | Repriced | Activating | Failed;

export interface FormState {
  last: number;
  step: FormStep;
}

export type FormEvent =
  | { type: 'edited' }
  | { type: 'autofilled' }
  | { type: 'preview-requested'; inputs: DepositInput }
  | { type: 'live-requested' }
  | { type: 'quoted'; request: number; prepared: Prepared }
  | { type: 'quote-failed'; request: number; message: string | null }
  | { type: 'reprice-accepted'; now: Date }
  | { type: 'reprice-declined' }
  | { type: 'activated'; request: number }
  | { type: 'activation-failed'; request: number; message: string | null };

export type FormEffect =
  | { type: 'quote'; request: number; inputs: DepositInput; dry: boolean }
  | { type: 'activate'; request: number; prepared: Prepared };

type Step = Transition<FormState, FormEffect>;

export const INITIAL_FORM: FormState = { last: 0, step: { kind: 'editing' } };

function withStep(state: FormState, step: FormStep): Step {
  return transition({ ...state, step });
}

function previewedOf(step: FormStep): Previewed | null {
  switch (step.kind) {
    case 'previewed':
      return step;
    case 'quoting':
      return step.previous;
    case 'failed':
      return step.after;
    case 'editing':
    case 'repriced':
    case 'activating':
      return null;
    default:
      throw new Error(`Unknown form step ${String(step satisfies never)}`);
  }
}

function startQuote(
  state: FormState,
  inputs: DepositInput,
  mode: Quoting['mode'],
  previous: Previewed | null
): Step {
  const request = nextRequest(state.last);
  return transition({ last: request, step: { kind: 'quoting', request, inputs, mode, previous } }, [
    { type: 'quote', request, inputs, dry: mode === 'preview' },
  ]);
}

function startActivation(
  state: FormState,
  confirmed: Omit<Activating, 'kind' | 'request' | 'edited'>
): Step {
  const request = nextRequest(state.last);
  return transition(
    { last: request, step: { ...confirmed, kind: 'activating', request, edited: false } },
    [{ type: 'activate', request, prepared: confirmed.live }]
  );
}

function answering(state: FormState, request: number): Quoting | null {
  return state.step.kind === 'quoting' && state.step.request === request ? state.step : null;
}

function activatingFor(state: FormState, request: number): Activating | null {
  return state.step.kind === 'activating' && state.step.request === request ? state.step : null;
}

function inputsChanged(state: FormState, keepMessage: boolean): Step {
  const { step } = state;
  if (step.kind === 'activating') {
    return step.edited ? transition(state) : withStep(state, { ...step, edited: true });
  }
  if (keepMessage && step.kind === 'failed') {
    return step.after === null ? transition(state) : withStep(state, { ...step, after: null });
  }
  return step.kind === 'editing' ? transition(state) : withStep(state, { kind: 'editing' });
}

function quoted(state: FormState, request: number, prepared: Prepared): Step {
  const quoting = answering(state, request);
  if (!quoting) return transition(state);
  if (quoting.mode === 'preview') {
    return withStep(state, { kind: 'previewed', inputs: quoting.inputs, preview: prepared });
  }
  const previous = quoting.previous;
  if (!previous) return transition(state);
  if (liveQuoteWorse(previous.preview, prepared, config.slippageBps)) {
    return withStep(state, {
      kind: 'repriced',
      inputs: quoting.inputs,
      preview: previous.preview,
      live: prepared,
    });
  }
  return startActivation(state, {
    inputs: quoting.inputs,
    preview: previous.preview,
    live: prepared,
    from: 'previewed',
  });
}

function repriceAccepted(state: FormState, now: Date): Step {
  const { step } = state;
  if (step.kind !== 'repriced') return transition(state);
  if (quoteExpired(step.live.receipt.quoteResponse.quote.deadline, now)) {
    return withStep(state, {
      kind: 'failed',
      message: NEW_QUOTE_EXPIRED,
      after: { kind: 'previewed', inputs: step.inputs, preview: step.preview },
    });
  }
  return startActivation(state, {
    inputs: step.inputs,
    preview: step.preview,
    live: step.live,
    from: 'repriced',
  });
}

function activationFailed(state: FormState, request: number, message: string | null): Step {
  const activating = activatingFor(state, request);
  if (!activating) return transition(state);
  const after: Previewed | null = activating.edited
    ? null
    : { kind: 'previewed', inputs: activating.inputs, preview: activating.preview };
  return withStep(state, { kind: 'failed', message, after });
}

export function reduceForm(state: FormState, event: FormEvent): Step {
  const { step } = state;
  switch (event.type) {
    case 'edited':
      return inputsChanged(state, false);
    case 'autofilled':
      return inputsChanged(state, true);
    case 'preview-requested':
      if (step.kind === 'quoting' || step.kind === 'repriced' || step.kind === 'activating') {
        return transition(state);
      }
      return startQuote(state, event.inputs, 'preview', previewedOf(step));
    case 'live-requested': {
      if (step.kind === 'quoting') return transition(state);
      const previewed = previewedOf(step);
      return previewed ? startQuote(state, previewed.inputs, 'live', previewed) : transition(state);
    }
    case 'quoted':
      return quoted(state, event.request, event.prepared);
    case 'quote-failed': {
      const quoting = answering(state, event.request);
      if (!quoting) return transition(state);
      return withStep(state, { kind: 'failed', message: event.message, after: quoting.previous });
    }
    case 'reprice-accepted':
      return repriceAccepted(state, event.now);
    case 'reprice-declined':
      if (step.kind !== 'repriced') return transition(state);
      return withStep(state, { kind: 'previewed', inputs: step.inputs, preview: step.preview });
    case 'activated':
      if (!activatingFor(state, event.request)) return transition(state);
      return withStep(state, { kind: 'editing' });
    case 'activation-failed':
      return activationFailed(state, event.request, event.message);
    default:
      throw new Error(`Unknown form event ${String(event satisfies never)}`);
  }
}

export function pendingQuote(state: FormState): readonly number[] {
  return state.step.kind === 'quoting' ? [state.step.request] : [];
}

export function durableFormEffect(effect: FormEffect): boolean {
  return effect.type === 'activate';
}

export const formMachine: FlowMachine<FormState, FormEvent, FormEffect> = {
  reduce: reduceForm,
  pending: pendingQuote,
  durable: durableFormEffect,
};

export interface FormView {
  error: string | null;
  preview: Prepared | null;
  repriced: { preview: Prepared; live: Prepared } | null;
  busy: boolean;
}

export function formView(step: FormStep): FormView {
  switch (step.kind) {
    case 'editing':
      return { error: null, preview: null, repriced: null, busy: false };
    case 'quoting':
      return { error: null, preview: step.previous?.preview ?? null, repriced: null, busy: true };
    case 'previewed':
      return { error: null, preview: step.preview, repriced: null, busy: false };
    case 'repriced':
      return {
        error: null,
        preview: step.preview,
        repriced: { preview: step.preview, live: step.live },
        busy: false,
      };
    case 'activating':
      if (step.edited) return { error: null, preview: null, repriced: null, busy: true };
      return {
        error: null,
        preview: step.preview,
        repriced: step.from === 'repriced' ? { preview: step.preview, live: step.live } : null,
        busy: true,
      };
    case 'failed':
      return {
        error: step.message,
        preview: step.after?.preview ?? null,
        repriced: null,
        busy: false,
      };
    default:
      throw new Error(`Unknown form step ${String(step satisfies never)}`);
  }
}
