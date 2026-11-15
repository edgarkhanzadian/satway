import { type FetchLike, defaultFetch, nullOrAbsent, requestJson, z } from '../shared/index.js';

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  contractAddress?: string;
}

export interface OneClickAppFee {
  recipient: string;
  fee: number;
}

export interface OneClickQuoteRequest {
  dry: boolean;
  swapType: 'EXACT_INPUT';
  slippageTolerance: number;
  originAsset: string;
  depositType: 'ORIGIN_CHAIN';
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: 'ORIGIN_CHAIN';
  recipient: string;
  recipientType: 'DESTINATION_CHAIN';
  deadline: string;
  appFees?: OneClickAppFee[];
  referral?: string;
}

export interface OneClickQuote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
}

export interface OneClickQuoteResponse {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: OneClickQuoteRequest;
  quote: OneClickQuote;
}

export type OneClickSwapStatus =
  | 'KNOWN_DEPOSIT_TX'
  | 'PENDING_DEPOSIT'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

export interface OneClickTxHash {
  hash: string;
  explorerUrl?: string;
}

export interface OneClickStatusResponse {
  status: OneClickSwapStatus;
  updatedAt: string;
  swapDetails: {
    depositedAmount?: string;
    amountIn?: string;
    amountOut?: string;
    refundedAmount?: string;
    refundReason?: string;
    originChainTxHashes: OneClickTxHash[];
    destinationChainTxHashes: OneClickTxHash[];
  };
}

const text = z.string();

const oneClickTokenSchema: z.ZodType<OneClickToken> = z.looseObject({
  assetId: z.string(),
  decimals: z.number(),
  blockchain: z.string(),
  symbol: z.string(),
  price: z.number(),
  contractAddress: nullOrAbsent(text),
});

export const oneClickTokensSchema: z.ZodType<OneClickToken[]> = z.array(oneClickTokenSchema);

const oneClickAppFeeSchema: z.ZodType<OneClickAppFee> = z.looseObject({
  recipient: z.string(),
  fee: z.number(),
});

const oneClickQuoteRequestSchema: z.ZodType<OneClickQuoteRequest> = z.looseObject({
  dry: z.boolean(),
  swapType: z.literal('EXACT_INPUT'),
  slippageTolerance: z.number(),
  originAsset: z.string(),
  depositType: z.literal('ORIGIN_CHAIN'),
  destinationAsset: z.string(),
  amount: z.string(),
  refundTo: z.string(),
  refundType: z.literal('ORIGIN_CHAIN'),
  recipient: z.string(),
  recipientType: z.literal('DESTINATION_CHAIN'),
  deadline: z.string(),
  appFees: nullOrAbsent(z.array(oneClickAppFeeSchema)),
  referral: nullOrAbsent(text),
});

const oneClickQuoteSchema: z.ZodType<OneClickQuote> = z.looseObject({
  depositAddress: nullOrAbsent(text),
  depositMemo: nullOrAbsent(text),
  amountIn: z.string(),
  amountInFormatted: z.string(),
  amountInUsd: z.string(),
  minAmountIn: z.string(),
  amountOut: z.string(),
  amountOutFormatted: z.string(),
  amountOutUsd: z.string(),
  minAmountOut: z.string(),
  deadline: nullOrAbsent(text),
  timeWhenInactive: nullOrAbsent(text),
  timeEstimate: z.number(),
  refundFee: nullOrAbsent(text),
  withdrawFee: nullOrAbsent(text),
});

export const oneClickQuoteResponseSchema: z.ZodType<OneClickQuoteResponse> = z.looseObject({
  quote: oneClickQuoteSchema,
  quoteRequest: oneClickQuoteRequestSchema,
  signature: z.string(),
  timestamp: z.string(),
  correlationId: z.string(),
});

const txHashSchema: z.ZodType<OneClickTxHash> = z.looseObject({
  hash: z.string(),
  explorerUrl: nullOrAbsent(text),
});

export const oneClickStatusResponseSchema: z.ZodType<OneClickStatusResponse> = z.looseObject({
  status: z.enum([
    'KNOWN_DEPOSIT_TX',
    'PENDING_DEPOSIT',
    'INCOMPLETE_DEPOSIT',
    'PROCESSING',
    'SUCCESS',
    'REFUNDED',
    'FAILED',
  ]),
  updatedAt: z.string(),
  swapDetails: z.looseObject({
    depositedAmount: nullOrAbsent(text),
    amountIn: nullOrAbsent(text),
    amountOut: nullOrAbsent(text),
    refundedAmount: nullOrAbsent(text),
    refundReason: nullOrAbsent(text),
    originChainTxHashes: z.array(txHashSchema),
    destinationChainTxHashes: z.array(txHashSchema),
  }),
});

