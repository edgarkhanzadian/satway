import { HttpError, parseWith } from '../shared/index.js';
import { type OneClickStatusResponse, oneClickStatusResponseSchema } from './oneclick.js';

export function parseOneClickStatus(value: unknown): OneClickStatusResponse {
  return parseWith(oneClickStatusResponseSchema, value, '1Click status');
}

export class SwapNotListedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwapNotListedError';
  }
}

export function isSwapNotListed(err: unknown): boolean {
  return err instanceof SwapNotListedError || (err instanceof HttpError && err.status === 404);
}
