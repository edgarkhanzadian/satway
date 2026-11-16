import type { WithdrawalPreview } from '@satway/core';

import { nextRequest, pureMachine } from '../../shared/index.js';
import type { LiveQuote, WithdrawalForm } from './flow.js';

export interface Editing {
  kind: 'editing';
}

export interface Previewed {
  kind: 'previewed';
  inputs: WithdrawalForm;
  preview: WithdrawalPreview;
}

export interface Quoting {
  kind: 'quoting';
  request: number;
  inputs: WithdrawalForm;
  mode: 'preview' | 'live';
  previous: Previewed | null;
}

export interface Confirming {
  kind: 'confirming';
  inputs: WithdrawalForm;
  preview: WithdrawalPreview;
  live: LiveQuote;
}

export interface Signing {
  kind: 'signing';
  inputs: WithdrawalForm;
  preview: WithdrawalPreview;
  live: LiveQuote;
}

export interface Failed {
  kind: 'failed';
  message: string;
  after: Previewed | Confirming | null;
}

export type FormStep = Editing | Quoting | Previewed | Confirming | Signing | Failed;

export interface FormState {
  last: number;
  step: FormStep;
}

export type FormEvent =
  | { type: 'edited' }
  | { type: 'autofilled' }
  | { type: 'preview-requested'; inputs: WithdrawalForm }
  | { type: 'live-requested'; inputs: WithdrawalForm }
  | { type: 'preview-ready'; request: number; preview: WithdrawalPreview }
  | { type: 'live-ready'; request: number; live: LiveQuote }
  | { type: 'quote-failed'; request: number; message: string }
  | { type: 'cancelled' }
  | { type: 'sign-refused'; message: string }
  | { type: 'sign-started' }
  | { type: 'wallet-answered' }
  | { type: 'wallet-declined'; message: string };

export const INITIAL_FORM: FormState = { last: 0, step: { kind: 'editing' } };

function withStep(state: FormState, step: FormStep): FormState {
  return { ...state, step };
}

function previewedOf(step: FormStep): Previewed | null {
  switch (step.kind) {
    case 'previewed':
      return step;
    case 'quoting':
      return step.previous;
    case 'failed':
      return step.after?.kind === 'previewed' ? step.after : null;
    case 'editing':
    case 'confirming':
    case 'signing':
      return null;
    default:
      throw new Error(`Unknown form step ${String(step satisfies never)}`);
  }
}

function confirmingOf(step: FormStep): Confirming | null {
  if (step.kind === 'confirming') return step;
  if (step.kind === 'failed' && step.after?.kind === 'confirming') return step.after;
  return null;
}

function startQuote(
  state: FormState,
  inputs: WithdrawalForm,
  mode: Quoting['mode'],
  previous: Previewed | null
): FormState {
  const request = nextRequest(state.last);
  return { last: request, step: { kind: 'quoting', request, inputs, mode, previous } };
}

function answering(state: FormState, request: number): Quoting | null {
  return state.step.kind === 'quoting' && state.step.request === request ? state.step : null;
}

export function reduceForm(state: FormState, event: FormEvent): FormState {
  const { step } = state;
  switch (event.type) {
    case 'edited':
      return step.kind === 'editing' ? state : withStep(state, { kind: 'editing' });
    case 'autofilled':
      if (step.kind === 'failed') {
        return step.after === null
          ? state
          : withStep(state, { kind: 'failed', message: step.message, after: null });
      }
      return step.kind === 'editing' ? state : withStep(state, { kind: 'editing' });
    case 'preview-requested':
      if (step.kind === 'quoting' || step.kind === 'signing' || confirmingOf(step)) return state;
      return startQuote(state, event.inputs, 'preview', previewedOf(step));
    case 'live-requested': {
      if (step.kind === 'quoting') return state;
      const previewed = previewedOf(step);
      return previewed ? startQuote(state, event.inputs, 'live', previewed) : state;
    }
    case 'preview-ready': {
      const quoting = answering(state, event.request);
      if (!quoting || quoting.mode !== 'preview') return state;
      return withStep(state, { kind: 'previewed', inputs: quoting.inputs, preview: event.preview });
    }
    case 'live-ready': {
      const quoting = answering(state, event.request);
      if (!quoting || quoting.mode !== 'live' || !quoting.previous) return state;
      return withStep(state, {
        kind: 'confirming',
        inputs: quoting.inputs,
        preview: quoting.previous.preview,
        live: event.live,
      });
    }
    case 'quote-failed': {
      const quoting = answering(state, event.request);
      if (!quoting) return state;
      return withStep(state, { kind: 'failed', message: event.message, after: quoting.previous });
    }
    case 'cancelled': {
      const confirming = confirmingOf(step);
      if (!confirming) return state;
      return withStep(state, {
        kind: 'previewed',
        inputs: confirming.inputs,
        preview: confirming.preview,
      });
    }
    case 'sign-refused': {
      const confirming = confirmingOf(step);
      if (!confirming) return state;
      return withStep(state, {
        kind: 'failed',
        message: event.message,
        after: { kind: 'previewed', inputs: confirming.inputs, preview: confirming.preview },
      });
    }
    case 'sign-started': {
      const confirming = confirmingOf(step);
      if (!confirming) return state;
      return withStep(state, { ...confirming, kind: 'signing' });
    }
    case 'wallet-answered':
      if (step.kind !== 'signing') return state;
      return withStep(state, { ...step, kind: 'confirming' });
    case 'wallet-declined':
      if (step.kind === 'signing') {
        return withStep(state, {
          kind: 'failed',
          message: event.message,
          after: { ...step, kind: 'confirming' },
        });
      }
      if (step.kind === 'editing') {
        return withStep(state, { kind: 'failed', message: event.message, after: null });
      }
      return state;
    default:
      throw new Error(`Unknown form event ${String(event satisfies never)}`);
  }
}

export function pendingQuote(state: FormState): readonly number[] {
  return state.step.kind === 'quoting' ? [state.step.request] : [];
}

export const formMachine = pureMachine(reduceForm, pendingQuote);

export interface FormView {
  error: string | null;
  preview: WithdrawalPreview | null;
  live: LiveQuote | null;
  busy: boolean;
  signing: boolean;
}

export function formView(step: FormStep): FormView {
  const shown = step.kind === 'failed' ? step.after : step;
  const confirm = shown?.kind === 'confirming' || shown?.kind === 'signing' ? shown : null;
  return {
    error: step.kind === 'failed' ? step.message : null,
    preview: confirm?.preview ?? (shown ? previewedOf(shown)?.preview : null) ?? null,
    live: confirm?.live ?? null,
    busy: step.kind === 'quoting',
    signing: step.kind === 'signing',
  };
}
