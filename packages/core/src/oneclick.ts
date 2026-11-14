import type { NetworkConfig } from './config.js';
import { isMainnetTaproot } from './deposit-address.js';
import { type FetchLike, defaultFetch, requestJson } from './http.js';
import { z } from './schema.js';

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

export interface OneClickStatusResponse {
  status: OneClickSwapStatus;
  updatedAt: string;
  swapDetails: {
    amountOut?: string;
    refundedAmount?: string;
    refundReason?: string;
    originChainTxHashes: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes: { hash: string; explorerUrl: string }[];
  };
}

const oneClickTokenSchema: z.ZodType<OneClickToken> = z.looseObject({
  assetId: z.string(),
  decimals: z.number(),
  blockchain: z.string(),
  symbol: z.string(),
  price: z.number(),
  contractAddress: z.string().optional(),
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
  appFees: z.array(oneClickAppFeeSchema).optional(),
  referral: z.string().optional(),
});

const oneClickQuoteSchema: z.ZodType<OneClickQuote> = z.looseObject({
  depositAddress: z.string().optional(),
  depositMemo: z.string().optional(),
  amountIn: z.string(),
  amountInFormatted: z.string(),
  amountInUsd: z.string(),
  minAmountIn: z.string(),
  amountOut: z.string(),
  amountOutFormatted: z.string(),
  amountOutUsd: z.string(),
  minAmountOut: z.string(),
  deadline: z.string().optional(),
  timeWhenInactive: z.string().optional(),
  timeEstimate: z.number(),
  refundFee: z.string().optional(),
  withdrawFee: z.string().optional(),
});

export const oneClickQuoteResponseSchema: z.ZodType<OneClickQuoteResponse> = z.looseObject({
  quote: oneClickQuoteSchema,
  quoteRequest: oneClickQuoteRequestSchema,
  signature: z.string(),
  timestamp: z.string(),
  correlationId: z.string(),
});

const txHashSchema = z.looseObject({ hash: z.string(), explorerUrl: z.string() });

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
    amountOut: z.string().optional(),
    refundedAmount: z.string().optional(),
    refundReason: z.string().optional(),
    originChainTxHashes: z.array(txHashSchema),
    destinationChainTxHashes: z.array(txHashSchema),
  }),
});

export interface BuildQuoteInput {
  originAsset: string;
  amount: string;
  refundTo: string;
  depositAddress: string;
  dry: boolean;
  now?: Date;
}

export function buildQuoteRequest(
  config: Pick<
    NetworkConfig,
    'btcAssetId' | 'slippageBps' | 'quoteDeadlineMinutes' | 'appFeeBps' | 'appFeeRecipient'
  >,
  input: BuildQuoteInput
): OneClickQuoteRequest {
  if (!isMainnetTaproot(input.depositAddress)) {
    throw new Error('Deposit address must be a mainnet taproot address');
  }
  if (!/^[1-9][0-9]*$/.test(input.amount)) {
    throw new Error('Amount must be a positive integer string in base units');
  }
  if (input.originAsset === config.btcAssetId) {
    throw new Error('Origin asset is already BTC; use the sBTC bridge directly');
  }
  if (!input.refundTo.trim()) {
    throw new Error('A refund address on the origin chain is required');
  }
  if (config.appFeeBps < 0 || config.appFeeBps > 100) {
    throw new Error('App fee must be between 0 and 100 basis points');
  }

  const now = input.now ?? new Date();
  const deadline = new Date(now.getTime() + config.quoteDeadlineMinutes * 60_000);

  const request: OneClickQuoteRequest = {
    dry: input.dry,
    swapType: 'EXACT_INPUT',
    slippageTolerance: config.slippageBps,
    originAsset: input.originAsset,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: config.btcAssetId,
    amount: input.amount,
    refundTo: input.refundTo.trim(),
    refundType: 'ORIGIN_CHAIN',
    recipient: input.depositAddress,
    recipientType: 'DESTINATION_CHAIN',
    deadline: deadline.toISOString(),
    referral: 'portage',
  };
  if (config.appFeeBps > 0) {
    if (!config.appFeeRecipient) throw new Error('App fee is set but has no recipient');
    request.appFees = [{ recipient: config.appFeeRecipient, fee: config.appFeeBps }];
  }
  return request;
}

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
  providerFeesOf(sent, response);
  if (!sent.dry && !response.quote.depositAddress) {
    throw new Error('Quote has no deposit address');
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
