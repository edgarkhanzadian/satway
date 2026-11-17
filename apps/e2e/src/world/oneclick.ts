import { type Reply, field, json, notFound, parseJson, stringField } from './http.js';
import type { Rng } from './random.js';

export const BTC_ASSET_ID = 'nep141:btc.omft.near';
export const PROVIDER_FEE_RECIPIENT =
  '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd';
export const PROVIDER_FEE_BPS = 20;
export const WITHDRAW_FEE_SATS = 1_900;
export const REFUND_FEE = '2400';
export const BTC_PRICE_USD = 97_000;

export type Family = 'evm' | 'tron' | 'bitcoin';

export interface WorldToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  contractAddress?: string;
  family: Family;
  chainId?: number;
}

export const TOKENS = {
  usdcBase: {
    assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    decimals: 6,
    blockchain: 'base',
    symbol: 'USDC',
    price: 0.999652,
    contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    family: 'evm',
    chainId: 8453,
  },
  eth: {
    assetId: 'nep141:eth.omft.near',
    decimals: 18,
    blockchain: 'eth',
    symbol: 'ETH',
    price: 3_150.42,
    family: 'evm',
    chainId: 1,
  },
  usdtTron: {
    assetId: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near',
    decimals: 6,
    blockchain: 'tron',
    symbol: 'USDT',
    price: 1.0001,
    contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pxL8otSzgjLj6t',
    family: 'tron',
  },
  btc: {
    assetId: BTC_ASSET_ID,
    decimals: 8,
    blockchain: 'btc',
    symbol: 'BTC',
    price: BTC_PRICE_USD,
    family: 'bitcoin',
  },
} as const satisfies Record<string, WorldToken>;

const ALL_TOKENS: readonly WorldToken[] = Object.values(TOKENS);

export type SwapStatus =
  | 'KNOWN_DEPOSIT_TX'
  | 'PENDING_DEPOSIT'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

export interface QuoteRecord {
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  authorization: string | null;
  dry: boolean;
}

export interface Swap {
  depositAddress: string;
  token: WorldToken;
  amountIn: bigint;
  amountOut: number;
  minAmountOut: number;
  recipient: string;
  refundTo: string;
  quote: QuoteRecord;
  status: SwapStatus;
  received: bigint;
  originTxHashes: string[];
  destinationTxHashes: string[];
  withheldHashes: string[];
  reportedAmountOut: number | null;
  refundedAmount: bigint | null;
  refundReason: string | null;
  updatedAt: string;
}

export interface DepositArrival {
  depositAddress: string;
  assetId: string;
  amount: bigint;
  txHash: string;
}

export type QuoteTamper = (response: Record<string, unknown>, context: { dry: boolean }) => void;

export interface QuoteAmounts {
  record: QuoteRecord;
  amountIn: string;
  amountInFormatted: string;
  amountOut: number;
  minAmountOut: number;
  depositAddress: string | undefined;
}

export function amountsOf(record: QuoteRecord): QuoteAmounts {
  const quote = field(record.response, 'quote');
  return {
    record,
    amountIn: stringField(quote, 'amountIn') ?? '',
    amountInFormatted: stringField(quote, 'amountInFormatted') ?? '',
    amountOut: Number(stringField(quote, 'amountOut')),
    minAmountOut: Number(stringField(quote, 'minAmountOut')),
    depositAddress: stringField(quote, 'depositAddress'),
  };
}

function formatUnits(amount: bigint, decimals: number): string {
  const digits = amount.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${whole}.${fraction === '' ? '0' : fraction}`;
}

function usd(value: number): string {
  return value.toFixed(12);
}

function truncatedToSeconds(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(Math.floor(ms / 1000) * 1000).toISOString();
}

export function explorerUrlFor(token: WorldToken, hash: string): string {
  if (token.blockchain === 'base') return `https://basescan.org/tx/${hash}`;
  return `https://etherscan.io/tx/${hash}`;
}

