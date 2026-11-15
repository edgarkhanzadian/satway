import { ResponseShapeError, parseWith, z } from '../shared/index.js';
import {
  DEADLINE_ECHO_TOLERANCE_MS,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
} from './oneclick.js';

export interface StatusQuoteEcho {
  timestamp?: string;
  signature?: string;
  quoteRequest: {
    dry?: boolean;
    swapType?: string;
    slippageTolerance?: number;
    originAsset?: string;
    depositType?: string;
    destinationAsset?: string;
    amount?: string;
    refundTo?: string;
    refundType?: string;
    recipient?: string;
    recipientType?: string;
    deadline?: string;
  };
  quote: {
    depositAddress?: string;
    depositMemo?: string | null;
    amountIn?: string;
    minAmountIn?: string;
    amountOut?: string;
    minAmountOut?: string;
  };
}

const statusEchoSchema: z.ZodType<{ quoteResponse?: StatusQuoteEcho | null }> = z.looseObject({
  quoteResponse: z
    .looseObject({
      timestamp: z.string().optional(),
      signature: z.string().optional(),
      quoteRequest: z.looseObject({
        dry: z.boolean().optional(),
        swapType: z.string().optional(),
        slippageTolerance: z.number().optional(),
        originAsset: z.string().optional(),
        depositType: z.string().optional(),
        destinationAsset: z.string().optional(),
        amount: z.string().optional(),
        refundTo: z.string().optional(),
        refundType: z.string().optional(),
        recipient: z.string().optional(),
        recipientType: z.string().optional(),
        deadline: z.string().optional(),
      }),
      quote: z.looseObject({
        depositAddress: z.string().optional(),
        depositMemo: z.string().nullable().optional(),
        amountIn: z.string().optional(),
        minAmountIn: z.string().optional(),
        amountOut: z.string().optional(),
        minAmountOut: z.string().optional(),
      }),
    })
    .nullable()
    .optional(),
});

export class StatusEchoMismatchError extends Error {
  constructor(readonly field: string) {
    super(`The swap status does not match the quote we hold: "${field}" differs`);
    this.name = 'StatusEchoMismatchError';
  }
}

export function statusQuoteEchoOf(status: OneClickStatusResponse): StatusQuoteEcho | null {
  try {
    return parseWith(statusEchoSchema, status, '1Click status').quoteResponse ?? null;
  } catch (err) {
    if (err instanceof ResponseShapeError) throw new StatusEchoMismatchError('quoteResponse');
    throw err;
  }
}

function sameInstant(a: string, b: string | undefined): boolean {
  if (b === undefined) return false;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < DEADLINE_ECHO_TOLERANCE_MS;
}

export function assertStatusMatchesQuote(
  held: OneClickQuoteResponse,
  status: OneClickStatusResponse
): void {
  const echo = statusQuoteEchoOf(status);
  if (!echo) throw new StatusEchoMismatchError('quoteResponse');
  const sent = held.quoteRequest;
  const requestFields = [
    'recipient',
    'recipientType',
    'refundTo',
    'refundType',
    'originAsset',
    'destinationAsset',
    'amount',
    'swapType',
    'depositType',
    'slippageTolerance',
  ] as const;
  for (const field of requestFields) {
    if (echo.quoteRequest[field] !== sent[field]) {
      throw new StatusEchoMismatchError(`quoteRequest.${field}`);
    }
  }
  if (!sameInstant(sent.deadline, echo.quoteRequest.deadline)) {
    throw new StatusEchoMismatchError('quoteRequest.deadline');
  }
  const quoteFields = [
    'depositAddress',
    'amountIn',
    'minAmountIn',
    'amountOut',
    'minAmountOut',
  ] as const;
  for (const field of quoteFields) {
    if (echo.quote[field] !== held.quote[field]) {
      throw new StatusEchoMismatchError(`quote.${field}`);
    }
  }
  if ((echo.quote.depositMemo ?? null) !== (held.quote.depositMemo ?? null)) {
    throw new StatusEchoMismatchError('quote.depositMemo');
  }
  if (echo.signature !== held.signature) throw new StatusEchoMismatchError('signature');
  if (!sameInstant(held.timestamp, echo.timestamp)) {
    throw new StatusEchoMismatchError('timestamp');
  }
}

export interface SwapRefund {
  refunded: boolean;
  refundedAmount: string | null;
  refundedAmountFormatted: string | null;
  refundReason: string | null;
  refundFee: string | null;
}

const refundSchema: z.ZodType<{
  swapDetails: {
    refundedAmount?: string | null;
    refundedAmountFormatted?: string | null;
    refundReason?: string | null;
    refundFee?: string | null;
  };
}> = z.looseObject({
  swapDetails: z.looseObject({
    refundedAmount: z.string().nullable().optional(),
    refundedAmountFormatted: z.string().nullable().optional(),
    refundReason: z.string().nullable().optional(),
    refundFee: z.string().nullable().optional(),
  }),
});

const BASE_UNITS = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

function significant(digits: string): string {
  return digits.replace(/^0+/, '').replace(/0+$/, '');
}

function sameDigits(baseUnits: string, formatted: string): boolean {
  return (
    DECIMAL.test(formatted) && significant(formatted.replace('.', '')) === significant(baseUnits)
  );
}

export function refundOf(status: OneClickStatusResponse | null): SwapRefund | null {
  if (!status) return null;
  const details = parseWith(refundSchema, status, '1Click status').swapDetails;
  const amount =
    details.refundedAmount && BASE_UNITS.test(details.refundedAmount)
      ? details.refundedAmount
      : null;
  const refunded = status.status === 'REFUNDED' || (amount !== null && BigInt(amount) > 0n);
  const formatted = details.refundedAmountFormatted;
  return {
    refunded,
    refundedAmount: amount,
    refundedAmountFormatted:
      amount !== null && formatted && sameDigits(amount, formatted) ? formatted : null,
    refundReason: details.refundReason ?? null,
    refundFee: details.refundFee && BASE_UNITS.test(details.refundFee) ? details.refundFee : null,
  };
}
