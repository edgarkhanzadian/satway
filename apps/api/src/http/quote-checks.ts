import { type AppFeeConfig, type OneClickAppFee, appFeesFor } from '@satway/core';

import { BadRequest } from './errors.js';

export const DEADLINE_MARGIN_MINUTES = 60;

export function str(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new BadRequest(`"${name}" must be a non-empty string`);
  }
  return value;
}

export function bodyObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequest('Body must be a JSON object');
  }
  return { ...body };
}

export function assertOriginChainExactInput(b: Record<string, unknown>): void {
  if (b.swapType !== 'EXACT_INPUT') throw new BadRequest('Only EXACT_INPUT is supported');
  if (b.depositType !== 'ORIGIN_CHAIN' || b.refundType !== 'ORIGIN_CHAIN') {
    throw new BadRequest('Deposits and refunds must be on the origin chain');
  }
  if (b.recipientType !== 'DESTINATION_CHAIN') {
    throw new BadRequest('The recipient must be on the destination chain');
  }
}

export function dryFlag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BadRequest('"dry" must be a boolean');
  return value;
}

export function deadlineWithin(value: unknown, deadlineMinutes: number, now: Date): string {
  const deadline = str(value, 'deadline', 40);
  const deadlineMs = Date.parse(deadline);
  if (Number.isNaN(deadlineMs)) throw new BadRequest('"deadline" must be an ISO date');
  const windowMinutes = deadlineMinutes + DEADLINE_MARGIN_MINUTES;
  if (deadlineMs <= now.getTime() || deadlineMs > now.getTime() + windowMinutes * 60_000) {
    throw new BadRequest(
      `"deadline" must be in the future and at most ${windowMinutes} minutes away`
    );
  }
  return deadline;
}

export function checkedAppFees(given: unknown, config: AppFeeConfig): OneClickAppFee[] {
  const expected = config.appFeeRecipient ? (appFeesFor(config) ?? []) : [];
  const sent = Array.isArray(given) ? given : [];
  if (JSON.stringify(sent) !== JSON.stringify(expected)) {
    throw new BadRequest('"appFees" does not match the configured fee');
  }
  return expected;
}