export function assertQuoteMatchesRequest(
  sent: OneClickQuoteRequest,
  response: OneClickQuoteResponse
): void {
  const echoed = response.quoteRequest;
  function same(a: unknown, b: unknown) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  const fields: (keyof OneClickQuoteRequest)[] = [
    'recipient',
    'recipientType',
    'refundTo',
    'refundType',
    'originAsset',
    'destinationAsset',
    'amount',
    'swapType',
    'depositType',
  ];
  for (const field of fields) {
    if (!same(sent[field], echoed?.[field])) {
      throw new Error(`Quote does not match the request: "${field}" was changed`);
    }
  }
  if (echoed?.slippageTolerance !== sent.slippageTolerance) {
    throw new Error('Quote does not match the request: "slippageTolerance" was changed');
  }
  if (echoed?.dry !== sent.dry) {
    throw new Error('Quote does not match the request: "dry" was changed');
  }
  if (!sameInstant(sent.deadline, echoed?.deadline)) {
    throw new Error('Quote does not match the request: "deadline" was changed');
  }
  providerFeesOf(sent, response);
  assertExactInput(response.quote, sent.amount);
  assertMinimumMatchesSlippage(response.quote, sent.slippageTolerance);
  if (!sent.dry && !response.quote.depositAddress) {
    throw new Error('Quote has no deposit address');
  }
}

export const DEADLINE_ECHO_TOLERANCE_MS = 1000;

function sameInstant(sent: string, echoed: string | undefined): boolean {
  if (echoed === undefined) return false;
  const a = Date.parse(sent);
  const b = Date.parse(echoed);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < DEADLINE_ECHO_TOLERANCE_MS;
}

export const MIN_AMOUNT_OUT_ROUNDING_UNITS = 1n;

function baseUnits(text: string): bigint | null {
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

function assertExactInput(quote: Pick<OneClickQuote, 'amountIn' | 'minAmountIn'>, amount: string) {
  const amountIn = baseUnits(quote.amountIn);
  const minAmountIn = baseUnits(quote.minAmountIn);
  if (amountIn === null || minAmountIn === null) {
    throw new Error('Quote amounts are not whole numbers');
  }
  if (amountIn !== baseUnits(amount)) {
    throw new Error('Quote does not match the request: "amountIn" is not the requested amount');
  }
  if (minAmountIn > amountIn) {
    throw new Error(
      'Quote does not add up: its minimum input is above the amount it asks for, so the swap would be refunded'
    );
  }
}

function assertMinimumMatchesSlippage(
  quote: Pick<OneClickQuote, 'amountOut' | 'minAmountOut'>,
  slippageBps: number
): void {
  const amountOut = baseUnits(quote.amountOut);
  const minAmountOut = baseUnits(quote.minAmountOut);
  if (amountOut === null || minAmountOut === null) {
    throw new Error('Quote amounts are not whole numbers');
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error('Slippage must be a whole number of basis points');
  }
  if (minAmountOut > amountOut) {
    throw new Error('Quote does not add up: its minimum output is above its expected output');
  }
  const floor = (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  if (minAmountOut + MIN_AMOUNT_OUT_ROUNDING_UNITS < floor) {
    throw new Error(
      'Quote does not add up: its minimum output allows more than the requested slippage'
    );
  }
}

export const MAX_PROVIDER_FEE_BPS = 50;

export function providerFeesOf(
  sent: OneClickQuoteRequest,
  response: OneClickQuoteResponse
): OneClickAppFee[] {
  const ours = sent.appFees ?? [];
  const echoed = response.quoteRequest?.appFees ?? [];
  const head = echoed.slice(0, ours.length);
  if (JSON.stringify(head) !== JSON.stringify(ours)) {
    throw new Error('Quote does not match the request: "appFees" was changed');
  }
  const extra = echoed.slice(ours.length);
  const extraBps = extra.reduce((sum, f) => sum + f.fee, 0);
  if (extra.some(f => !(f.fee >= 0)) || extraBps > MAX_PROVIDER_FEE_BPS) {
    throw new Error(
      `Quote does not match the request: "appFees" has ${extraBps} bps of unexpected fees`
    );
  }
  return extra;
}

export class OneClickClient {
  constructor(
    private readonly baseUrl: string,
    private readonly options: { jwt?: string; fetchFn?: FetchLike } = {}
  ) {}

  private get fetchFn(): FetchLike {
    return this.options.fetchFn ?? defaultFetch;
  }

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (json) headers['content-type'] = 'application/json';
    if (this.options.jwt) headers.authorization = `Bearer ${this.options.jwt}`;
    return headers;
  }

  tokens(): Promise<OneClickToken[]> {
    return requestJson(this.fetchFn, `${this.baseUrl}/v0/tokens`, oneClickTokensSchema, {
      headers: this.headers(),
    });
  }

  async quote(request: OneClickQuoteRequest): Promise<OneClickQuoteResponse> {
    const response = await requestJson(
      this.fetchFn,
      `${this.baseUrl}/v0/quote`,
      oneClickQuoteResponseSchema,
      { method: 'POST', headers: this.headers(true), body: JSON.stringify(request) }
    );
    assertQuoteMatchesRequest(request, response);
    return response;
  }

  status(depositAddress: string, depositMemo?: string): Promise<OneClickStatusResponse> {
    const params = new URLSearchParams({ depositAddress });
    if (depositMemo) params.set('depositMemo', depositMemo);
    return requestJson(
      this.fetchFn,
      `${this.baseUrl}/v0/status?${params.toString()}`,
      oneClickStatusResponseSchema,
      { headers: this.headers() }
    );
  }
}
