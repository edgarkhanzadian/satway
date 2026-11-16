import { errorMessage } from '@satway/core';

export const NO_REASON = 'the check failed without saying why';

export function failureReason(err: unknown): string {
  return errorMessage(err) || NO_REASON;
}