export class OneClick {
  readonly quotes: QuoteRecord[] = [];
  readonly swaps = new Map<string, Swap>();
  readonly arrivals: DepositArrival[] = [];
  tamper: QuoteTamper | null = null;
  reportDeposited = true;
  private readonly rng: Rng;
  private readonly now: () => Date;

  constructor(rng: Rng, now: () => Date) {
    this.rng = rng;
    this.now = now;
  }

  readonly extraTokens: WorldToken[] = [];

  tokens(): readonly WorldToken[] {
    return [...ALL_TOKENS, ...this.extraTokens];
  }

  token(assetId: string): WorldToken | null {
    return this.tokens().find(t => t.assetId === assetId) ?? null;
  }

  revealPayout(swap: Swap): void {
    for (const txid of swap.withheldHashes) swap.destinationTxHashes.push(txid);
    swap.withheldHashes.length = 0;
    swap.updatedAt = this.now().toISOString();
  }

  swap(depositAddress: string): Swap {
    const swap = this.swaps.get(depositAddress);
    if (!swap) throw new Error(`1Click has no swap with deposit address ${depositAddress}`);
    return swap;
  }

  latestQuote(dry: boolean): QuoteAmounts {
    const record = this.quotes.filter(q => q.dry === dry).at(-1);
    if (!record) throw new Error(`1Click has served no ${dry ? 'dry' : 'live'} quote`);
    return amountsOf(record);
  }

  latestSwap(): Swap {
    const last = [...this.swaps.values()].at(-1);
    if (!last) throw new Error('1Click has no swap yet');
    return last;
  }

  serve(
    method: string,
    path: string,
    query: URLSearchParams,
    body: string,
    headers: Headers
  ): Reply {
    if (method === 'GET' && path === '/v0/tokens') {
      return json(
        this.tokens().map(t => ({
          assetId: t.assetId,
          decimals: t.decimals,
          blockchain: t.blockchain,
          symbol: t.symbol,
          price: t.price,
          priceUpdatedAt: this.now().toISOString(),
          ...('contractAddress' in t && t.contractAddress
            ? { contractAddress: t.contractAddress }
            : {}),
        }))
      );
    }
    if (method === 'POST' && path === '/v0/quote') {
      return this.quote(parseJson(body), headers.get('authorization'));
    }
    if (method === 'GET' && path === '/v0/status') {
      const address = query.get('depositAddress');
      const swap = address ? this.swaps.get(address) : undefined;
      if (!swap) return notFound('Deposit address not found');
      return json(this.statusOf(swap));
    }
    return notFound('Not found');
  }

  private quote(request: unknown, authorization: string | null): Reply {
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
      return json({ message: 'Invalid request body' }, 400);
    }
    const originAsset = stringField(request, 'originAsset');
    const amountText = stringField(request, 'amount');
    const recipient = stringField(request, 'recipient');
    const refundTo = stringField(request, 'refundTo');
    const deadline = stringField(request, 'deadline');
    const slippage = field(request, 'slippageTolerance');
    const dry = field(request, 'dry');
    const token = originAsset ? this.token(originAsset) : null;
    if (!token || token.assetId === BTC_ASSET_ID)
      return json({ message: 'tokenIn is not valid' }, 400);
    if (field(request, 'destinationAsset') !== BTC_ASSET_ID)
      return json({ message: 'tokenOut is not valid' }, 400);
    if (!amountText || !/^[1-9][0-9]*$/.test(amountText))
      return json({ message: 'amount is not valid' }, 400);
    if (!recipient || !refundTo || !deadline || typeof dry !== 'boolean')
      return json({ message: 'request is missing fields' }, 400);
    if (typeof slippage !== 'number')
      return json({ message: 'slippageTolerance is not valid' }, 400);

    const amountIn = BigInt(amountText);
    const inUsd = (Number(amountIn) / 10 ** token.decimals) * token.price;
    const grossSats = Math.floor((inUsd / BTC_PRICE_USD) * 1e8);
    const amountOut =
      Math.floor((grossSats * (10_000 - PROVIDER_FEE_BPS)) / 10_000) - WITHDRAW_FEE_SATS;
    if (amountOut <= 0)
      return json({ message: 'Amount is too low for bridge, try at least 1.0' }, 400);
    const minAmountOut = Math.floor((amountOut * (10_000 - slippage)) / 10_000);
    const appFees = field(request, 'appFees');
    const ownFees: unknown[] = Array.isArray(appFees) ? appFees : [];
    const providerFee: Record<string, unknown> = dry
      ? { recipient: PROVIDER_FEE_RECIPIENT, fee: PROVIDER_FEE_BPS }
      : { recipient: PROVIDER_FEE_RECIPIENT, fee: PROVIDER_FEE_BPS, limitOrderId: null };
    const echoed: Record<string, unknown> = {
      ...request,
      depositMode: 'SIMPLE',
      deadline: truncatedToSeconds(deadline),
      confidentiality: 'public',
      quoteWaitingTimeMs: 0,
      insured: false,
      appFees: [
        ...ownFees.map(fee =>
          dry || typeof fee !== 'object' || fee === null ? fee : { ...fee, limitOrderId: null }
        ),
        providerFee,
      ],
    };
    const depositAddress = dry ? undefined : this.newDepositAddress(token);
    const quote: Record<string, unknown> = {
      ...(depositAddress ? { depositAddress } : {}),
      amountIn: amountIn.toString(),
      amountInFormatted: formatUnits(amountIn, token.decimals),
      amountInUsd: usd(inUsd),
      minAmountIn: amountIn.toString(),
      amountOut: String(amountOut),
      amountOutFormatted: formatUnits(BigInt(amountOut), 8),
      amountOutUsd: usd((amountOut / 1e8) * BTC_PRICE_USD),
      minAmountOut: String(minAmountOut),
      timeEstimate: 480,
      refundFee: REFUND_FEE,
      withdrawFee: String(WITHDRAW_FEE_SATS),
      ...(dry
        ? {}
        : {
            deadline: truncatedToSeconds(deadline),
            timeWhenInactive: truncatedToSeconds(deadline),
          }),
    };
    const response: Record<string, unknown> = {
      quote,
      quoteRequest: echoed,
      signature: `ed25519:${this.rng.base58(64)}`,
      timestamp: this.now().toISOString(),
      correlationId: this.rng.uuid(),
    };
    this.tamper?.(response, { dry });
    const record: QuoteRecord = { request: { ...request }, response, authorization, dry };
    this.quotes.push(record);
    if (depositAddress) {
      this.swaps.set(depositAddress, {
        depositAddress,
        token,
        amountIn,
        amountOut,
        minAmountOut,
        recipient,
        refundTo,
        quote: record,
        status: 'PENDING_DEPOSIT',
        received: 0n,
        originTxHashes: [],
        destinationTxHashes: [],
        withheldHashes: [],
        reportedAmountOut: null,
        refundedAmount: null,
        refundReason: null,
        updatedAt: this.now().toISOString(),
      });
    }
    return json(response);
  }

  private newDepositAddress(token: WorldToken): string {
    if (token.family === 'evm') return this.rng.evmAddress();
    return `T${this.rng.base58(24).slice(0, 33)}`;
  }

  arrive(arrival: DepositArrival): Swap | null {
    this.arrivals.push(arrival);
    const swap = this.swaps.get(arrival.depositAddress);
    if (!swap || swap.token.assetId !== arrival.assetId) return null;
    if (swap.status !== 'PENDING_DEPOSIT' && swap.status !== 'INCOMPLETE_DEPOSIT') return swap;
    swap.received += arrival.amount;
    swap.originTxHashes.push(arrival.txHash);
    swap.status = swap.received >= swap.amountIn ? 'PROCESSING' : 'INCOMPLETE_DEPOSIT';
    swap.updatedAt = this.now().toISOString();
    return swap;
  }

  succeed(
    swap: Swap,
    payoutTxid: string,
    amountOut: number,
    options: { reportHash?: boolean } = {}
  ): void {
    swap.status = 'SUCCESS';
    if (options.reportHash === false) swap.withheldHashes.push(payoutTxid);
    else swap.destinationTxHashes.push(payoutTxid);
    swap.reportedAmountOut = amountOut;
    swap.updatedAt = this.now().toISOString();
  }

  renamePayout(swap: Swap, from: string, to: string): void {
    for (const list of [swap.destinationTxHashes, swap.withheldHashes]) {
      const at = list.indexOf(from);
      if (at >= 0) list.splice(at, 1, to);
    }
    swap.updatedAt = this.now().toISOString();
  }

  refund(swap: Swap, reason: string): void {
    swap.status = 'REFUNDED';
    swap.refundedAmount = swap.received;
    swap.refundReason = reason;
    swap.updatedAt = this.now().toISOString();
  }

  fail(swap: Swap): void {
    swap.status = 'FAILED';
    swap.updatedAt = this.now().toISOString();
  }

  private statusEchoOf(swap: Swap): Record<string, unknown> {
    const response = swap.quote.response;
    const request = field(response, 'quoteRequest');
    const echoedRequest: Record<string, unknown> =
      typeof request === 'object' && request !== null ? { ...request } : {};
    delete echoedRequest.quoteWaitingTimeMs;
    delete echoedRequest.insured;
    const fees = echoedRequest.appFees;
    if (Array.isArray(fees)) {
      echoedRequest.appFees = fees.map((fee: unknown) =>
        typeof fee === 'object' && fee !== null ? { limitOrderId: null, ...fee } : fee
      );
    }
    echoedRequest.virtualChainRecipient = null;
    echoedRequest.virtualChainRefundRecipient = null;
    echoedRequest.referral = echoedRequest.referral ?? null;
    return {
      timestamp: field(response, 'timestamp'),
      signature: field(response, 'signature'),
      quoteRequest: echoedRequest,
      quote: field(response, 'quote'),
    };
  }

  statusOf(swap: Swap): Record<string, unknown> {
    const token = swap.token;
    const deposited = swap.received > 0n && this.reportDeposited;
    const settled = swap.status === 'SUCCESS';
    const amountOut = swap.reportedAmountOut;
    const refunded = swap.refundedAmount ?? 0n;
    function inUsd(amount: bigint): string {
      return usd((Number(amount) / 10 ** token.decimals) * token.price);
    }
    const quote = field(swap.quote.response, 'quote');
    return {
      status: swap.status,
      updatedAt: swap.updatedAt,
      correlationId: field(swap.quote.response, 'correlationId'),
      swapDetails: {
        depositedAmount: deposited ? swap.received.toString() : null,
        depositedAmountUsd: deposited ? inUsd(swap.received) : null,
        depositedAmountFormatted: deposited ? formatUnits(swap.received, token.decimals) : null,
        intentHashes: [],
        nearTxHashes: [],
        amountIn: settled ? swap.received.toString() : null,
        amountInFormatted: settled ? formatUnits(swap.received, token.decimals) : null,
        amountInUsd: settled ? inUsd(swap.received) : null,
        amountOut: amountOut === null ? null : String(amountOut),
        amountOutFormatted: amountOut === null ? null : formatUnits(BigInt(amountOut), 8),
        amountOutUsd: amountOut === null ? null : usd((amountOut / 1e8) * BTC_PRICE_USD),
        slippage: settled ? 0 : null,
        refundedAmount: refunded.toString(),
        refundedAmountFormatted: formatUnits(refunded, token.decimals),
        refundedAmountUsd: inUsd(refunded),
        refundReason: swap.refundReason,
        refundFee: stringField(quote, 'refundFee') ?? REFUND_FEE,
        withdrawFee: stringField(quote, 'withdrawFee') ?? String(WITHDRAW_FEE_SATS),
        originChainTxHashes: swap.originTxHashes.map(hash => ({
          hash,
          explorerUrl: explorerUrlFor(token, hash),
        })),
        destinationChainTxHashes: swap.destinationTxHashes.map(hash => ({
          hash,
          explorerUrl: `https://mempool.space/tx/${hash}`,
        })),
      },
      quoteResponse: this.statusEchoOf(swap),
    };
  }
}
